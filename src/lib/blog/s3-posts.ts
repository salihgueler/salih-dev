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

/**
 * Turns stored post objects into the request-time published-posts override,
 * compiling each accepted post's body through the shared Markdown config so the
 * rendered HTML matches the static build. Drafts are kept here (the pages filter
 * them, exactly as `getPublishedPosts` filters the collection) so the override
 * is a faithful stand-in for the collection. Dropped keys are returned for the
 * caller to log; they are never served.
 */
export async function requestTimePostsFromObjects(
  objects: readonly StoredPostObject[],
): Promise<
  Readonly<{ posts: readonly RequestTimePost[]; droppedKeys: readonly string[] }>
> {
  const processor = await createMarkdownProcessor(MARKDOWN_CONFIG);
  const posts: RequestTimePost[] = [];
  const droppedKeys: string[] = [];

  await Promise.all(
    objects.map(async (object) => {
      const parsed = parseStoredPost(object);
      if (parsed === null) {
        droppedKeys.push(object.key);
        return;
      }
      const rendered = await processor.render(parsed.body);
      posts.push(
        Object.freeze({
          id: parsed.id,
          data: parsed.data,
          body: parsed.body,
          renderedHtml: rendered.code,
        }),
      );
    }),
  );

  // Stable id order so the derived listings are reproducible; the pages re-sort
  // by date, so this only fixes the tiebreak among equal dates.
  const order = (left: RequestTimePost, right: RequestTimePost): number =>
    left.id === right.id ? 0 : left.id < right.id ? -1 : 1;

  return Object.freeze({
    posts: Object.freeze([...posts].sort(order)),
    droppedKeys: Object.freeze([...droppedKeys].sort()),
  });
}
