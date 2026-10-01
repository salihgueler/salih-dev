import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import {
  approveComment,
  isCommentId,
  listPending,
  rejectComment,
  removeApproved,
  type CommentsStore,
  type ModerationResult,
} from "./comments-store";
import { isExpectedEditor, jsonResponse } from "./content-api-shared";

/**
 * Comment moderation, on the IAM-authenticated content API. Only the editor
 * principal in CONTENT_ALLOWED_CALLER_ARNS may call it.
 *
 * Feature: comments (see .kiro/specs/comments/design.md).
 *
 *   GET    /v1/comments/pending                     list waiting comments
 *   POST   /v1/comments/pending/{commentId}/approval approve one
 *   DELETE /v1/comments/pending/{commentId}          reject one
 *   DELETE /v1/comments/{slug}/{commentId}           remove an approved one
 *
 * Moderation is deliberately not behind the `comments` flag: turning the
 * feature off for readers must not stop the editor from cleaning up.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ModerationDeps = Readonly<{ store: CommentsStore }>;

function outcome(result: ModerationResult): APIGatewayProxyResultV2 {
  return result === "done"
    ? jsonResponse(200, { status: "done" })
    : jsonResponse(404, { error: "comment_not_found" });
}

export async function handleModeration(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
  deps: ModerationDeps,
): Promise<APIGatewayProxyResultV2> {
  if (!isExpectedEditor(event)) {
    return jsonResponse(403, { error: "forbidden" });
  }
  const route = event.routeKey;
  const commentId = event.pathParameters?.commentId ?? "";
  const slug = event.pathParameters?.slug ?? "";

  if (route === "GET /v1/comments/pending") {
    return jsonResponse(200, { comments: await listPending(deps.store) });
  }
  if (!isCommentId(commentId)) {
    return jsonResponse(400, { error: "invalid_comment_id" });
  }
  let result: ModerationResult;
  switch (route) {
    case "POST /v1/comments/pending/{commentId}/approval":
      result = await approveComment(deps.store, commentId);
      break;
    case "DELETE /v1/comments/pending/{commentId}":
      result = await rejectComment(deps.store, commentId);
      break;
    case "DELETE /v1/comments/{slug}/{commentId}":
      if (!SLUG.test(slug)) return jsonResponse(400, { error: "invalid_slug" });
      result = await removeApproved(deps.store, slug, commentId);
      break;
    default:
      return jsonResponse(404, { error: "not_found" });
  }
  console.log(JSON.stringify({ action: "comment_moderation", route, result, commentId }));
  return outcome(result);
}

let dynamoClient: DynamoDBClient | null = null;

export async function handler(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  dynamoClient ??= new DynamoDBClient({});
  return handleModeration(event, {
    store: {
      client: dynamoClient,
      tableName: process.env.COMMENTS_TABLE_NAME ?? "",
      now: () => Date.now(),
    },
  });
}
