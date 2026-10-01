import { createHash, randomBytes } from "node:crypto";

import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
  UpdateItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";

/**
 * Comments on blog posts, held for moderation.
 *
 * Feature: comments (see .kiro/specs/comments/design.md).
 *
 * One table, three kinds of item:
 *
 * - `pk = pending`, `sk = <id>`: a submitted comment waiting for approval. It
 *   carries the post slug and expires after 30 days if nobody approves it.
 * - `pk = post#<slug>`, `sk = c#<id>`: an approved comment. Only these are
 *   ever returned to readers.
 * - `pk = rate#<hash>`, `sk = hour#<YYYYMMDDHH>`: how many comments one
 *   visitor sent in one hour, for the rate limit. Expires after two hours.
 *
 * Ids are a UTC timestamp plus random hex, so both partitions sort by time.
 * The visitor's `vid` is never stored: the rate rows key on a hash of it, and a
 * pending comment keeps only that hash, which approval drops.
 */

export const PENDING_TTL_SECONDS = 60 * 60 * 24 * 30;
export const RATE_LIMIT_PER_HOUR = 3;
const RATE_TTL_SECONDS = 2 * 60 * 60;
const MAX_LISTED = 200;

export const MAX_NAME_LENGTH = 40;
export const MAX_BODY_LENGTH = 2000;
const MAX_LINKS = 2;
export const DEFAULT_NAME = "Anonymous";

const ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

export type CommentsStore = Readonly<{
  client: Pick<DynamoDBClient, "send">;
  tableName: string;
  /** Current time in epoch milliseconds. */
  now: () => number;
  /** Random hex suffix for ids, overridable in tests. */
  randomHex?: () => string;
}>;

export type PublicComment = Readonly<{
  id: string;
  name: string;
  body: string;
  createdAt: string;
}>;

export type PendingComment = PublicComment & Readonly<{ slug: string }>;

export type CommentInput = Readonly<{ name: string; body: string }>;

export type ValidationResult =
  | { ok: true; value: CommentInput }
  | { ok: false; reason: string };

/** Whether a string has the shape of a comment id. */
export function isCommentId(value: string): boolean {
  return ID.test(value);
}

/**
 * Normalizes and checks a submitted name and body.
 *
 * Control characters are removed (newlines in the body are kept), whitespace
 * is trimmed, and the text is NFC-normalized. The name is optional and falls
 * back to "Anonymous". Comments are always rendered as text, never HTML, so
 * nothing here needs to escape markup.
 */
export function validateComment(name: unknown, body: unknown): ValidationResult {
  if (name !== undefined && name !== null && typeof name !== "string") {
    return { ok: false, reason: "name must be text" };
  }
  if (typeof body !== "string") return { ok: false, reason: "comment is required" };

  const cleanName = clean(name ?? "", false).replace(/\s+/g, " ");
  const cleanBody = clean(body, true).replace(/\n{3,}/g, "\n\n");

  if (cleanName.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `name is longer than ${MAX_NAME_LENGTH} characters` };
  }
  if (cleanBody.length === 0) return { ok: false, reason: "comment is required" };
  if (cleanBody.length > MAX_BODY_LENGTH) {
    return { ok: false, reason: `comment is longer than ${MAX_BODY_LENGTH} characters` };
  }
  if ((cleanBody.match(/https?:\/\//gi) ?? []).length > MAX_LINKS) {
    return { ok: false, reason: `comment has more than ${MAX_LINKS} links` };
  }
  return {
    ok: true,
    value: { name: cleanName === "" ? DEFAULT_NAME : cleanName, body: cleanBody },
  };
}

function clean(text: string, keepNewlines: boolean): string {
  const normalized = text.normalize("NFC").replace(/\r\n?/g, "\n");
  const stripped = keepNewlines
    ? normalized.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    : normalized.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  return stripped.trim();
}

/** The hash rate rows and pending comments key on. Never the `vid` itself. */
export function visitorHash(vid: string): string {
  return createHash("sha256").update(`comments:${vid}`).digest("hex");
}

function newId(store: CommentsStore): string {
  const stamp = new Date(store.now()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const suffix = store.randomHex?.() ?? randomBytes(4).toString("hex");
  return `${stamp}-${suffix}`;
}

function hourKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 13).replace(/[-T]/g, "");
}

/**
 * Takes one slot of the visitor's hourly allowance. Returns false when the
 * visitor already sent RATE_LIMIT_PER_HOUR comments this hour.
 */
