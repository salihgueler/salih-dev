import { defineMiddleware } from "astro:middleware";
import type { APIContext, MiddlewareNext } from "astro";

import { S3Client } from "@aws-sdk/client-s3";

import { withSiteContent } from "./config/site-content-source";
import {
  canonicalUrl,
  contentSignal,
  explicitlyPrefersMarkdown,
  markdownAlternatePath,
} from "./lib/discovery";
import { markdownResponse } from "./lib/http";
import { markdownForPath } from "./lib/markdown-documents";
import {
  DYNAMIC_CACHE_CONTROL,
  FAILURE_CACHE_CONTROL,
} from "./lib/render-cache";
import {
  resolvePublishedTalksFromS3,
  resolveSiteContentScope,
} from "./lib/render-content";
import { withPublishedTalksSnapshot } from "./lib/talks/gateway-astro";

/**
 * The dynamic routes and the content each needs at request time.
 *
 * `home` routes need the site content (location + events); `talks` routes need
 * the published snapshot. The pathname is the resolved origin-request path the
 * CloudFront viewer-request function produces, so `/talks/index.md` reaches the
 * origin as `/talks/index.md` and `/` as `/`.
 */
type DynamicKind = "home" | "talks";

function dynamicKind(pathname: string): DynamicKind | null {
  if (pathname === "/" || pathname === "/index.md") return "home";
  if (pathname === "/talks/" || pathname === "/talks/index.md") return "talks";
  return null;
}

/** One shared S3 client per Lambda container. */
let s3Client: S3Client | null = null;
function s3(): S3Client {
  s3Client ??= new S3Client({});
  return s3Client;
}

/**
 * Cache-Control for a successful dynamic-route response and for a failed one
 * are defined in `./lib/render-cache` so they can be unit-tested without the
 * Astro virtual-module graph this middleware pulls in.
 */

/** Returns a copy of the response carrying the dynamic-route Cache-Control. */
function withDynamicCacheControl(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", DYNAMIC_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A 5xx the edge will not cache, so a transient failure never poisons it. */
function failure(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Cache-Control": FAILURE_CACHE_CONTROL },
  });
}

/**
 * The render Lambda's request-time seam.
 *
 * In the SSR build (render Lambda) this middleware reads the content the
 * requested dynamic route needs from the content bucket and runs the render
 * inside the request-scoped overrides, so the same `.astro` pages that read the
 * shared config and gateway produce live content. It runs inside the SSR bundle
 * and therefore shares module identity with those readers, which is what makes
 * the override visible to them. A missing content object falls back to the
 * packaged default; a successful render carries an edge-cacheable Cache-Control
 * with `stale-if-error`, and a read failure returns a `no-store` 5xx so the
 * edge keeps serving the last good response instead of caching the error.
 *
 * In the static build and in `astro dev` this branch is inert: the SSR flag is
 * off, so it keeps the previous dev-only Markdown negotiation and header
 * behavior unchanged and the production static build's output is untouched.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (process.env.SALIH_DEV_SSR === "1") {
    return renderDynamic(context, next);
  }

  // Production static-build request negotiation runs at CloudFront; the dev
  // server reproduces it here so local previews match.
  if (!import.meta.env.DEV) return next();

  const pathname = context.url.pathname;

  if (explicitlyPrefersMarkdown(context.request.headers.get("Accept"))) {
    const markdown = await markdownForPath(pathname);
    if (markdown) return markdownResponse(markdown, pathname);
  }

  return decorateHtml(context, await next());
});

/**
 * Resolves the dynamic route's content from S3 and renders inside the
 * request-scoped overrides. A missing bucket configuration or a hard read
 * failure returns a 5xx that CloudFront does not cache as a success.
 */
async function renderDynamic(
  context: APIContext,
  next: MiddlewareNext,
): Promise<Response> {
  const kind = dynamicKind(context.url.pathname);
  if (kind === null) return next();

  const bucket = process.env.CONTENT_BUCKET_NAME;
  if (bucket === undefined || bucket === "") {
    return failure(500, "render configuration error");
  }

  const today =
    process.env.SITE_CONTENT_TODAY ?? new Date().toISOString().slice(0, 10);

  let rendered: Response;
  try {
    if (kind === "home") {
      const scope = await resolveSiteContentScope(s3(), bucket, today);
      rendered = await withSiteContent(scope, () => next());
    } else {
      const snapshot = resolvePublishedTalksFromS3(s3(), bucket);
      // Await once here so a read/validation failure becomes a 5xx rather than
      // a rejected promise surfacing mid-render; the pages then read the
      // resolved snapshot synchronously through the override.
      await snapshot;
      rendered = await withPublishedTalksSnapshot(snapshot, () => next());
    }
  } catch {
    // The content bucket could not be read (or the content failed validation).
    // Return a 5xx the edge will not cache; with stale-if-error on the good
    // responses, CloudFront keeps serving the last good response instead.
    return failure(502, "render error");
  }

  // A render that itself produced a server error must not be cached as success.
  if (rendered.status >= 500) {
    return failure(rendered.status, "render error");
  }

  return withDynamicCacheControl(rendered);
}

/** Adds the representation and security headers the dev preview advertises. */
function decorateHtml(context: APIContext, response: Response): Response {
  const pathname = context.url.pathname;
  const headers = new Headers(response.headers);
  headers.set("Content-Signal", contentSignal);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const alternate = markdownAlternatePath(pathname);
  const contentType = headers.get("Content-Type") ?? "";
  if (alternate && response.ok && contentType.includes("text/html")) {
    headers.set("Vary", mergeVary(headers.get("Vary"), "Accept"));
    headers.append(
      "Link",
      `<${canonicalUrl(pathname)}>; rel="canonical"; type="text/html"`,
    );
    headers.append(
      "Link",
      `<${canonicalUrl(alternate)}>; rel="alternate"; type="text/markdown"`,
    );
    headers.append(
      "Link",
      `<${canonicalUrl("/api/catalog.json")}>; rel="service-desc"; type="application/json"`,
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function mergeVary(current: string | null, value: string): string {
  const values = new Set(
    (current ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  return [...values].join(", ");
}
