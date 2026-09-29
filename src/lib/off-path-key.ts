/**
 * Maps a dynamic-route request path to the baked static object key the off path
 * serves from the site bucket.
 *
 * Feature: render-rollout-flag (Parts 1 and 2 of the AppConfig rollout)
 *
 * While the `renderFromBackend` flag is off for a visitor, the render Lambda
 * serves the page the static publisher already baked into the site bucket for
 * that route, instead of rendering through Astro. This module is the pure key
 * derivation, factored out so it can be unit-tested without S3.
 *
 * The mapping was verified against a real `npm run build` of the dist tree:
 *
 *   /                     -> index.html
 *   /index.md             -> index.md
 *   /talks/               -> talks/index.html
 *   /talks/index.md       -> talks/index.md
 *   /blog/                -> blog/index.html
 *   /blog/index.md        -> blog/index.md
 *   /blog/<slug>/         -> blog/<slug>/index.html
 *   /blog/<slug>.md       -> blog/<slug>.md
 *   /categories/<c>/      -> categories/<c>/index.html
 *   /categories/<c>.md    -> categories/<c>.md
 *   /tags/<t>/            -> tags/<t>/index.html
 *   /tags/<t>.md          -> tags/<t>.md
 *   /rss.xml              -> rss.xml
 *   /sitemap.xml          -> sitemap.xml
 *   /llms.txt             -> llms.txt
 *   /llms-full.txt        -> llms-full.txt
 *
 * The render viewer-request CloudFront function normalizes clean paths to their
 * trailing-slash form and negotiates the `.md` alternate before the origin sees
 * the request, so this maps the SAME normalized paths the SSR server matches.
 * Any path outside that set returns `null`, so the off path never fabricates a
 * key for a route it does not own.
 *
 * The derivation mirrors the S3-origin viewer-request function
 * (`viewerRequestCode` in `edge-functions.ts`): a path with a file extension is
 * the key verbatim (minus the leading slash); a clean path gets `/index.html`
 * appended (the root maps to `index.html`).
 */

/** The dynamic route path prefixes/paths this off path is allowed to serve. */
const EXACT_PATHS = new Set<string>([
  "/",
  "/index.md",
  "/talks/",
  "/talks/index.md",
  "/blog/",
  "/blog/index.md",
  "/rss.xml",
  "/sitemap.xml",
  "/llms.txt",
  "/llms-full.txt",
]);

/** A blog post, category, or tag item path (clean HTML or `.md` alternate). */
const ITEM_PATH =
  /^\/(blog|categories|tags)\/([^/]+?)(\/|\.md)$/;

/** The content type served for a baked key, inferred from its suffix. */
export function contentTypeForKey(key: string): string {
  if (key.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (key.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (key.endsWith(".txt")) {
    // llms.txt / llms-full.txt are plain text.
    return "text/plain; charset=utf-8";
  }
  return "text/html; charset=utf-8";
}

/**
 * Derives the baked site-bucket key for a normalized dynamic-route path, or
 * `null` when the path is not one of the dynamic routes the off path serves.
 *
 * The path is the origin-request path AFTER the render viewer-request function
 * has normalized clean paths to their trailing-slash form and mapped the `.md`
 * negotiation, i.e. exactly what the SSR server would match on the on path.
 */
export function bakedKeyForPath(pathname: string): string | null {
  if (EXACT_PATHS.has(pathname)) {
    return pathname === "/" ? "index.html" : cleanKey(pathname);
  }

  const item = ITEM_PATH.exec(pathname);
  if (item !== null) {
    return cleanKey(pathname);
  }

  return null;
}

/**
 * Turns a normalized path into its baked key. A path ending in a file extension
 * (`.md`, `.xml`, `.txt`) is the key verbatim without the leading slash; a clean
 * path (trailing slash or root) gets `index.html` appended.
 */
function cleanKey(pathname: string): string {
  const withoutLeadingSlash = pathname.replace(/^\//, "");
  if (/\.[a-z0-9]+$/i.test(withoutLeadingSlash)) {
    return withoutLeadingSlash;
  }
  // A clean path always ends with a slash here (the render function normalizes
  // `/talks` to `/talks/` and `/blog/<slug>` to `/blog/<slug>/`).
  return `${withoutLeadingSlash}index.html`;
}

/**
 * Every code-owned S3 key PREFIX the off path may read, for scoping the render
 * role's `s3:GetObject` grant to exactly the baked dynamic routes rather than
 * the whole site bucket. Each entry is an IAM resource suffix under the site
 * bucket ARN.
 */
export const OFF_PATH_KEY_PATTERNS: readonly string[] = [
  "index.html",
  "index.md",
  "talks/*",
  "blog/*",
  "categories/*",
  "tags/*",
  "rss.xml",
  "sitemap.xml",
  "llms.txt",
  "llms-full.txt",
];
