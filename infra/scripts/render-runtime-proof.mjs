/**
 * Render Lambda runtime proof.
 *
 * Runs INSIDE the real AWS Lambda Node 24 arm64 image (public.ecr.aws), with
 * `--network none`, so the built SSR server and the flag helper run on the same
 * runtime as production and nothing reaches the internet. It stands up two
 * loopback stubs and drives the built handler (`./index.mjs`) directly:
 *
 * - an S3 stub on 127.0.0.1 (pointed at via AWS_ENDPOINT_URL_S3) that serves the
 *   content objects the render reads AND the baked pages the fallback reads;
 * - an AppConfig Agent stub on 127.0.0.1:2772 that answers flag reads with a
 *   chosen `enabled` value; when it is NOT started, the flag read fails to
 *   connect (the "extension down" case).
 *
 * The `renderFromBackend` flag was removed on 2026-10-13. Scenarios proven:
 *   1. shared page  -> /talks/ renders through Astro (x-render-path: lambda)
 *                      with the edge-cacheable Cache-Control and no Set-Cookie,
 *                      even with no AppConfig agent running.
 *   2. per-visitor  -> a blog post page renders its compiled body, sends
 *                      `private, no-store` and mints a vid cookie with Secure;
 *                      HttpOnly; SameSite=Lax. The blog index lists the post.
 *   3. read failure -> /talks/ with the content object missing falls back to
 *                      the baked page (x-render-path: static).
 *
 * Usage (inside the container): node render-runtime-proof.mjs
 * The package (index.mjs + server/ + client/) is mounted at /var/task.
 */

import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const CONTENT_BUCKET = "content-bucket";
const SITE_BUCKET = "site-bucket";

// Minimal fixtures. The site content and a talk record let the on-path render
// produce a real page; the baked object lets the off path serve one. The site
// content is the repo's real schema-valid default, copied next to this script
// before the container runs (the on-path render validates it strictly, so a
// hand-written stub would be rejected and the on path could not be proven).
const SITE_CONTENT = readFileSync(
  new URL("./site-content.default.json", import.meta.url),
  "utf8",
);
const BAKED_TALKS_HTML =
  "<!doctype html><html><head><title>Talks</title></head><body><h1>Talks (baked)</h1></body></html>";

// One schema-valid blog post, so a post page renders its compiled body.
const POST_BODY = [
  "---",
  "title: Proof post",
  "description: A description.",
  "pubDate: 2026-06-18",
  "category: Testing",
  "tags:",
  "  - alpha",
  "hero:",
  "  src: https://salih.dev/images/blog/x.webp",
  "  alt: Alt",
  "  credit: Someone",
  "  creditUrl: https://example.com/",
  "aiSummary: A summary.",
  "---",
  "",
  "Some **markdown** in the proof post.",
  "",
].join("\n");

// The S3 objects the stub serves, keyed by "<bucket>/<key>".
const OBJECTS = new Map([
  [`${CONTENT_BUCKET}/site/content.v1.json`, SITE_CONTENT],
  [`${CONTENT_BUCKET}/posts/some-post.md`, POST_BODY],
  [`${SITE_BUCKET}/talks/index.html`, BAKED_TALKS_HTML],
]);

