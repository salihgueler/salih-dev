/**
 * Unit tests for the off-path baked-key mapper.
 *
 * Feature: render-rollout-flag.
 *
 * The expected keys were verified against a real `npm run build` dist tree.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  bakedKeyForPath,
  contentTypeForKey,
  OFF_PATH_KEY_PATTERNS,
} from "./off-path-key.ts";

test("maps the exact dynamic-route paths to their baked keys", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["/", "index.html"],
    ["/index.md", "index.md"],
    ["/talks/", "talks/index.html"],
    ["/talks/index.md", "talks/index.md"],
    ["/blog/", "blog/index.html"],
    ["/blog/index.md", "blog/index.md"],
    ["/rss.xml", "rss.xml"],
    ["/sitemap.xml", "sitemap.xml"],
    ["/llms.txt", "llms.txt"],
    ["/llms-full.txt", "llms-full.txt"],
  ];
  for (const [path, key] of cases) {
    assert.equal(bakedKeyForPath(path), key, `path ${path}`);
  }
});

test("maps blog/category/tag item paths (HTML and .md alternate)", () => {
  assert.equal(
    bakedKeyForPath("/blog/how-i-built-a-flame-engine-mcp-server-3ea2/"),
    "blog/how-i-built-a-flame-engine-mcp-server-3ea2/index.html",
  );
  assert.equal(
    bakedKeyForPath("/blog/how-i-built-a-flame-engine-mcp-server-3ea2.md"),
    "blog/how-i-built-a-flame-engine-mcp-server-3ea2.md",
  );
  assert.equal(
    bakedKeyForPath("/categories/serverless/"),
    "categories/serverless/index.html",
  );
  assert.equal(bakedKeyForPath("/categories/serverless.md"), "categories/serverless.md");
  assert.equal(bakedKeyForPath("/tags/ai/"), "tags/ai/index.html");
  assert.equal(bakedKeyForPath("/tags/ai.md"), "tags/ai.md");
});

test("returns null for a path the off path does not own", () => {
  assert.equal(bakedKeyForPath("/about/"), null);
  assert.equal(bakedKeyForPath("/contact/"), null);
  assert.equal(bakedKeyForPath("/api/catalog.json"), null);
  assert.equal(bakedKeyForPath("/skills/"), null);
  assert.equal(bakedKeyForPath("/talks"), null); // un-normalized; the render fn adds the slash
});

test("infers the content type from the key suffix", () => {
  assert.match(contentTypeForKey("talks/index.html"), /text\/html/);
  assert.match(contentTypeForKey("talks/index.md"), /text\/markdown/);
  assert.match(contentTypeForKey("rss.xml"), /application\/xml/);
  assert.match(contentTypeForKey("llms.txt"), /text\/plain/);
});

test("the IAM key patterns cover every mapped key prefix", () => {
  // Every key the mapper can return must be covered by one of the patterns the
  // render role's GetObject grant is scoped to.
  const matches = (key: string): boolean =>
    OFF_PATH_KEY_PATTERNS.some((pattern) => {
      if (pattern.endsWith("/*")) return key.startsWith(pattern.slice(0, -1));
      return pattern === key;
    });
  for (const path of [
    "/",
    "/index.md",
    "/talks/",
    "/talks/index.md",
    "/blog/",
    "/blog/x/",
    "/categories/y.md",
    "/tags/z/",
    "/rss.xml",
    "/sitemap.xml",
    "/llms.txt",
    "/llms-full.txt",
  ]) {
    const key = bakedKeyForPath(path);
    assert.ok(key !== null, `path ${path} maps to a key`);
    assert.ok(matches(key), `key ${key} is covered by an IAM pattern`);
  }
});
