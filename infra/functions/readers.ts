import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import {
  bodyText,
  postExistsInBucket,
  readFlagFromAgent,
  slugAfterPrefix,
  vidFromEvent,
  type PublicApiEvent,
} from "./public-api-shared";
import {
  recordHeartbeat,
  type ReaderCounts,
  type ReaderCountsStore,
} from "./reader-counts";

/**
 * `POST /api/readers/<slug>`: one reader heartbeat for a blog post.
 *
 * Feature: reader-counts (see .kiro/specs/reader-counts/design.md).
 *
 * CloudFront routes `/api/readers/*` here through a Lambda Function URL behind
 * Origin Access Control, so the page and the API share one origin and need no
 * CORS. The browser can't read the `HttpOnly` `vid` cookie; CloudFront forwards
 * that one cookie and this handler reads it.
 *
 * The `readerCounts` flag gates the API as well as the page: when the flag is
 * off for this visitor the API answers 404, so turning the flag off stops the
 * writes too, not only the widget.
 *
 * The `vid` parsing, flag read and post check live in public-api-shared.ts,
 * shared with the comments API.
 */

export const READER_COUNTS_FLAG_KEY = "readerCounts";

const MAX_BODY_BYTES = 64;
const PATH_PREFIX = "/api/readers/";

export type ReadersDeps = Readonly<{
  store: ReaderCountsStore;
  /** Whether `readerCounts` is on for this visitor. Fail-safe: false on error. */
  flagOn: (vid: string) => Promise<boolean>;
  /** Whether `posts/<slug>.md` exists in the content bucket. */
  postExists: (slug: string) => Promise<boolean>;
}>;

export type ReadersEvent = PublicApiEvent;

export { vidFromEvent };

/** The post slug from `/api/readers/<slug>`, or null when it isn't one. */
export function slugFromPath(rawPath: string): string | null {
  return slugAfterPrefix(rawPath, PATH_PREFIX);
}

/** `{"first": true}` or `{}`; anything else is a bad request (null). */
export function parseBody(event: ReadersEvent): { first: boolean } | null {
  const raw = bodyText(event) || "{}";
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const first = (parsed as { first?: unknown }).first;
  if (first !== undefined && typeof first !== "boolean") return null;
  return { first: first === true };
}

function respond(
  status: number,
  body: ReaderCounts | { message: string },
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

/** One structured log line per request. Never includes the `vid`. */
function log(outcome: string, slug: string | null): void {
  console.log(JSON.stringify({ outcome, slug }));
}

export async function handleReaders(
  event: ReadersEvent,
  deps: ReadersDeps,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "POST") {
    return respond(405, { message: "method not allowed" });
  }
  const slug = slugFromPath(event.rawPath);
  if (slug === null) {
    log("bad_slug", null);
    return respond(404, { message: "not found" });
  }
  const vid = vidFromEvent(event);
  const body = parseBody(event);
  if (vid === null || body === null) {
    log("bad_request", slug);
    return respond(400, { message: "bad request" });
  }
  if (!(await deps.flagOn(vid))) {
    log("flag_off", slug);
    return respond(404, { message: "not found" });
  }
  try {
    if (!(await deps.postExists(slug))) {
      log("unknown_post", slug);
      return respond(404, { message: "not found" });
    }
    const counts = await recordHeartbeat(deps.store, slug, vid, body.first);
    log(body.first ? "first_heartbeat" : "heartbeat", slug);
    return respond(200, counts);
  } catch (error) {
    log("store_error", slug);
    console.error(error);
    return respond(500, { message: "counts unavailable" });
  }
}

let dynamoClient: DynamoDBClient | null = null;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  dynamoClient ??= new DynamoDBClient({});
  return handleReaders(event, {
    store: {
      client: dynamoClient,
      tableName: process.env.READER_COUNTS_TABLE_NAME ?? "",
      now: () => Math.floor(Date.now() / 1000),
    },
    flagOn: (vid) => readFlagFromAgent(READER_COUNTS_FLAG_KEY, vid),
    postExists: postExistsInBucket,
  });
}
