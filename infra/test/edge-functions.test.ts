import assert from "node:assert/strict";
import test from "node:test";

import {
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
