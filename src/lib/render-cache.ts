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
 * Cache-Control for a successful dynamic-route response WHILE THE ROLLOUT FLAG
 * IS ACTIVE.
 *
 * Feature: render-rollout-flag (Part 2, Step 8).
 *
 * During the rollout the flag decision is per visitor (keyed on the `vid`
 * cookie), but {@link DYNAMIC_CACHE_CONTROL}'s `s-maxage=300` lets CloudFront
 * serve one cached object to every visitor for five minutes with a cache key of
 * `Accept` only (no cookie). The first visitor's version would then be served
 * to everyone hitting that cached object, and the flag would never re-evaluate
 * for them. `private, no-store` makes the edge cache nothing for the dynamic
 * routes, so every request re-runs the flag decision and a rollback takes
 * effect immediately.
 *
 * The trade-off is that {@link DYNAMIC_CACHE_CONTROL}'s `stale-if-error` outage
 * protection is off while the rollout runs, because nothing is cached to serve;
 * the CloudFront origin-group failover (the S3 origin behind the render origin)
 * is the safety net that replaces it during the rollout. Once the flag is
 * removed (Step 11), {@link DYNAMIC_CACHE_CONTROL} is restored.
 */
export const ROLLOUT_CACHE_CONTROL = "private, no-store";

/**
 * Selects the Cache-Control a successful dynamic-route response should carry.
 *
 * While the rollout is active (the `RENDER_ROLLOUT_ACTIVE` environment flag is
 * `"1"`), a good render must not be edge-cached, because the flag decision is
 * per visitor; see {@link ROLLOUT_CACHE_CONTROL}. Otherwise the normal
 * edge-cacheable {@link DYNAMIC_CACHE_CONTROL} applies.
 */
export function successCacheControl(
  rolloutActive: boolean = process.env.RENDER_ROLLOUT_ACTIVE === "1",
): string {
  return rolloutActive ? ROLLOUT_CACHE_CONTROL : DYNAMIC_CACHE_CONTROL;
}
