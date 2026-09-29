/**
 * Off-path renderer: serves the baked static page from the site bucket.
 *
 * Feature: render-rollout-flag (Parts 1 and 2 of the AppConfig rollout)
 *
 * When the `renderFromBackend` flag is off for a visitor, the render Lambda does
 * NOT render through Astro. It reads the page the static publisher already baked
 * into the site bucket for the requested route and returns it with the same
 * representation and security headers the site serves today, plus the
 * `x-render-path: static` marker so the served path is observable.
 *
 * The off path only works because the static build still bakes these routes
 * (`src/lib/dynamic-route.ts` defaults the prerender sentinel to `true`; only the
 * render-Lambda build flips it to `false`), so the baked object is always there
 * to fall back to.
 *
 * S3 access is read-only: `s3:GetObject` on exactly the baked dynamic-route
 * keys, plus the prefix-scoped `s3:ListBucket` the render role already holds, so
 * a missing key surfaces as a clean 404 rather than an AccessDenied masked as a
 * 500.
 */

import {
  GetObjectCommand,
  NoSuchKey,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import { contentSignal } from "./discovery";
import {
  bakedKeyForPath,
  contentTypeForKey,
} from "./off-path-key";

/** The header name that names which path served a response. */
export const RENDER_PATH_HEADER = "x-render-path";

/** The `x-render-path` value for a baked static response. */
export const RENDER_PATH_STATIC = "static";

/** The `x-render-path` value for an Astro-rendered response. */
export const RENDER_PATH_LAMBDA = "lambda";

/**
 * Serves the baked static page for a dynamic route from the site bucket.
 *
 * Returns the baked object with the site's representation and security headers,
 * a 404 when the route is unknown or the object is missing, and a `no-store`
 * 5xx that the edge will not cache on a read failure (so the origin-group
 * failover to S3 can take over during the rollout).
 *
 * @param cacheControl the Cache-Control to apply (the rollout `private,
 *   no-store` while the flag is active).
 */
export async function serveBakedPage(
  client: S3Client,
  bucket: string,
  pathname: string,
  cacheControl: string,
): Promise<Response> {
  const key = bakedKeyForPath(pathname);
  if (key === null) {
    return new Response("not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let body: Uint8Array<ArrayBuffer>;
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (bytes === undefined) {
      // An empty body is a read failure, not content; do not cache it.
      return new Response("render error", {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      });
    }
    // Copy into a plain-ArrayBuffer-backed view so the bytes satisfy BodyInit
    // (a SharedArrayBuffer-backed Uint8Array is not a valid Response body).
    body = new Uint8Array(bytes);
  } catch (error) {
    // A missing baked key is a clean 404 (the prefix-scoped ListBucket grant
    // lets S3 answer NoSuchKey instead of AccessDenied).
    if (
      error instanceof NoSuchKey ||
      (error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404)
    ) {
      return new Response("not found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    // Any other read failure is an uncacheable 5xx; the origin-group failover
    // serves S3 directly during the rollout.
    return new Response("render error", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const headers = new Headers({
    "Cache-Control": cacheControl,
    "Content-Type": contentTypeForKey(key),
    "Content-Signal": contentSignal,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    [RENDER_PATH_HEADER]: RENDER_PATH_STATIC,
  });
  return new Response(body, { status: 200, headers });
}
