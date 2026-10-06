import { createHash } from "node:crypto";

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";

/**
 * Reader counts for blog posts: "reading now" and "read so far".
 *
 * Feature: reader-counts (see .kiro/specs/reader-counts/design.md).
 *
 * One table, one partition per post (`pk = post#<slug>`):
 *
 * - `now#<h>`  one row per open tab's visitor, overwritten on every heartbeat
 *   with `expiresAt = now + 75 s`. "Reading now" counts the rows whose
 *   `expiresAt` is still in the future.
 * - `read#<h>` one row per visitor who has opened the post, written once,
 *   expiring after a year (the `vid` cookie's lifetime).
 * - `total`    the `readSoFar` counter, incremented in the same transaction
 *   that creates a new `read#<h>` row, so a repeat visitor never counts twice.
 *
 * `h = sha256(vid + ":" + slug)`. The table never stores the `vid`, and the
 * same visitor gets an unrelated hash on every post, so rows from different
 * posts can't be joined to one person.
 *
 * DynamoDB TTL deletes expired items within days, not seconds, so every read of
 * `now#` rows filters on `expiresAt` itself. TTL is only the cleanup.
 */

/** How long a heartbeat keeps a reader in "reading now". The client beats every 30 s. */
export const READING_NOW_WINDOW_SECONDS = 75;

/** How long a `read#` row is kept: one year, the same as the `vid` cookie. */
export const READ_MARKER_TTL_SECONDS = 60 * 60 * 24 * 365;

export type ReaderCounts = Readonly<{
  readingNow: number;
  readSoFar: number;
}>;

/** The DynamoDB calls the store makes, so tests can run against DynamoDB Local. */
export type ReaderCountsStore = Readonly<{
  client: Pick<DynamoDBClient, "send">;
  tableName: string;
  /** Current time in epoch seconds. */
  now: () => number;
}>;

/** The partition key for a post. */
export function postKey(slug: string): string {
  return `post#${slug}`;
}

/** The per-post visitor hash. Never store or log the `vid` itself. */
export function readerHash(vid: string, slug: string): string {
  return createHash("sha256").update(`${vid}:${slug}`).digest("hex");
}

/**
 * Records one heartbeat and returns the post's current counts.
 *
 * @param first true on the first heartbeat of a page view. Only then does the
 *   store try to count a read, so later heartbeats cost one write, not a
 *   transaction. The count stays idempotent per visitor either way, because the
 *   `read#` row is conditional.
 */
export async function recordHeartbeat(
  store: ReaderCountsStore,
  slug: string,
  vid: string,
  first: boolean,
): Promise<ReaderCounts> {
  const pk = postKey(slug);
  const hash = readerHash(vid, slug);
  const now = store.now();

  await store.client.send(
    new PutItemCommand({
      TableName: store.tableName,
      Item: {
        pk: { S: pk },
        sk: { S: `now#${hash}` },
        expiresAt: { N: String(now + READING_NOW_WINDOW_SECONDS) },
      },
    }),
  );

  if (first) await countReadOnce(store, pk, hash, now);

  return readCounts(store, pk, now);
}

/** Adds this visitor to "read so far" unless they are already counted. */
async function countReadOnce(
  store: ReaderCountsStore,
  pk: string,
  hash: string,
  now: number,
): Promise<void> {
  try {
    await store.client.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: store.tableName,
              Item: {
                pk: { S: pk },
                sk: { S: `read#${hash}` },
                expiresAt: { N: String(now + READ_MARKER_TTL_SECONDS) },
              },
              ConditionExpression: "attribute_not_exists(sk)",
            },
          },
          {
            Update: {
              TableName: store.tableName,
              Key: { pk: { S: pk }, sk: { S: "total" } },
              UpdateExpression: "ADD readSoFar :one",
              ExpressionAttributeValues: { ":one": { N: "1" } },
            },
          },
        ],
      }),
    );
  } catch (error) {
    // A repeat visitor fails the condition on `read#<h>`, which cancels the
    // whole transaction, so the counter doesn't move. That is the expected
    // path, not an error. Anything else is a real failure.
    if (isAlreadyCounted(error)) return;
    throw error;
  }
}

function isAlreadyCounted(error: unknown): boolean {
  if (!(error instanceof TransactionCanceledException)) return false;
  return (error.CancellationReasons ?? []).some(
    (reason) => reason.Code === "ConditionalCheckFailed",
  );
}

async function readCounts(
  store: ReaderCountsStore,
  pk: string,
  now: number,
): Promise<ReaderCounts> {
  const [reading, total] = await Promise.all([
    store.client.send(
      new QueryCommand({
        TableName: store.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :now)",
        // TTL is cleanup only; expired rows can live for days, so filter here.
        FilterExpression: "expiresAt > :t",
        ExpressionAttributeValues: {
          ":pk": { S: pk },
          ":now": { S: "now#" },
          ":t": { N: String(now) },
        },
        Select: "COUNT",
      }),
    ),
    store.client.send(
      new GetItemCommand({
        TableName: store.tableName,
        Key: { pk: { S: pk }, sk: { S: "total" } },
        ProjectionExpression: "readSoFar",
      }),
    ),
  ]);
  return {
    readingNow: reading.Count ?? 0,
    readSoFar: Number(total.Item?.readSoFar?.N ?? "0"),
  };
}