export async function takeRateSlot(
  store: CommentsStore,
  vid: string,
): Promise<boolean> {
  const now = store.now();
  try {
    await store.client.send(
      new UpdateItemCommand({
        TableName: store.tableName,
        Key: {
          pk: { S: `rate#${visitorHash(vid)}` },
          sk: { S: `hour#${hourKey(now)}` },
        },
        UpdateExpression: "ADD n :one SET expiresAt = :exp",
        ConditionExpression: "attribute_not_exists(n) OR n < :limit",
        ExpressionAttributeValues: {
          ":one": { N: "1" },
          ":limit": { N: String(RATE_LIMIT_PER_HOUR) },
          ":exp": { N: String(Math.floor(now / 1000) + RATE_TTL_SECONDS) },
        },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

/** Stores a comment as pending. Nothing is shown until it is approved. */
export async function submitComment(
  store: CommentsStore,
  slug: string,
  vid: string,
  input: CommentInput,
): Promise<PendingComment> {
  const id = newId(store);
  const createdAt = new Date(store.now()).toISOString();
  await store.client.send(
    new PutItemCommand({
      TableName: store.tableName,
      Item: {
        pk: { S: "pending" },
        sk: { S: id },
        slug: { S: slug },
        name: { S: input.name },
        body: { S: input.body },
        createdAt: { S: createdAt },
        visitor: { S: visitorHash(vid) },
        expiresAt: {
          N: String(Math.floor(store.now() / 1000) + PENDING_TTL_SECONDS),
        },
      },
      ConditionExpression: "attribute_not_exists(sk)",
    }),
  );
  return { id, slug, name: input.name, body: input.body, createdAt };
}

function readString(item: Record<string, AttributeValue>, key: string): string {
  return item[key]?.S ?? "";
}

/** Approved comments for a post, oldest first. */
export async function listApproved(
  store: CommentsStore,
  slug: string,
): Promise<PublicComment[]> {
  const result = await store.client.send(
    new QueryCommand({
      TableName: store.tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :c)",
      ExpressionAttributeValues: {
        ":pk": { S: `post#${slug}` },
        ":c": { S: "c#" },
      },
      Limit: MAX_LISTED,
    }),
  );
  return (result.Items ?? []).map((item) => ({
    id: readString(item, "sk").slice(2),
    name: readString(item, "name"),
    body: readString(item, "body"),
    createdAt: readString(item, "createdAt"),
  }));
}

/** Pending comments across all posts, oldest first. Expired ones are left out. */
export async function listPending(store: CommentsStore): Promise<PendingComment[]> {
  const result = await store.client.send(
    new QueryCommand({
      TableName: store.tableName,
      KeyConditionExpression: "pk = :pk",
      FilterExpression: "expiresAt > :t",
      ExpressionAttributeValues: {
        ":pk": { S: "pending" },
        ":t": { N: String(Math.floor(store.now() / 1000)) },
      },
      Limit: MAX_LISTED,
    }),
  );
  return (result.Items ?? []).map((item) => ({
    id: readString(item, "sk"),
    slug: readString(item, "slug"),
    name: readString(item, "name"),
    body: readString(item, "body"),
    createdAt: readString(item, "createdAt"),
  }));
}

export type ModerationResult = "done" | "not_found";

/**
 * Approves a pending comment: in one transaction it deletes the pending item
 * and writes the public one, without the visitor hash.
 */
export async function approveComment(
  store: CommentsStore,
  id: string,
): Promise<ModerationResult> {
  const pending = await store.client.send(
    new GetItemCommand({
      TableName: store.tableName,
      Key: { pk: { S: "pending" }, sk: { S: id } },
      ConsistentRead: true,
    }),
  );
  const item = pending.Item;
  if (item === undefined) return "not_found";
  const slug = readString(item, "slug");
  try {
    await store.client.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Delete: {
              TableName: store.tableName,
              Key: { pk: { S: "pending" }, sk: { S: id } },
              ConditionExpression: "attribute_exists(sk)",
            },
          },
          {
            Put: {
              TableName: store.tableName,
              Item: {
                pk: { S: `post#${slug}` },
                sk: { S: `c#${id}` },
                name: { S: readString(item, "name") },
                body: { S: readString(item, "body") },
                createdAt: { S: readString(item, "createdAt") },
              },
            },
          },
        ],
      }),
    );
  } catch (error) {
    // Approved or rejected by another call in between.
    if (error instanceof TransactionCanceledException) return "not_found";
    throw error;
  }
  return "done";
}

/** Rejects (deletes) a pending comment. */
export async function rejectComment(
  store: CommentsStore,
  id: string,
): Promise<ModerationResult> {
  return deleteExisting(store, { pk: { S: "pending" }, sk: { S: id } });
}

/** Removes an approved comment from a post. */
export async function removeApproved(
  store: CommentsStore,
  slug: string,
  id: string,
): Promise<ModerationResult> {
  return deleteExisting(store, { pk: { S: `post#${slug}` }, sk: { S: `c#${id}` } });
}

async function deleteExisting(
  store: CommentsStore,
  key: Record<string, AttributeValue>,
): Promise<ModerationResult> {
  try {
    await store.client.send(
      new DeleteItemCommand({
        TableName: store.tableName,
        Key: key,
        ConditionExpression: "attribute_exists(sk)",
      }),
    );
    return "done";
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return "not_found";
    throw error;
  }
}
