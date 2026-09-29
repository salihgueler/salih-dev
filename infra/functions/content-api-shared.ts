import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

export const CONTENT_KEY = "site/content.v1.json";
export const MAX_JSON_BODY_BYTES = 64 * 1024;
export const MAX_CONTENT_BYTES = MAX_JSON_BODY_BYTES;

/**
 * Dynamic routes served at request time by the render function. A write
 * invalidates exactly the paths its content backs, so the next request at the
 * edge reflects the new content within seconds without a publisher build.
 */
export const HOME_DYNAMIC_PATHS = ["/", "/index.md"] as const;
export const TALKS_DYNAMIC_PATHS = ["/talks/", "/talks/index.md"] as const;

const cloudfront = new CloudFrontClient({});

/** Outcome of a scoped CloudFront invalidation. */
export type InvalidationOutcome = Readonly<{
  invalidationId: string | undefined;
}>;

/**
 * Invalidates exactly the supplied dynamic paths on the delivery distribution.
 *
 * The distribution id is code-configured through `DISTRIBUTION_ID`, so a write
 * handler can never target another distribution, and the paths are the fixed
 * code-owned dynamic routes rather than caller input.
 */
export async function invalidateDynamicPaths(
  paths: readonly string[],
): Promise<InvalidationOutcome> {
  const result = await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: process.env.DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: `content-${Date.now()}`,
        Paths: {
          Quantity: paths.length,
          Items: [...paths],
        },
      },
    }),
  );

  return { invalidationId: result.Invalidation?.Id };
}

export const TALK_LOG_ACTIONS = {
  authorization: "authorize-content-editor",
  removal: "talk-record-removed",
  store: "talk-upload-stored",
  validation: "validate-talk-deck",
} as const;

export type StrongEntityTag = string & Readonly<{ __strongEntityTag: true }>;

export type PreconditionParseResult =
  | Readonly<{ ok: true; value: StrongEntityTag }>
  | Readonly<{ ok: false; reason: "invalid" | "missing" }>;

export type DeckValidationOutcome = "accepted" | "error" | "rejected";
export type TalkStoreAction =
  typeof TALK_LOG_ACTIONS.removal | typeof TALK_LOG_ACTIONS.store;

export type DeckValidationLogDetails = Readonly<{
  outcome: DeckValidationOutcome;
  storageKey: string;
  byteLength: number | null;
  pageCount: number | null;
}>;

export type TalkStoreLogDetails = Readonly<{
  action: TalkStoreAction;
  storedVersion: string | null;
  invalidationId: string | null;
}>;

const STRONG_ENTITY_TAG_PATTERN = /^"[\u0021\u0023-\u002b\u002d-\u007e]+"$/u;

export function requestId(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
): string {
  return event.requestContext.requestId;
}

export function isExpectedEditor(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
): boolean {
  const allowedArns = (process.env.CONTENT_ALLOWED_CALLER_ARNS ?? "")
    .split(",")
    .map((arn) => arn.trim())
    .filter(Boolean);
  const actual = event.requestContext.authorizer.iam.userArn;
  const allowed = allowedArns.includes(actual);
  console.log(
    JSON.stringify({
      action: TALK_LOG_ACTIONS.authorization,
      allowed,
      callerArn: actual,
      requestId: requestId(event),
    }),
  );
  return allowed;
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    body: JSON.stringify(body),
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
    statusCode,
  };
}

export function requestBody(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
): string | null {
  if (event.body === undefined) return null;
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

export function requestBodyByteLength(body: string): number {
  return Buffer.byteLength(body, "utf8");
}

export function isRequestBodyTooLarge(
  body: string,
  maximumBytes: number = MAX_JSON_BODY_BYTES,
): boolean {
  return requestBodyByteLength(body) > maximumBytes;
}

export function requestHeader(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(event.headers).find(
    ([key]) => key.toLowerCase() === target,
  )?.[1];
}

export function parseStrongEntityTag(value: unknown): PreconditionParseResult {
  if (value === undefined || value === null || value === "") {
    return { ok: false, reason: "missing" };
  }
  if (typeof value !== "string" || !STRONG_ENTITY_TAG_PATTERN.test(value)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value: value as StrongEntityTag };
}

export function parseIfMatchPrecondition(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
): PreconditionParseResult {
  return parseStrongEntityTag(requestHeader(event, "if-match"));
}

export function logDeckValidation(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
  details: DeckValidationLogDetails,
): void {
  console.log(
    JSON.stringify({
      action: TALK_LOG_ACTIONS.validation,
      validationOutcome: details.outcome,
      storageKey: details.storageKey,
      byteLength: details.byteLength,
      pageCount: details.pageCount,
      requestId: requestId(event),
    }),
  );
}

export function logTalkStoreChange(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
  details: TalkStoreLogDetails,
): void {
  console.log(
    JSON.stringify({
      action: details.action,
      storedVersion: details.storedVersion,
      invalidationId: details.invalidationId,
      requestId: requestId(event),
    }),
  );
}
