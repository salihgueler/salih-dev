/**
 * Page-side helpers for the reader-counts feature.
 *
 * Feature: reader-counts (see .kiro/specs/reader-counts/design.md).
 *
 * The widget only goes on a blog post's HTML page, never on the blog index, a
 * category or tag listing, or a post's `.md` alternate, so the render
 * middleware only spends a `readerCounts` flag read on those requests.
 */

const BLOG_POST_HTML = /^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/;

/** Whether the resolved request path is a blog post's HTML page. */
export function isBlogPostHtmlPath(pathname: string): boolean {
  return BLOG_POST_HTML.test(pathname);
}

/** The comments endpoint for a post, same origin as the page. */
export function commentsApiPath(slug: string): string {
  return `/api/comments/${encodeURIComponent(slug)}`;
}

/** The heartbeat endpoint for a post, same origin as the page. */
export function readersApiPath(slug: string): string {
  return `/api/readers/${encodeURIComponent(slug)}`;
}
