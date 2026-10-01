import { HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

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
 * The flag read and the `vid` parsing repeat src/lib/flags.ts and
 * src/lib/vid-cookie.ts on purpose. Those are ES modules and this package is
 * CommonJS, so it can import their types but not their code.
 */

export const READER_COUNTS_FLAG_KEY = "readerCounts";

/** Post ids are lowercase words, digits and hyphens (the Astro collection ids). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 200;
const MAX_BODY_BYTES = 64;
const PATH_PREFIX = "/api/readers/";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const FLAG_TIMEOUT_MS = 300;
const POST_CACHE_MS = 5 * 60 * 1000;

export type ReadersDeps = Readonly<{
  store: ReaderCountsStore;
  /** Whether `readerCounts` is on for this visitor. Fail-safe: false on error. */
  flagOn: (vid: string) => Promise<boolean>;
  /** Whether `posts/<slug>.md` exists in the content bucket. */
  postExists: (slug: string) => Promise<boolean>;
}>;

export type ReadersEvent = Pick<
  APIGatewayProxyEventV2,
  "rawPath" | "headers" | "cookies" | "body" | "isBase64Encoded"
> & {
  requestContext: { http: { method: string } };
};

/** The `vid` from the event's cookies, or null when absent or malformed. */
export function vidFromEvent(event: ReadersEvent): string | null {
  const parts = [
    ...(event.cookies ?? []),
    ...(event.headers?.cookie ?? "").split(";"),
  ];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("vid=")) continue;
    const value = trimmed.slice(4).trim();
    if (UUID_V4.test(value)) return value;
  }
  return null;
}

/** The post slug from `/api/readers/<slug>`, or null when it isn't one. */
export function slugFromPath(rawPath: string): string | null {
  if (!rawPath.startsWith(PATH_PREFIX)) return null;
  const slug = rawPath.slice(PATH_PREFIX.length).replace(/\/$/, "");
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return null;
  return SLUG.test(slug) ? slug : null;
}

/** `{"first": true}` or `{}`; anything else is a bad request (null). */
export function parseBody(event: ReadersEvent): { first: boolean } | null {
  const raw =
    event.body === undefined || event.body === ""
      ? "{}"
      : event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
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

/** Reads `readerCounts` from the AppConfig Agent extension. Any failure is off. */
async function readFlagFromAgent(vid: string): Promise<boolean> {
  const application = process.env.APPCONFIG_APPLICATION ?? "";
  const environment = process.env.APPCONFIG_ENVIRONMENT ?? "";
  const profile = process.env.APPCONFIG_PROFILE ?? "";
  if (application === "" || environment === "" || profile === "") return false;
  const url =
    `http://localhost:2772/applications/${encodeURIComponent(application)}` +
    `/environments/${encodeURIComponent(environment)}` +
    `/configurations/${encodeURIComponent(profile)}` +
    `?flag=${encodeURIComponent(READER_COUNTS_FLAG_KEY)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLAG_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Context: `vid=${vid}` },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    // A single-flag read returns the flag's attributes at the top level.
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { enabled?: unknown }).enabled === true
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const postCache = new Map<string, { exists: boolean; until: number }>();
let s3Client: S3Client | null = null;
let dynamoClient: DynamoDBClient | null = null;

async function postExistsInBucket(slug: string): Promise<boolean> {
  const cached = postCache.get(slug);
  if (cached !== undefined && cached.until > Date.now()) return cached.exists;
  s3Client ??= new S3Client({});
  let exists: boolean;
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: process.env.CONTENT_BUCKET_NAME,
        Key: `posts/${slug}.md`,
      }),
    );
    exists = true;
  } catch (error) {
    if (!(error instanceof NotFound)) throw error;
    exists = false;
  }
  postCache.set(slug, { exists, until: Date.now() + POST_CACHE_MS });
  return exists;
}

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
    flagOn: readFlagFromAgent,
    postExists: postExistsInBucket,
  });
}
