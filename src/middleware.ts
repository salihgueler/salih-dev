import { defineMiddleware } from "astro:middleware";
import type { APIContext, MiddlewareNext } from "astro";

import { S3Client } from "@aws-sdk/client-s3";

import { withSiteContent } from "./config/site-content-source";
import { withPublishedPosts } from "./lib/blog/posts-source";
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
  resolvePublishedPostsFromS3,
  resolvePublishedTalksFromS3,
  resolveSiteContentScope,
} from "./lib/render-content";
import { withPublishedTalksSnapshot } from "./lib/talks/gateway-astro";

/**
 * The dynamic routes and the content each needs at request time.
 *
 * Every page's layout embeds the location in its JSON-LD, so every HTML route
 * and every listing that embeds a page document reads the site content. The
 * home page and its Markdown alternate also list the latest posts. `talks`
 * routes need the published talk snapshot; blog, category, and tag routes need
 * the published posts. The machine-readable listings combine sources:
 * `rss.xml`, `sitemap.xml`, `llms.txt`, and `llms-full.txt` read posts and
 * talks. Nothing here falls back to content baked into the bundle. The pathname
 * is the resolved origin-request path the CloudFront viewer-request function
 * produces.
 */
type RouteNeeds = Readonly<{ site: boolean; talks: boolean; posts: boolean }>;

const BLOG_PATH =
  /^\/(blog|categories|tags)(\/|\/[^/]+\/|\/[^/]+\.md)?$/;

function routeNeeds(pathname: string): RouteNeeds | null {
  if (pathname === "/" || pathname === "/index.md") {
    return { site: true, talks: false, posts: true };
  }
  if (pathname === "/talks/" || pathname === "/talks/index.md") {
    return { site: true, talks: true, posts: false };
  }
  // Blog index/post, category, and tag routes (HTML and `.md` alternate).
  if (
    pathname === "/blog/" ||
    pathname === "/blog/index.md" ||
    BLOG_PATH.test(pathname)
  ) {
    return { site: true, talks: false, posts: true };
  }
  if (
    pathname === "/rss.xml" ||
    pathname === "/sitemap.xml" ||
    pathname === "/llms.txt" ||
    pathname === "/llms-full.txt"
  ) {
    return { site: true, talks: true, posts: true };
  }
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
 * the override visible to them. A missing content object is a read failure,
 * never a fall back to packaged defaults; a successful render carries an
 * edge-cacheable Cache-Control
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
  const needs = routeNeeds(context.url.pathname);
  if (needs === null) return next();

  const bucket = process.env.CONTENT_BUCKET_NAME;
  if (bucket === undefined || bucket === "") {
    return failure(500, "render configuration error");
  }

  const today =
    process.env.SITE_CONTENT_TODAY ?? new Date().toISOString().slice(0, 10);

  let rendered: Response;
  try {
    // Resolve every override this route needs from S3 first, so a read or
    // validation failure becomes a 5xx here rather than a rejection surfacing
    // mid-render. Then nest the request scopes so each reader (site config,
    // talks gateway, posts) sees the request's content through its own seam.
    const [scope, talks, posts] = await Promise.all([
      needs.site ? resolveSiteContentScope(s3(), bucket, today) : null,
      needs.talks ? resolvePublishedTalksFromS3(s3(), bucket) : null,
      needs.posts ? resolvePublishedPostsFromS3(s3(), bucket) : null,
    ]);

    let run = (): Response | Promise<Response> => next();
    if (scope !== null) {
      const inner = run;
      run = () => withSiteContent(scope, inner);
    }
    if (talks !== null) {
      const inner = run;
      run = () => withPublishedTalksSnapshot(Promise.resolve(talks), inner);
    }
    if (posts !== null) {
      const inner = run;
      run = () => withPublishedPosts(posts, inner);
    }
    rendered = await run();
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
