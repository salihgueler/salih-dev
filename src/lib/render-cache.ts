/**
 * Cache-Control values for the backend-served dynamic routes.
 *
 * Feature: backend-served-content
 *
 * These are the header contract the render middleware applies, factored out so
 * they can be unit-tested without the Astro virtual-module graph the middleware
 * pulls in. The full request-time behaviour (a 200 carrying
 * {@link DYNAMIC_CACHE_CONTROL}, a `no-store` 5xx when the content read fails)
 * is proven against the real render bridge by the Docker runtime proof.
 */

/**
 * Cache-Control for a successful dynamic-route response.
 *
 * - `max-age=0` keeps nothing in the visitor's browser past a revalidation, so
 *   an invalidated change is never hidden by a stale browser copy (req 5.5).
 * - `s-maxage=300` lets CloudFront serve repeat requests from the edge for five
 *   minutes without re-invoking the render Lambda (req 5.1); a content write
 *   invalidates the exact paths so the next request is fresh within seconds.
 * - `stale-while-revalidate=60` lets the edge serve the just-expired object
 *   while it refreshes in the background, so a viewer never waits on a cold
 *   render at the five-minute boundary.
 * - `stale-if-error=86400` lets CloudFront serve the last good response for up
 *   to 24 hours if the render origin or the content bucket is briefly
 *   unavailable (req 5.3). CloudFront caps the stale window at the cache
 *   policy's maximum TTL, so RenderCachePolicy's maxTtl is 24 hours.
 */
export const DYNAMIC_CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=86400";

/**
 * Cache-Control for a failed render.
 *
 * `no-store` guarantees CloudFront never caches the 5xx as if it were content,
 * so a transient read failure cannot poison the edge; combined with
 * `stale-if-error` on the good responses, the edge keeps serving the last good
 * response instead of the error (req 5.4).
 */
export const FAILURE_CACHE_CONTROL = "no-store";

/**
 * Cache-Control for a successful response whose HTML differs per visitor.
 *
 * A blog post's HTML page carries the reader-counts widget and the comments
 * section only for visitors their flags (`readerCounts`, `comments`) are on
 * for, decided from the `vid` cookie. CloudFront's cache key is `Accept` only
 * (no cookie), so caching that page would serve one visitor's version to
 * everyone. `private, no-store` keeps it out of the edge cache, so every
 * request re-runs the flag decision.
 *
 * Until 2026-10-13 every dynamic route sent this while the `renderFromBackend`
 * rollout ran. With that flag gone only the per-visitor pages still need it.
 */
export const PER_VISITOR_CACHE_CONTROL = "private, no-store";

/**
 * Selects the Cache-Control a successful dynamic-route response should carry:
 * {@link PER_VISITOR_CACHE_CONTROL} when the page differs per visitor,
 * otherwise the edge-cacheable {@link DYNAMIC_CACHE_CONTROL}.
 */
export function successCacheControl(perVisitor: boolean): string {
  return perVisitor ? PER_VISITOR_CACHE_CONTROL : DYNAMIC_CACHE_CONTROL;
}
