/**
 * Pins the dynamic-route Cache-Control contract.
 *
 * Feature: backend-served-content
 *
 * These assert the exact header values the render middleware applies. The
 * end-to-end behaviour (a 200 carrying the success header, a `no-store` 5xx when
 * the S3 read fails) is proven against the real render bridge by the Docker
 * runtime proof; this test guards the string contract so a regression is caught
 * by `npm test` without Docker.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DYNAMIC_CACHE_CONTROL,
  FAILURE_CACHE_CONTROL,
  ROLLOUT_CACHE_CONTROL,
  successCacheControl,
} from "./render-cache.ts";

/** Parses a Cache-Control value into a directive map (flags map to true). */
function directives(value: string): Map<string, string | true> {
  const map = new Map<string, string | true>();
  for (const part of value.split(",")) {
    const token = part.trim();
    if (token === "") continue;
    const eq = token.indexOf("=");
    if (eq === -1) map.set(token.toLowerCase(), true);
    else map.set(token.slice(0, eq).toLowerCase(), token.slice(eq + 1));
  }
  return map;
}

test("the success Cache-Control enables edge caching, background refresh, and stale-if-error", () => {
  const d = directives(DYNAMIC_CACHE_CONTROL);
  assert.ok(d.has("public"), "must be publicly cacheable at the edge");
  // req 5.5: the browser must not hold content long enough to hide an
  // invalidated change, so max-age is zero (always revalidate in the browser).
  assert.equal(d.get("max-age"), "0");
  // req 5.1: the edge caches for a bounded window without re-invoking the Lambda.
  assert.equal(d.get("s-maxage"), "300");
  assert.equal(d.get("stale-while-revalidate"), "60");
  // req 5.3: the edge serves the last good response for a bounded staleness
  // window if the origin or S3 is briefly unavailable.
  assert.equal(d.get("stale-if-error"), "86400");
});

test("s-maxage sits within the render cache policy TTL bounds and under the stale window", () => {
  const d = directives(DYNAMIC_CACHE_CONTROL);
  const sMaxAge = Number(d.get("s-maxage"));
  const staleIfError = Number(d.get("stale-if-error"));
  // minTtl 0, maxTtl 24h on RenderCachePolicy; s-maxage must fall inside.
  assert.ok(sMaxAge >= 0 && sMaxAge <= 86400);
  // The max TTL (86400s) is at least the stale-if-error window so CloudFront
  // honours the full window rather than truncating it.
  assert.ok(staleIfError <= 86400);
});

test("the failure Cache-Control is no-store so the edge never caches an error", () => {
  assert.equal(FAILURE_CACHE_CONTROL, "no-store");
  assert.equal(directives(FAILURE_CACHE_CONTROL).get("no-store"), true);
});

test("the rollout Cache-Control is private, no-store so the flag decision runs per request", () => {
  const d = directives(ROLLOUT_CACHE_CONTROL);
  assert.equal(d.get("no-store"), true);
  assert.equal(d.get("private"), true);
});

test("successCacheControl picks the rollout header while active and the edge header otherwise", () => {
  assert.equal(successCacheControl(true), ROLLOUT_CACHE_CONTROL);
  assert.equal(successCacheControl(false), DYNAMIC_CACHE_CONTROL);
});
