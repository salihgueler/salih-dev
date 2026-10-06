import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";

import {
  approveComment,
  listApproved,
  listPending,
  PENDING_TTL_SECONDS,
  RATE_LIMIT_PER_HOUR,
  rejectComment,
  removeApproved,
  submitComment,
  takeRateSlot,
  validateComment,
  type CommentsStore,
} from "../functions/comments-store";

/**
 * Runs the comments store against DynamoDB Local, like the reader-counts store
 * tests: the conditional writes and the approval transaction are DynamoDB
 * behavior. Set READER_COUNTS_DDB_ENDPOINT to run it; without it the
 * DynamoDB tests are skipped.
 */
const endpoint = process.env.READER_COUNTS_DDB_ENDPOINT;
const skip = endpoint === undefined || endpoint === "";

const VID_A = "11111111-1111-4111-8111-111111111111";
const VID_B = "22222222-2222-4222-8222-222222222222";
const START = Date.UTC(2026, 9, 1, 12, 0, 0);

async function withTable(
  run: (store: CommentsStore & { tick: (ms: number) => void }) => Promise<void>,
): Promise<void> {
  const client = new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const tableName = `comments-${Math.random().toString(36).slice(2)}`;
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    }),
  );
  let clock = START;
  let counter = 0;
  try {
    await run({
      client,
      tableName,
      now: () => clock,
      randomHex: () => (counter++).toString(16).padStart(8, "0"),
      tick: (ms) => {
        clock += ms;
      },
    });
  } finally {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    client.destroy();
  }
}

const input = { name: "Ada", body: "Nice post." };

test("a submitted comment is pending and not shown", { skip }, async () => {
  await withTable(async (store) => {
    const pending = await submitComment(store, "post-a", VID_A, input);
    assert.match(pending.id, /^20261001T120000Z-00000000$/);
    assert.deepEqual(await listApproved(store, "post-a"), []);
    const queue = await listPending(store);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].slug, "post-a");
    assert.equal(queue[0].body, "Nice post.");
  });
});

test("approving moves it to the post, without the visitor hash", { skip }, async () => {
  await withTable(async (store) => {
    const { id } = await submitComment(store, "post-a", VID_A, input);
    assert.equal(await approveComment(store, id), "done");
    assert.deepEqual(await listPending(store), []);
    const shown = await listApproved(store, "post-a");
    assert.deepEqual(shown.map((c) => [c.id, c.name, c.body]), [[id, "Ada", "Nice post."]]);
    const scan = await store.client.send(new ScanCommand({ TableName: store.tableName }));
    const approved = scan.Items?.find((item) => item.pk.S === "post#post-a");
    assert.ok(approved !== undefined);
    assert.equal("visitor" in approved, false);
    assert.equal(JSON.stringify(scan.Items).includes(VID_A), false);
  });
});

test("approving twice, or approving a rejected comment, is not_found", { skip }, async () => {
  await withTable(async (store) => {
    const first = await submitComment(store, "post-a", VID_A, input);
    assert.equal(await approveComment(store, first.id), "done");
    assert.equal(await approveComment(store, first.id), "not_found");
    const second = await submitComment(store, "post-a", VID_A, input);
    assert.equal(await rejectComment(store, second.id), "done");
    assert.equal(await approveComment(store, second.id), "not_found");
    assert.equal((await listApproved(store, "post-a")).length, 1);
  });
});

test("an approved comment can be removed", { skip }, async () => {
  await withTable(async (store) => {
    const { id } = await submitComment(store, "post-a", VID_A, input);
    await approveComment(store, id);
    assert.equal(await removeApproved(store, "post-a", id), "done");
    assert.equal(await removeApproved(store, "post-a", id), "not_found");
    assert.deepEqual(await listApproved(store, "post-a"), []);
  });
});

test("approved comments list oldest first and per post", { skip }, async () => {
  await withTable(async (store) => {
    const one = await submitComment(store, "post-a", VID_A, { name: "A", body: "first" });
    store.tick(60_000);
    const two = await submitComment(store, "post-a", VID_B, { name: "B", body: "second" });
    const other = await submitComment(store, "post-b", VID_A, { name: "C", body: "other" });
    for (const c of [two, other, one]) await approveComment(store, c.id);
    assert.deepEqual((await listApproved(store, "post-a")).map((c) => c.body), ["first", "second"]);
    assert.deepEqual((await listApproved(store, "post-b")).map((c) => c.body), ["other"]);
  });
});

test("an unapproved comment drops out of the queue after 30 days", { skip }, async () => {
  await withTable(async (store) => {
    await submitComment(store, "post-a", VID_A, input);
    store.tick(PENDING_TTL_SECONDS * 1000 + 1000);
    assert.deepEqual(await listPending(store), []);
  });
});

test(`a visitor gets ${RATE_LIMIT_PER_HOUR} comments an hour`, { skip }, async () => {
  await withTable(async (store) => {
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i += 1) {
      assert.equal(await takeRateSlot(store, VID_A), true);
    }
    assert.equal(await takeRateSlot(store, VID_A), false);
    assert.equal(await takeRateSlot(store, VID_B), true, "another visitor is not limited");
    store.tick(60 * 60 * 1000);
    assert.equal(await takeRateSlot(store, VID_A), true, "the next hour starts fresh");
  });
});

test("validateComment trims, defaults the name and keeps paragraph breaks", () => {
  assert.deepEqual(validateComment(undefined, "  Hello\r\n\r\n\r\n\r\nthere  "), {
    ok: true,
    value: { name: "Anonymous", body: "Hello\n\nthere" },
  });
  assert.deepEqual(validateComment("  Ada \n Lovelace ", "hi"), {
    ok: true,
    value: { name: "Ada Lovelace", body: "hi" },
  });
});

test("validateComment strips control and direction characters", () => {
  const result = validateComment("A\u202Eda\u0007", "x\u0000y\u200Bz");
  assert.deepEqual(result, { ok: true, value: { name: "Ada", body: "xyz" } });
});

test("validateComment rejects empty, too long, too many links, non-text", () => {
  for (const [name, body] of [
    [undefined, "   "],
    [undefined, undefined],
    [undefined, "x".repeat(2001)],
    ["n".repeat(41), "ok"],
    [42, "ok"],
    [undefined, "http://a https://b http://c"],
  ] as Array<[unknown, unknown]>) {
    assert.equal(validateComment(name, body).ok, false, JSON.stringify([name, body]));
  }
  assert.equal(validateComment(undefined, "x".repeat(2000)).ok, true);
  assert.equal(validateComment(undefined, "http://a and https://b").ok, true);
});
