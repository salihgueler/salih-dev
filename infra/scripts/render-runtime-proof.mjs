/**
 * Render Lambda runtime proof for the render-rollout-flag feature.
 *
 * Runs INSIDE the real AWS Lambda Node 24 arm64 image (public.ecr.aws), with
 * `--network none`, so the built SSR server and the flag helper run on the same
 * runtime as production and nothing reaches the internet. It stands up two
 * loopback stubs and drives the built handler (`./index.mjs`) directly:
 *
 * - an S3 stub on 127.0.0.1 (pointed at via AWS_ENDPOINT_URL_S3) that serves the
 *   content objects the on-path render reads AND the baked pages the off path
 *   reads;
 * - an AppConfig Agent stub on 127.0.0.1:2772 that answers the flag read with a
 *   chosen `enabled` value; when it is NOT started, the flag read fails to
 *   connect (the "extension down" case), which must fall to the off path.
 *
 * Scenarios proven:
 *   1. flag ON      -> the render Lambda renders /talks/ through Astro
 *                      (x-render-path: lambda), status 200.
 *   2. flag OFF     -> the baked /talks/ page is served byte-identically
 *                      (x-render-path: static), status 200.
 *   3. extension down -> no agent on 2772; the handler falls to the baked page.
 *   4. cookie mint  -> a request without a vid cookie gets a Set-Cookie with
 *                      Secure; HttpOnly; SameSite=Lax.
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

// The S3 objects the stub serves, keyed by "<bucket>/<key>".
const OBJECTS = new Map([
  [`${CONTENT_BUCKET}/site/content.v1.json`, SITE_CONTENT],
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
    // The agent nests each flag's attributes under its own key.
    res.end(JSON.stringify({ renderFromBackend: { enabled } }));
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
  process.env.RENDER_ROLLOUT_ACTIVE = "1";
  process.env.APPCONFIG_APPLICATION = "salih-dev";
  process.env.APPCONFIG_ENVIRONMENT = "production";
  process.env.APPCONFIG_PROFILE = "render-flags";

  const { handler } = await import("./index.mjs");
  const results = {};

  // 1. flag ON -> Astro render (x-render-path: lambda).
  let agent = await startAgentStub(true);
  const on = await invoke(handler, "/talks/");
  const onBody = on.isBase64Encoded
    ? Buffer.from(on.body ?? "", "base64").toString("utf8")
    : on.body;
  results.flag_on = {
    status: on.statusCode,
    renderPath: headerOf(on, "x-render-path"),
    bodyPreview: (onBody ?? "").slice(0, 300),
    astroRendered:
      on.statusCode === 200 && headerOf(on, "x-render-path") === "lambda",
  };
  await new Promise((r) => agent.close(r));

  // 2. flag OFF -> baked page (x-render-path: static), byte-identical.
  agent = await startAgentStub(false);
  const off = await invoke(handler, "/talks/");
  const offBody = off.isBase64Encoded
    ? Buffer.from(off.body, "base64").toString("utf8")
    : off.body;
  results.flag_off = {
    status: off.statusCode,
    renderPath: headerOf(off, "x-render-path"),
    byteIdenticalToBaked: offBody === BAKED_TALKS_HTML,
  };
  await new Promise((r) => agent.close(r));

  // 3. extension DOWN (no agent) -> off path (baked page).
  const down = await invoke(handler, "/talks/");
  const downBody = down.isBase64Encoded
    ? Buffer.from(down.body, "base64").toString("utf8")
    : down.body;
  results.extension_down = {
    status: down.statusCode,
    renderPath: headerOf(down, "x-render-path"),
    servedBaked: downBody === BAKED_TALKS_HTML,
  };

  // 4. cookie mint when missing (off path, no agent).
  const minted = await invoke(handler, "/talks/");
  const setCookie = minted.cookies ?? [];
  const vidCookie = setCookie.find((c) => c.startsWith("vid="));
  results.cookie_mint = {
    setCookiePresent: vidCookie !== undefined,
    attributes: vidCookie ?? null,
  };

  await new Promise((r) => s3.close(r));
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`PROOF ERROR: ${error?.stack ?? error}\n`);
  process.exit(1);
});
