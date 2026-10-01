/**
 * Per-route prerender flag for the backend-served-content dynamic routes.
 *
 * The sixteen dynamic route files (home, Talks, the blog index, posts,
 * categories and tags, each with its `.md` alternate, plus `rss.xml`,
 * `sitemap.xml`, `llms.txt` and `llms-full.txt`) declare their prerender mode
 * with the exact sentinel line
 *
 *   export const prerender = PRERENDER_DYNAMIC_ROUTE;
 *
 * Astro only honours a literal `true`/`false` when it scans a route's
 * `prerender` export; an imported constant or an expression is not evaluated and
 * falls back to the default (prerendered). To keep one source tree while
 * producing two build shapes, `infra/scripts/build-render-lambda.mjs` patches
 * that sentinel line on disk to a literal `false` for the duration of the SSR
 * build (render Lambda, routes served on request) and restores it afterwards.
 * The static publisher build reads the unpatched file, where this constant is
 * `true`, and prerenders the routes into the static output. This constant is the
 * value that stands in for type-checking and for any build that does not apply
 * the patch; it defaults to `true` so the safe, static shape is the fallback.
 */
export const PRERENDER_DYNAMIC_ROUTE = true;
