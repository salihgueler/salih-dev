/**
 * Request-scoped site-content source.
 *
 * Feature: backend-served-content
 *
 * The Location and the Events are the only mutable parts of the otherwise
 * static site configuration. The static build resolves them once from the
 * packaged default (or `SITE_CONTENT_PATH`) and bakes them; the request-time
 * renderer instead resolves them per request from the content bucket, so a
 * `PUT /v1/content` write is live in seconds.
 *
 * This module is the single seam that lets both callers share the same
 * `site` configuration and the same `.astro` components. It holds an
 * {@link AsyncLocalStorage} override that the render path sets for the duration
 * of one request; every reader (`site.location`, `site.conferences`, the home
 * Markdown document, the `homeLocation` JSON-LD) resolves through
 * {@link resolveSiteContent}, which returns the override when one is active and
 * the build-time default otherwise.
 *
 * The default is resolved eagerly at module load exactly as before, so the
 * static build's output is byte-for-byte unchanged: with no override active,
 * `resolveSiteContent()` returns the same validated content the old top-level
 * `const` exposed. The override is read-only within its scope, so a request can
 * never mutate shared state.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AsyncLocalStorage } from "node:async_hooks";

import fallbackContent from "./site-content.default.json";
import { parseSiteContent, type SiteContent } from "./site-content-schema";

/** One request's resolved content plus the day used to classify its events. */
export type SiteContentScope = Readonly<{
  content: SiteContent;
  today: string;
}>;

const overrideStorage = new AsyncLocalStorage<SiteContentScope>();

/**
 * The build-time content: `SITE_CONTENT_PATH` when set, else the packaged
 * default. Resolved once at module load, exactly as the previous top-level
 * `const` did, so the static build's output does not change.
 */
const defaultContent: SiteContent = (() => {
  const sourcePath = process.env.SITE_CONTENT_PATH;
  const raw: unknown = sourcePath
    ? JSON.parse(readFileSync(resolve(process.cwd(), sourcePath), "utf8"))
    : fallbackContent;
  return parseSiteContent(raw);
})();

/** The day used to classify events into upcoming and recent, build-time. */
const defaultToday = (): string =>
  process.env.SITE_CONTENT_TODAY ?? new Date().toISOString().slice(0, 10);

/**
 * Runs `callback` with a request-scoped content override in effect.
 *
 * The render path parses the content object it read from S3, then renders the
 * dynamic route inside this scope so every content reader sees the request's
 * content instead of the build-time default. The scope is unwound when the
 * callback settles, so no request leaks content into another.
 */
export function withSiteContent<T>(
  scope: SiteContentScope,
  callback: () => T,
): T {
  return overrideStorage.run(scope, callback);
}

/** The build-time content default: `SITE_CONTENT_PATH` or the packaged JSON. */
export function defaultSiteContent(): SiteContent {
  return defaultContent;
}

/** The active request's content, or the build-time default. */
export function resolveSiteContent(): SiteContent {
  return overrideStorage.getStore()?.content ?? defaultContent;
}

/** The active request's classification day, or the build-time default. */
export function resolveSiteContentToday(): string {
  return overrideStorage.getStore()?.today ?? defaultToday();
}
