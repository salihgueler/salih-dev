/**
 * Contract tests for the request-time render handler's API Gateway bridge.
 *
 * Feature: backend-served-content
 *
 * The handler wraps the Astro SSR server that the official `@astrojs/node`
 * adapter builds; that server only exists after `scripts/build-render-lambda.mjs`
 * assembles the deployment package, so these tests cover the parts of the
 * handler that do NOT require the built server: the HTTP method gate and the
 * request-shape handling that runs before the server is loaded.
 *
 * The full four-route rendering (talks HTML with cards/filters/JSON-LD, talks
 * Markdown, home HTML with location/events, home Markdown) is proven against the
 * real Node 24 arm64 Lambda runtime image by the Docker runtime proof, which
 * loads the actual built server with stubbed S3 content. A unit test here cannot
 * load that server without building it, so it does not pretend to.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

import { handler } from "../functions/render.js";

function event(method: string, rawPath: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath,
    rawQueryString: "",
    headers: { accept: "text/html" },
    requestContext: {
      http: {
        method,
        path: rawPath,
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.1",
        userAgent: "test",
      },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

test("rejects a non-GET/HEAD method with 405 before loading the server", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const response = (await handler(
      event(method, "/talks/"),
      {} as Context,
      () => undefined,
    )) as { statusCode: number; headers?: Record<string, string> };
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers?.allow, "GET, HEAD");
  }
});

test("a GET without the built server returns a 5xx the edge will not cache as success", async (t) => {
  // The server entry is absent in the source tree, so loadServerHandler throws
  // and the handler must surface a 500 rather than a 200. This proves the
  // load-failure path returns an uncacheable server error.
  const previousError = console.error;
  console.error = () => undefined;
  t.after(() => {
    console.error = previousError;
  });

  const response = (await handler(
    event("GET", "/talks/"),
    {} as Context,
    () => undefined,
  )) as { statusCode: number };
  assert.ok(
    response.statusCode >= 500,
    `expected a 5xx when the server cannot load, got ${response.statusCode}`,
  );
});
