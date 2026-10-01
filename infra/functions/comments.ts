import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import {
  listApproved,
  submitComment,
  takeRateSlot,
  validateComment,
  type CommentsStore,
  type PendingComment,
  type PublicComment,
} from "./comments-store";
import {
  bodyText,
  postExistsInBucket,
  readFlagFromAgent,
  slugAfterPrefix,
  vidFromEvent,
  type PublicApiEvent,
} from "./public-api-shared";

/**
 * `GET /api/comments/<slug>`: the approved comments on a blog post.
 * `POST /api/comments/<slug>`: submit a comment. It is held until approved.
 *
 * Feature: comments (see .kiro/specs/comments/design.md).
 *
 * Behind CloudFront and OAC like the readers API, and gated the same way: when
 * the `comments` flag is off for the visitor both methods answer 404, so the
 * flag is the API's kill switch as well as the form's.
 */

export const COMMENTS_FLAG_KEY = "comments";
const PATH_PREFIX = "/api/comments/";
const MAX_BODY_BYTES = 8 * 1024;

export type CommentsDeps = Readonly<{
  store: CommentsStore;
  flagOn: (vid: string) => Promise<boolean>;
  postExists: (slug: string) => Promise<boolean>;
  /** Tells Salih a comment is waiting. Failures are logged, never surfaced. */
  notify: (comment: PendingComment) => Promise<void>;
}>;

type Json = PublicComment[] | { comments: PublicComment[] } | { status: string } | { message: string };

function respond(status: number, body: Json): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

/** One structured log line per request. Never the `vid`, the name or the text. */
function log(outcome: string, slug: string | null): void {
  console.log(JSON.stringify({ outcome, slug }));
}

type ParsedSubmission =
  | { kind: "ok"; name: unknown; body: unknown }
  | { kind: "honeypot" }
  | { kind: "bad" };

/** `{"name"?, "body", "website"?}`. A filled `website` is the bot trap. */
function parseSubmission(event: PublicApiEvent): ParsedSubmission {
  const raw = bodyText(event);
  if (raw === "" || Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return { kind: "bad" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "bad" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "bad" };
  }
  const fields = parsed as { name?: unknown; body?: unknown; website?: unknown };
  if (typeof fields.website === "string" && fields.website.trim() !== "") {
    return { kind: "honeypot" };
  }
  return { kind: "ok", name: fields.name, body: fields.body };
}

export async function handleComments(
  event: PublicApiEvent,
  deps: CommentsDeps,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method !== "GET" && method !== "POST") {
    return respond(405, { message: "method not allowed" });
  }
  const slug = slugAfterPrefix(event.rawPath, PATH_PREFIX);
  if (slug === null) {
    log("bad_slug", null);
    return respond(404, { message: "not found" });
  }
  const vid = vidFromEvent(event);
  if (vid === null) {
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

    if (method === "GET") {
      const comments = await listApproved(deps.store, slug);
      log("list", slug);
      return respond(200, { comments });
    }

    const submission = parseSubmission(event);
    if (submission.kind === "bad") {
      log("bad_request", slug);
      return respond(400, { message: "bad request" });
    }
    if (submission.kind === "honeypot") {
      // Look like success, store nothing.
      log("honeypot", slug);
      return respond(202, { status: "pending" });
    }
    const valid = validateComment(submission.name, submission.body);
    if (!valid.ok) {
      log("invalid", slug);
      return respond(400, { message: valid.reason });
    }
    if (!(await takeRateSlot(deps.store, vid))) {
      log("rate_limited", slug);
      return respond(429, { message: "too many comments, try again later" });
    }
    const pending = await submitComment(deps.store, slug, vid, valid.value);
    log("submitted", slug);
    try {
      await deps.notify(pending);
    } catch (error) {
      log("notify_error", slug);
      console.error(error);
    }
    return respond(202, { status: "pending" });
  } catch (error) {
    log("store_error", slug);
    console.error(error);
    return respond(500, { message: "comments unavailable" });
  }
}

let dynamoClient: DynamoDBClient | null = null;
let snsClient: SNSClient | null = null;

async function notifyByTopic(comment: PendingComment): Promise<void> {
  const topicArn = process.env.COMMENTS_TOPIC_ARN ?? "";
  if (topicArn === "") return;
  snsClient ??= new SNSClient({});
  await snsClient.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: "salih.dev: a comment is waiting for approval",
      Message:
        `A comment on /blog/${comment.slug}/ is waiting for approval.\n\n` +
        `Id: ${comment.id}\nName: ${comment.name}\n\n${comment.body}\n\n` +
        "Approve or reject it with the commands in DEPLOY.md section 13.",
    }),
  );
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  dynamoClient ??= new DynamoDBClient({});
  return handleComments(event, {
    store: {
      client: dynamoClient,
      tableName: process.env.COMMENTS_TABLE_NAME ?? "",
      now: () => Date.now(),
    },
    flagOn: (vid) => readFlagFromAgent(COMMENTS_FLAG_KEY, vid),
    postExists: postExistsInBucket,
    notify: notifyByTopic,
  });
}
