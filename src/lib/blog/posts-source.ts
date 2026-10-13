/**
 * Request-scoped published-posts override.
 *
 * Feature: backend-served-content
 *
 * The blog index, the post pages, the category and tag pages, and every
 * machine-readable listing that includes posts (`rss.xml`, `sitemap.xml`,
 * `llms.txt`, `llms-full.txt`, the `.md` alternates, `api/catalog.json`) all
 * read their posts through `getPublishedPosts()` in `src/lib/content.ts`. The
 * static build resolves that from the Astro `blog` collection; the request-time
 * renderer instead resolves it per request from the content bucket's `posts/`
 * prefix, so a dev.to import or a removed post is live in seconds without a
 * build.
 *
 * This module is the single seam that lets both callers share the same page
 * code. It holds an {@link AsyncLocalStorage} override that the render path sets
 * for the duration of one request; `getPublishedPosts()` returns the override
 * when one is active and reads the collection otherwise. The override is
 * read-only within its scope, so one request can never leak posts into another.
 *
 * A request-time post carries the same fields the pages read from a collection
 * entry (`id`, validated `data`, raw `body`) plus `renderHtml`: compiles the
 * post body through the shared Markdown config, byte-identical to what Astro's
 * build-time `render()` would produce (the reliability proof diffs the two).
 * Compiling is lazy and memoized, because only a post's own page needs its
 * HTML; the listings read `data` and `body` only. `[slug].astro` renders that HTML directly in the SSR path instead of
 * calling `render()`, which only works on build-time-compiled entries.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { BlogPostData } from "./schema";

/** One published post resolved at request time from the content bucket. */
export type RequestTimePost = Readonly<{
  /** Collection id: the `posts/<id>.md` key without prefix or extension. */
  id: string;
  /** Frontmatter validated by the shared blog schema. */
  data: BlogPostData;
  /** Raw Markdown body (used by the Markdown documents serializer). */
  body: string;
  /** Compiles the body to HTML through the shared config (memoized). */
  renderHtml: () => Promise<string>;
}>;

const overrideStorage = new AsyncLocalStorage<readonly RequestTimePost[]>();

/**
 * Runs `callback` with a request-scoped published-posts override in effect. The
 * render path resolves the posts from S3, then renders the dynamic route inside
 * this scope so every posts reader sees the request's posts. The scope is
 * unwound when the callback settles, so no request leaks posts into another.
 */
export function withPublishedPosts<T>(
  posts: readonly RequestTimePost[],
  callback: () => T,
): T {
  return overrideStorage.run(posts, callback);
}

/** The active request's published posts, or `null` when none is set. */
export function requestTimePosts(): readonly RequestTimePost[] | null {
  return overrideStorage.getStore() ?? null;
}

/** The rendered HTML for one request-time post id, if a request scope is set. */
export async function requestTimePostHtml(id: string): Promise<string | null> {
  const posts = overrideStorage.getStore();
  if (posts === undefined) return null;
  const post = posts.find((entry) => entry.id === id);
  return post === undefined ? null : post.renderHtml();
}
