/**
 * Unit tests for the off-path baked-page server.
 *
 * Feature: render-rollout-flag.
 *
 * S3 is stubbed with a tiny fake so the read/headers/404 behaviour is proven
 * without a network. The full byte-identical parity against a real baked object
 * is proven by the Docker runtime proof; this guards the header contract, the
 * key mapping, and the missing/unknown behaviours.
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { NoSuchKey } from "@aws-sdk/client-s3";

import {
  RENDER_PATH_HEADER,
  RENDER_PATH_STATIC,
  serveBakedPage,
} from "./off-path-render.ts";

type FakeObject = Readonly<{ body: string }>;

function fakeS3(objects: Record<string, FakeObject>): {
  send: (command: { input: { Key?: string } }) => Promise<unknown>;
} {
  return {
    send: async (command: { input: { Key?: string } }) => {
      const key = command.input.Key ?? "";
      const object = objects[key];
      if (object === undefined) {
        throw new NoSuchKey({ message: "missing", $metadata: {} });
      }
      const bytes = Buffer.from(object.body, "utf8");
      return {
        Body: {
          transformToByteArray: async () => new Uint8Array(bytes),
        },
      };
    },
  };
}

const client = (objects: Record<string, FakeObject>) =>
  // The fake matches the surface serveBakedPage uses (send + GetObjectCommand).
  fakeS3(objects) as unknown as import("@aws-sdk/client-s3").S3Client;

test("serves the baked HTML for a clean route with the static marker", async () => {
  const s3 = client({ "talks/index.html": { body: "<html>talks</html>" } });
  const response = await serveBakedPage(
    s3,
    "site-bucket",
    "/talks/",
    "private, no-store",
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get(RENDER_PATH_HEADER), RENDER_PATH_STATIC);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("Content-Type") ?? "", /text\/html/);
  assert.equal(await response.text(), "<html>talks</html>");
});

test("serves the baked Markdown alternate with the markdown content type", async () => {
  const s3 = client({ "talks/index.md": { body: "# talks" } });
  const response = await serveBakedPage(
    s3,
    "site-bucket",
    "/talks/index.md",
    "private, no-store",
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /text\/markdown/);
  assert.equal(await response.text(), "# talks");
});

test("returns 404 for a route the off path does not own", async () => {
  const s3 = client({});
  const response = await serveBakedPage(
    s3,
    "site-bucket",
    "/about/",
    "private, no-store",
  );
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("returns 404 when the baked object is missing (clean not-found)", async () => {
  const s3 = client({});
  const response = await serveBakedPage(
    s3,
    "site-bucket",
    "/talks/",
    "private, no-store",
  );
  assert.equal(response.status, 404);
});
