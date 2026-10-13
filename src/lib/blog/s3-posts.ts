/**
 * Request-time blog post source.
 *
 * Feature: backend-served-content
 *
 * The publisher syncs the content bucket's `posts/` prefix into
 * `src/content/blog` and bakes the blog. To serve the blog at request time
 * instead, the render function reads the same stored `posts/<id>.md` objects and
 * turns them into the request-scoped published-posts override the pages read
 * through.
 *
 * This module is the boundary that turns stored objects into validated,
 * rendered posts:
 *
 * 1. Frontmatter is parsed with `@astrojs/markdown-remark`'s `parseFrontmatter`
 *    (the same parser Astro's glob loader uses) and validated with the SAME
 *    `blogPostSchema` the collection applies, so a request-time post is accepted
 *    on exactly the rules the static build accepts.
 * 2. The body is compiled through the shared {@link MARKDOWN_CONFIG}, so the
 *    request-time HTML is byte-identical to what Astro's build-time `render()`
 *    produces for the same source (the reliability proof diffs the two).
 *
 * A post whose object key is malformed, whose frontmatter fails the schema, or
 * whose id does not match its key is EXCLUDED from the result and its key is
 * returned in `droppedKeys`, so one bad object can never drop or corrupt the
 * rest of the blog; the caller logs the dropped keys. Everything here is pure
 * over injected object bodies: no S3, no filesystem, no network.
 */

import {
  createMarkdownProcessor,
  parseFrontmatter,
} from "@astrojs/markdown-remark";

import { blogPostSchema, type BlogPostData } from "./schema";
import { MARKDOWN_CONFIG } from "../markdown-config";
import type { RequestTimePost } from "./posts-source";

/** Object key prefix under which published blog posts are stored. */
export const POST_PREFIX = "posts/";
/** Suffix of a stored blog post object. */
export const POST_SUFFIX = ".md";

/** One stored blog post object: its key and its UTF-8 Markdown body. */
export type StoredPostObject = Readonly<{
  key: string;
  body: string;
}>;

/** The collection id the Astro glob loader assigns `posts/<id>.md`. */
export function postIdFromKey(key: string): string | null {
  if (!key.startsWith(POST_PREFIX) || !key.endsWith(POST_SUFFIX)) return null;
  const id = key.slice(POST_PREFIX.length, -POST_SUFFIX.length);
  // The glob loader ids a nested file by its path under the base; posts are a
  // flat prefix, so a nested separator would not round-trip to the same key.
  if (id.length === 0 || id.includes("/")) return null;
  return id;
}

/**
 * Parses and validates one stored post's frontmatter, returning the id and the
 * validated data plus the raw body, or `null` when the key is malformed or the
 * frontmatter fails the shared schema.
 */
export function parseStoredPost(
  object: StoredPostObject,
): Readonly<{ id: string; data: BlogPostData; body: string }> | null {
  const id = postIdFromKey(object.key);
  if (id === null) return null;

  let frontmatter: unknown;
  let content: string;
  try {
    const parsed = parseFrontmatter(object.body);
    frontmatter = parsed.frontmatter;
    content = parsed.content;
  } catch {
    return null;
  }

  const result = blogPostSchema.safeParse(frontmatter);
  if (!result.success) return null;

  return { id, data: result.data, body: content };
}

/** The Markdown processor, built once per container (it loads the highlighter). */
let processorPromise: ReturnType<typeof createMarkdownProcessor> | null = null;

function markdownProcessor(): ReturnType<typeof createMarkdownProcessor> {
  if (processorPromise === null) {
    processorPromise = createMarkdownProcessor(MARKDOWN_CONFIG);
    // A failed build must not stick: the next request tries again.
    processorPromise.catch(() => {
      processorPromise = null;
    });
  }
  return processorPromise;
}

/**
 * Parsed posts kept for the life of the container, keyed by object key. An
 * entry is reused only when the stored body is byte-identical, so an edited
 * post is re-parsed (and re-rendered when asked) on the first request that
 * reads the new body.
 */
const parsedPosts = new Map<string, Readonly<{ source: string; post: RequestTimePost }>>();

/** Test seam: forgets the cached processor and parsed posts. */
export function resetPostRenderCacheForTests(): void {
  processorPromise = null;
  parsedPosts.clear();
}

/** A memoized compile of one post body; a failed compile is retried next time. */
function lazyHtml(body: string): () => Promise<string> {
  let html: Promise<string> | null = null;
  return () => {
    if (html === null) {
      html = markdownProcessor().then(async (processor) => (await processor.render(body)).code);
      html.catch(() => {
        html = null;
      });
    }
    return html;
  };
}

/**
 * Turns stored post objects into the request-time published-posts override.
 * Every post's frontmatter is validated here, so an invalid post is dropped
 * before any page sees it. Its body is compiled through the shared Markdown
 * config only when a page asks for the HTML, so the rendered HTML matches the
 * static build. Drafts are kept here (the pages filter them, exactly as
 * `getPublishedPosts` filters the collection) so the override is a faithful
 * stand-in for the collection. Dropped keys are returned for the caller to log;
 * they are never served.
 *
 * Building the processor and compiling every post on every request took about
 * 2.5 s of a warm render Lambda invocation and about 11 s on a cold one. Now
 * the listings compile nothing, a post page compiles one body, and both the
 * processor and each compile are memoized per container. The S3 reads still
 * happen on every request, so a changed or removed post shows up at once.
 */
export async function requestTimePostsFromObjects(
  objects: readonly StoredPostObject[],
): Promise<
  Readonly<{ posts: readonly RequestTimePost[]; droppedKeys: readonly string[] }>
> {
  const posts: RequestTimePost[] = [];
  const droppedKeys: string[] = [];
  const seen = new Set<string>();

  for (const object of objects) {
    seen.add(object.key);
    const cached = parsedPosts.get(object.key);
    if (cached !== undefined && cached.source === object.body) {
      posts.push(cached.post);
      continue;
    }
    const parsed = parseStoredPost(object);
    if (parsed === null) {
      parsedPosts.delete(object.key);
      droppedKeys.push(object.key);
      continue;
    }
    const post: RequestTimePost = Object.freeze({
      id: parsed.id,
      data: parsed.data,
      body: parsed.body,
      renderHtml: lazyHtml(parsed.body),
    });
    parsedPosts.set(object.key, Object.freeze({ source: object.body, post }));
    posts.push(post);
  }

  // Drop entries for posts that are no longer stored.
  for (const key of parsedPosts.keys()) {
    if (!seen.has(key)) parsedPosts.delete(key);
  }

  // Stable id order so the derived listings are reproducible; the pages re-sort
  // by date, so this only fixes the tiebreak among equal dates.
  const order = (left: RequestTimePost, right: RequestTimePost): number =>
    left.id === right.id ? 0 : left.id < right.id ? -1 : 1;

  return Object.freeze({
    posts: Object.freeze([...posts].sort(order)),
    droppedKeys: Object.freeze([...droppedKeys].sort()),
  });
}
