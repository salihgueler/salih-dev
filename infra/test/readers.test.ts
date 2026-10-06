import assert from "node:assert/strict";
import test from "node:test";

import {
  handleReaders,
  parseBody,
  slugFromPath,
  vidFromEvent,
  type ReadersDeps,
  type ReadersEvent,
} from "../functions/readers";

const VID = "528050ac-b123-46e7-b903-8ce4e7972a90";

function event(overrides: Partial<ReadersEvent> = {}): ReadersEvent {
  return {
    rawPath: "/api/readers/my-post",
    headers: {},
    cookies: [`vid=${VID}`],
    body: '{"first":true}',
    isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
    ...overrides,
  };
}

type Calls = { heartbeats: Array<{ slug: string; first: boolean }> };

function deps(
  options: { flag?: boolean; exists?: boolean; fail?: boolean } = {},
): ReadersDeps & { calls: Calls } {
  const calls: Calls = { heartbeats: [] };
  return {
    calls,
    flagOn: async () => options.flag ?? true,
    postExists: async () => options.exists ?? true,
    store: {
      tableName: "t",
      now: () => 0,
      client: {
        send: (async (command: { constructor: { name: string } }) => {
          if (options.fail) throw new Error("ddb down");
          const name = command.constructor.name;
          if (name === "QueryCommand") return { Count: 3 };
          if (name === "GetItemCommand") return { Item: { readSoFar: { N: "128" } } };
          return {};
        }) as never,
      },
    },
  };
}

test("returns the counts for a valid heartbeat", async () => {
  const d = deps();
  const result = await handleReaders(event(), d);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(String(result.body)), { readingNow: 3, readSoFar: 128 });
  assert.equal(result.headers?.["cache-control"], "no-store");
});

test("the flag off is a 404, so turning it off also stops the writes", async () => {
  let wrote = false;
  const d = deps({ flag: false });
  const result = await handleReaders(event(), {
    ...d,
    store: { ...d.store, client: { send: (async () => { wrote = true; return {}; }) as never } },
  });
  assert.equal(result.statusCode, 404);
  assert.equal(wrote, false);
});

test("an unknown post is a 404", async () => {
  assert.equal((await handleReaders(event(), deps({ exists: false }))).statusCode, 404);
});

test("no vid cookie is a 400", async () => {
  const result = await handleReaders(event({ cookies: [] }), deps());
  assert.equal(result.statusCode, 400);
});

test("GET is a 405", async () => {
  const result = await handleReaders(
    event({ requestContext: { http: { method: "GET" } } }),
    deps(),
  );
  assert.equal(result.statusCode, 405);
});

test("a store failure is a 500 with no stack in the body", async () => {
  const result = await handleReaders(event(), deps({ fail: true }));
  assert.equal(result.statusCode, 500);
  assert.deepEqual(JSON.parse(String(result.body)), { message: "counts unavailable" });
});

test("slugFromPath accepts post ids and rejects everything else", () => {
  assert.equal(slugFromPath("/api/readers/7-tips-to-make-your-ai-agent-more-predictable-1ga4"),
    "7-tips-to-make-your-ai-agent-more-predictable-1ga4");
  assert.equal(slugFromPath("/api/readers/my-post/"), "my-post");
  for (const bad of [
    "/api/readers/",
    "/api/readers/../secrets",
    "/api/readers/a/b",
    "/api/readers/UPPER",
    "/api/readers/-lead",
    "/api/other/my-post",
    `/api/readers/${"a".repeat(201)}`,
  ]) {
    assert.equal(slugFromPath(bad), null, bad);
  }
});

test("vidFromEvent reads the cookies array or the Cookie header, and rejects junk", () => {
  assert.equal(vidFromEvent(event()), VID);
  assert.equal(
    vidFromEvent(event({ cookies: undefined, headers: { cookie: `a=1; vid=${VID}` } })),
    VID,
  );
  assert.equal(vidFromEvent(event({ cookies: ["vid=not-a-uuid"] })), null);
});

test("parseBody accepts {} and {first:true} only", () => {
  assert.deepEqual(parseBody(event({ body: "{}" })), { first: false });
  assert.deepEqual(parseBody(event({ body: undefined })), { first: false });
  assert.deepEqual(
    parseBody(event({ body: Buffer.from('{"first":true}').toString("base64"), isBase64Encoded: true })),
    { first: true },
  );
  assert.equal(parseBody(event({ body: '{"first":"yes"}' })), null);
  assert.equal(parseBody(event({ body: "[]" })), null);
  assert.equal(parseBody(event({ body: "not json" })), null);
  assert.equal(parseBody(event({ body: JSON.stringify({ first: true, pad: "x".repeat(80) }) })), null);
});
