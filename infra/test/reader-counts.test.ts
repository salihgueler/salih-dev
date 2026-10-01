import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";

import {
  readerHash,
  recordHeartbeat,
  type ReaderCountsStore,
} from "../functions/reader-counts";

/**
 * Runs the reader-counts store against a real DynamoDB API (DynamoDB Local),
 * because the parts that matter are DynamoDB behavior: the conditional put
 * cancelling the whole transaction, and the Query filter on `expiresAt`.
 *
 * Set READER_COUNTS_DDB_ENDPOINT to run it, e.g.
 *   docker run --rm -p 127.0.0.1:8765:8000 amazon/dynamodb-local:3.1.0
 *   READER_COUNTS_DDB_ENDPOINT=http://127.0.0.1:8765 npm test
 * Without it the suite is skipped, so CI without Docker still passes.
 */
const endpoint = process.env.READER_COUNTS_DDB_ENDPOINT;
const skip = endpoint === undefined || endpoint === "";

const VID_A = "11111111-1111-4111-8111-111111111111";
const VID_B = "22222222-2222-4222-8222-222222222222";

async function withTable(
  run: (store: ReaderCountsStore & { tick: (s: number) => void }) => Promise<void>,
): Promise<void> {
  const client = new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const tableName = `reader-counts-${Math.random().toString(36).slice(2)}`;
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
  let clock = 1_800_000_000;
  try {
    await run({
      client,
      tableName,
      now: () => clock,
      tick: (seconds) => {
        clock += seconds;
      },
    });
  } finally {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    client.destroy();
  }
}

test("a first heartbeat counts one read and one reader", { skip }, async () => {
  await withTable(async (store) => {
    assert.deepEqual(await recordHeartbeat(store, "post-a", VID_A, true), {
      readingNow: 1,
      readSoFar: 1,
    });
  });
});

test("a returning visitor is not counted twice", { skip }, async () => {
  await withTable(async (store) => {
    await recordHeartbeat(store, "post-a", VID_A, true);
    store.tick(3600);
    assert.deepEqual(await recordHeartbeat(store, "post-a", VID_A, true), {
      readingNow: 1,
      readSoFar: 1,
    });
  });
});

test("two visitors are two readers", { skip }, async () => {
  await withTable(async (store) => {
    await recordHeartbeat(store, "post-a", VID_A, true);
    assert.deepEqual(await recordHeartbeat(store, "post-a", VID_B, true), {
      readingNow: 2,
      readSoFar: 2,
    });
  });
});

test("a reader drops out of reading now after 75 s without a heartbeat", { skip }, async () => {
  await withTable(async (store) => {
    await recordHeartbeat(store, "post-a", VID_A, true);
    store.tick(30);
    await recordHeartbeat(store, "post-a", VID_B, true);
    store.tick(50); // A's row is 80 s old, B's 50 s
    // B's next heartbeat sees only B: A's expired row still exists (TTL has
    // not deleted it), and the filter is what leaves it out.
    assert.deepEqual(await recordHeartbeat(store, "post-a", VID_B, false), {
      readingNow: 1,
      readSoFar: 2,
    });
  });
});

test("posts are counted separately", { skip }, async () => {
  await withTable(async (store) => {
    await recordHeartbeat(store, "post-a", VID_A, true);
    assert.deepEqual(await recordHeartbeat(store, "post-b", VID_A, true), {
      readingNow: 1,
      readSoFar: 1,
    });
  });
});

test("the table never stores the vid, and the hash differs per post", { skip }, async () => {
  await withTable(async (store) => {
    await recordHeartbeat(store, "post-a", VID_A, true);
    await recordHeartbeat(store, "post-b", VID_A, true);
    const scan = await store.client.send(
      new ScanCommand({ TableName: store.tableName }),
    );
    const dump = JSON.stringify(scan.Items);
    assert.equal(dump.includes(VID_A), false);
    assert.notEqual(readerHash(VID_A, "post-a"), readerHash(VID_A, "post-b"));
  });
});

test("a later heartbeat without first does not count a read", { skip }, async () => {
  await withTable(async (store) => {
    assert.deepEqual(await recordHeartbeat(store, "post-a", VID_A, false), {
      readingNow: 1,
      readSoFar: 0,
    });
  });
});
