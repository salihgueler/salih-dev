import assert from "node:assert/strict";
import test from "node:test";

import {
  viewerDeckRequestCode,
  viewerImageRequestCode,
  viewerRequestCode,
  viewerResponseCode,
} from "../lib/edge-functions";

type Header = { value: string };
type Request = {
  headers: Record<string, Header>;
  querystring: Record<string, Header>;
  uri: string;
};
type Response = {
  headers: Record<string, Header>;
  statusCode: number;
};

function requestHandler() {
  return new Function(
    `${viewerRequestCode("salih.dev")}; return handler;`,
  )() as (event: { request: Request }) => Request | Response;
}

function responseHandler() {
  return new Function(
    `${viewerResponseCode("salih.dev")}; return handler;`,
  )() as (event: { request: Request; response: Response }) => Response;
}

function deckHandler() {
  return new Function(
    `${viewerDeckRequestCode("salih.dev")}; return handler;`,
  )() as (event: { request: Request }) => Request | Response;
}

const DECK_ID = "11111111-2222-4333-8444-555555555555";

function request(uri: string, accept = "text/html"): Request {
  return {
    headers: {
      accept: { value: accept },
      host: { value: "salih.dev" },
    },
    querystring: {},
    uri,
  };
}

test("rewrites clean HTML paths to S3 index objects", () => {
  const result = requestHandler()({ request: request("/about/") }) as Request;
  assert.equal(result.uri, "/about/index.html");
});

test("negotiates Markdown before the cache lookup", () => {
  const result = requestHandler()({
    request: request(
      "/blog/static-astro/",
      "text/html;q=0.5, text/markdown;q=1",
    ),
  }) as Request;

  assert.equal(result.uri, "/blog/static-astro.md");
});

test("does not negotiate Markdown when HTML is preferred", () => {
  const result = requestHandler()({
    request: request(
      "/blog/static-astro/",
      "text/html;q=1, text/markdown;q=0.5",
    ),
  }) as Request;

  assert.equal(result.uri, "/blog/static-astro/index.html");
});

test("redirects www to the apex and keeps query parameters", () => {
  const input = request("/about/");
  input.headers.host.value = "www.salih.dev";
  input.querystring = { source: { value: "newsletter" } };
  const result = requestHandler()({ request: input }) as Response;

  assert.equal(result.statusCode, 301);
  assert.equal(
    result.headers.location.value,
    "https://salih.dev/about/?source=newsletter",
  );
});

test("advertises canonical and alternate representations", () => {
  const result = responseHandler()({
    request: request("/blog/static-astro.md", "text/markdown"),
    response: {
      headers: {},
      statusCode: 200,
    },
  });

  assert.equal(result.headers.vary.value, "Accept");
  assert.match(
    result.headers.link.value,
    /<https:\/\/salih\.dev\/blog\/static-astro\/>; rel="canonical"/,
  );
  assert.match(
    result.headers.link.value,
    /<https:\/\/salih\.dev\/blog\/static-astro\.md>; rel="alternate"/,
  );
  assert.match(result.headers.link.value, /api\/catalog\.json/);
});

test("rewrites a valid deck slide path to the talks/decks S3 key", () => {
  const result = deckHandler()({
    request: request(`/talks/slides/api/${DECK_ID}.pdf`),
  }) as Request;
  assert.equal(result.uri, `/talks/decks/${DECK_ID}.pdf`);
});

test("404s a slide path that is not the exact deck-id shape", () => {
  for (const uri of [
    "/talks/slides/api/not-a-uuid.pdf",
    "/talks/slides/api/",
    `/talks/slides/api/${DECK_ID}.PDF`,
    `/talks/slides/api/${DECK_ID}.pdf.json`,
  ]) {
    const result = deckHandler()({ request: request(uri) }) as Response;
    assert.equal(result.statusCode, 404, `expected 404 for ${uri}`);
  }
});

test("does not serve a deck to a www host", () => {
  const input = request(`/talks/slides/api/${DECK_ID}.pdf`);
  input.headers.host.value = "www.salih.dev";
  const result = deckHandler()({ request: input }) as Response;
  assert.equal(result.statusCode, 404);
});

function imageHandler() {
  return new Function(
    `${viewerImageRequestCode("salih.dev")}; return handler;`,
  )() as (event: { request: Request }) => Request | Response;
}

test("rewrites a blog image path to the images/ content-bucket key", () => {
  const result = imageHandler()({
    request: request("/images/blog/3405099-cover.webp"),
  }) as Request;
  assert.equal(result.uri, "/images/3405099-cover.webp");
});

test("404s an image path with traversal or the wrong prefix", () => {
  for (const uri of [
    "/images/blog/../../site/content.v1.json",
    "/images/other/x.webp",
    "/images/blog/",
  ]) {
    const result = imageHandler()({ request: request(uri) }) as Response;
    assert.equal(result.statusCode, 404, `expected 404 for ${uri}`);
  }
});