/** A tiny S3 GET/LIST stub: enough for the render path's reads. */
function startS3Stub() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    // Path-style: /<bucket>/<key...>. ListObjectsV2 uses ?list-type=2&prefix=.
    const parts = url.pathname.replace(/^\//, "").split("/");
    const bucket = parts.shift() ?? "";
    const key = parts.join("/");

    if (url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = [...OBJECTS.keys()]
        .filter((k) => k.startsWith(`${bucket}/`))
        .map((k) => k.slice(bucket.length + 1))
        .filter((k) => k.startsWith(prefix));
      const contents = keys
        .map((k) => `<Contents><Key>${k}</Key></Contents>`)
        .join("");
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
          `<Name>${bucket}</Name><Prefix>${prefix}</Prefix>` +
          `<KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys>` +
          `<IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
      );
      return;
    }

    const body = OBJECTS.get(`${bucket}/${key}`);
    if (body === undefined) {
      res.writeHead(404, { "content-type": "application/xml" });
      res.end(
        `<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>`,
      );
      return;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      etag: `"${createHash("md5").update(body).digest("hex")}"`,
    });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** The AppConfig Agent stub on the fixed port 2772. */
function startAgentStub(enabled) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    // A single-flag read (?flag=renderFromBackend) returns the flag's
    // attributes at the top level, as the real agent does.
    res.end(JSON.stringify({ _variant: enabled ? "author" : "default", enabled }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(2772, "127.0.0.1", () => resolve(server));
  });
}

function event(path, cookie) {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {
      accept: "text/html",
      ...(cookie ? { cookie } : {}),
    },
    requestContext: {
      http: { method: "GET", path, protocol: "HTTP/1.1", sourceIp: "203.0.113.1", userAgent: "proof" },
    },
    isBase64Encoded: false,
  };
}

async function invoke(handler, path, cookie) {
  return handler(event(path, cookie), {}, () => undefined);
}

function headerOf(result, name) {
  const headers = result.headers ?? {};
  const found = Object.keys(headers).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return found ? headers[found] : undefined;
}

async function main() {
  const s3 = await startS3Stub();
  const s3Port = s3.address().port;
  process.env.AWS_ENDPOINT_URL_S3 = `http://127.0.0.1:${s3Port}`;
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  process.env.CONTENT_BUCKET_NAME = CONTENT_BUCKET;
  process.env.SITE_BUCKET_NAME = SITE_BUCKET;
  process.env.SALIH_DEV_SSR = "1";
  process.env.SITE_CONTENT_TODAY = "2026-09-29";
  process.env.APPCONFIG_APPLICATION = "salih-dev";
  process.env.APPCONFIG_ENVIRONMENT = "production";
  process.env.APPCONFIG_PROFILE = "render-flags";

  const { handler } = await import("./index.mjs");
  const results = {};
  const bodyOf = (r) =>
    r.isBase64Encoded ? Buffer.from(r.body ?? "", "base64").toString("utf8") : r.body ?? "";

  // 1. A shared page renders for everyone, edge-cacheable, without a cookie.
  //    No agent is running: the page must not depend on any flag read.
  const shared = await invoke(handler, "/talks/");
  results.shared_page = {
    status: shared.statusCode,
    renderPath: headerOf(shared, "x-render-path"),
    cacheControl: headerOf(shared, "cache-control"),
    setCookie: shared.cookies ?? [],
    bodyPreview: bodyOf(shared).slice(0, 120),
  };

  // 2. A blog post page differs per visitor: no-store, and it mints the vid.
  const agent = await startAgentStub(false);
  const post = await invoke(handler, "/blog/some-post/");
  results.per_visitor_page = {
    status: post.statusCode,
    cacheControl: headerOf(post, "cache-control"),
    setCookie: post.cookies ?? [],
    compiledBody: bodyOf(post).includes("<strong>markdown</strong>"),
  };

  // 2b. The blog index lists the post without compiling it.
  const index = await invoke(handler, "/blog/");
  results.blog_index = {
    status: index.statusCode,
    cacheControl: headerOf(index, "cache-control"),
    listsPost: bodyOf(index).includes("Proof post"),
  };
  await new Promise((r) => agent.close(r));

  // 3. The content read fails -> the baked page instead of a 502.
  OBJECTS.delete(`${CONTENT_BUCKET}/site/content.v1.json`);
  const readFail = await invoke(handler, "/talks/");
  results.read_failure = {
    status: readFail.statusCode,
    renderPath: headerOf(readFail, "x-render-path"),
    cacheControl: headerOf(readFail, "cache-control"),
    servedBaked: bodyOf(readFail) === BAKED_TALKS_HTML,
  };

  await new Promise((r) => s3.close(r));
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`PROOF ERROR: ${error?.stack ?? error}\n`);
  process.exit(1);
});
