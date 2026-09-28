import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { mock } from "node:test";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import fc from "fast-check";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyStructuredResultV2,
  Callback,
  Context,
} from "aws-lambda";

import { handler } from "../functions/talk-upload-start";

const ALLOWED_ARN = "arn:aws:iam::111111111111:root";
const BUCKET = "test-content-bucket";
const DECK_MEDIA_TYPE = "application/pdf";
const DECK_MIN_BYTES = 1;
const DECK_MAX_BYTES = 26_214_400;
const MAX_GRANT_SECONDS = 900;
const EXPECTED_GRANT_SECONDS = 899;
const DECK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type UnknownRecord = Record<string, unknown>;

type GeneratedMetadata = Readonly<{
  title: string;
  eventName: string;
  date: string;
  location: string;
  eventUrl: string;
  eventTypes: readonly string[];
  videoUrl?: string;
  draft: boolean;
}>;

type GrantResponse = Readonly<{
  deckId: string;
  storageKey: string;
  approvedStorageKey: string;
  slidePath: string;
  recordKey?: string;
  expiresAt: string;
  upload: Readonly<{
    url: string;
    fields: Readonly<Record<string, string>>;
  }>;
}>;

type PostPolicy = Readonly<{
  expiration: string;
  conditions: readonly unknown[];
}>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: UnknownRecord, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    assert.fail(`${field} must be a string`);
  }
  return value;
}

function parseGrantResponse(
  result: APIGatewayProxyStructuredResultV2,
): GrantResponse {
  assert.equal(result.statusCode, 201);
  const body = result.body;
  if (typeof body !== "string") assert.fail("response body must be a string");

  const parsed: unknown = JSON.parse(body);
  assert.ok(isRecord(parsed));
  const deckId = requireString(parsed, "deckId");
  assert.match(deckId, DECK_ID_PATTERN);

  const upload = parsed.upload;
  assert.ok(isRecord(upload));
  const fields = upload.fields;
  assert.ok(isRecord(fields));
  assert.ok(Object.values(fields).every((value) => typeof value === "string"));

  const recordKey = parsed.recordKey;
  assert.ok(recordKey === undefined || typeof recordKey === "string");

  return {
    deckId,
    storageKey: requireString(parsed, "storageKey"),
    approvedStorageKey: requireString(parsed, "approvedStorageKey"),
    slidePath: requireString(parsed, "slidePath"),
    ...(recordKey === undefined ? {} : { recordKey }),
    expiresAt: requireString(parsed, "expiresAt"),
    upload: {
      url: requireString(upload, "url"),
      fields: fields as Record<string, string>,
    },
  };
}

function parsePostPolicy(encoded: string): PostPolicy {
  const parsed: unknown = JSON.parse(
    Buffer.from(encoded, "base64").toString("utf8"),
  );
  assert.ok(isRecord(parsed));
  const expiration = requireString(parsed, "expiration");
  assert.ok(Array.isArray(parsed.conditions));
  return { expiration, conditions: parsed.conditions };
}

function exactObjectCondition(
  condition: unknown,
  field: string,
  expected: string,
): boolean {
  return (
    isRecord(condition) &&
    Object.keys(condition).length === 1 &&
    condition[field] === expected
  );
}

function exactLengthCondition(condition: unknown): boolean {
  return (
    Array.isArray(condition) &&
    condition.length === 3 &&
    condition[0] === "content-length-range" &&
    condition[1] === DECK_MIN_BYTES &&
    condition[2] === DECK_MAX_BYTES
  );
}

function assertSingleCondition(
  conditions: readonly unknown[],
  predicate: (condition: unknown) => boolean,
  description: string,
): void {
  assert.equal(
    conditions.filter(predicate).length,
    1,
    `policy must contain exactly one ${description} condition`,
  );
}

function createContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "talk-upload-start-test",
    functionVersion: "$LATEST",
    invokedFunctionArn:
      "arn:aws:lambda:us-east-1:111111111111:function:talk-upload-start-test",
    memoryLimitInMB: "256",
    awsRequestId: "request-id",
    logGroupName: "/aws/lambda/talk-upload-start-test",
    logStreamName: "test-stream",
    getRemainingTimeInMillis: () => 10_000,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}

function createEvent(body: unknown): APIGatewayProxyEventV2WithIAMAuthorizer {
  return {
    version: "2.0",
    routeKey: "POST /v1/talks/uploads",
    rawPath: "/v1/talks/uploads",
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "111111111111",
      apiId: "test-api",
      authorizer: {
        iam: {
          accessKey: "ASIATEST",
          accountId: "111111111111",
          callerId: "caller-id",
          cognitoIdentity: null,
          principalOrgId: "o-example",
          userArn: ALLOWED_ARN,
          userId: "user-id",
        },
      },
      domainName: "api.example.test",
      domainPrefix: "api",
      http: {
        method: "POST",
        path: "/v1/talks/uploads",
        protocol: "HTTP/1.1",
        sourceIp: "192.0.2.1",
        userAgent: "property-test",
      },
      requestId: "request-id",
      routeKey: "POST /v1/talks/uploads",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1_767_225_600_000,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

async function invoke(
  body: unknown,
): Promise<APIGatewayProxyStructuredResultV2> {
  const callback: Callback = () => undefined;
  const result = await handler(createEvent(body), createContext(), callback);
  if (typeof result !== "object" || result === null) {
    assert.fail("handler must return a structured response");
  }
  return result;
}

function pendingDeckKey(deckId: string): string {
  return `talks/pending/${deckId}.pdf`;
}

function approvedDeckKey(deckId: string): string {
  return `talks/decks/${deckId}.pdf`;
}

function slidePath(deckId: string): string {
  return `/talks/slides/api/${deckId}.pdf`;
}

function pendingRequestKey(deckId: string): string {
  return `talks/pending/${deckId}.upload.json`;
}

function expectedRecordKey(metadata: GeneratedMetadata): string {
  const canonicalTitle = metadata.title
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  const identity = `${metadata.date}|${canonicalTitle}`;
  const digest = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 16);
  return `${metadata.date}-${digest}`;
}

function assertGrantConstraints(
  grant: GrantResponse,
  stagedCommand: PutObjectCommand,
  issuedAfter: number,
  issuedBefore: number,
): void {
  assert.equal(grant.storageKey, pendingDeckKey(grant.deckId));
  assert.equal(grant.approvedStorageKey, approvedDeckKey(grant.deckId));
  assert.equal(grant.slidePath, slidePath(grant.deckId));

  assert.equal(grant.upload.fields.key, grant.storageKey);
  assert.equal(grant.upload.fields["Content-Type"], DECK_MEDIA_TYPE);
  assert.equal(grant.upload.fields.bucket, BUCKET);
  assert.equal(typeof grant.upload.fields.Policy, "string");
  assert.equal(typeof grant.upload.fields["X-Amz-Signature"], "string");
  assert.equal(Array.isArray(grant.upload), false);
  assert.ok(grant.upload.url.startsWith("https://"));

  const responseExpiration = Date.parse(grant.expiresAt);
  assert.ok(Number.isFinite(responseExpiration));
  assert.ok(responseExpiration > issuedAfter);
  assert.ok(responseExpiration >= issuedAfter + EXPECTED_GRANT_SECONDS * 1_000);
  assert.ok(
    responseExpiration <= issuedBefore + EXPECTED_GRANT_SECONDS * 1_000,
  );
  assert.ok(responseExpiration <= issuedBefore + MAX_GRANT_SECONDS * 1_000);

  const policy = parsePostPolicy(grant.upload.fields.Policy);
  const policyExpiration = Date.parse(policy.expiration);
  assert.ok(Number.isFinite(policyExpiration));
  assert.ok(policyExpiration > issuedAfter);
  assert.ok(policyExpiration <= issuedBefore + MAX_GRANT_SECONDS * 1_000);
  assert.ok(Math.abs(policyExpiration - responseExpiration) < 1_000);

  assertSingleCondition(
    policy.conditions,
    (condition) => exactObjectCondition(condition, "key", grant.storageKey),
    "exact key",
  );
  assertSingleCondition(
    policy.conditions,
    (condition) =>
      exactObjectCondition(condition, "Content-Type", DECK_MEDIA_TYPE),
    "exact content type",
  );
  assertSingleCondition(
    policy.conditions,
    exactLengthCondition,
    "content length range",
  );

  assert.equal(stagedCommand.input.Bucket, BUCKET);
  assert.equal(stagedCommand.input.Key, pendingRequestKey(grant.deckId));
  assert.equal(stagedCommand.input.IfNoneMatch, "*");
  assert.equal(
    stagedCommand.input.ContentType,
    "application/json; charset=utf-8",
  );
  assert.equal(stagedCommand.input.CacheControl, "no-store");
}

function stagedBody(command: PutObjectCommand): UnknownRecord {
  const body = command.input.Body;
  if (typeof body !== "string") {
    assert.fail("staged request body must be a string");
  }
  const parsed: unknown = JSON.parse(body);
  assert.ok(isRecord(parsed));
  return parsed;
}

const tokenArbitrary = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), {
    minLength: 1,
    maxLength: 24,
  })
  .map((characters) => characters.join(""));

const metadataArbitrary: fc.Arbitrary<GeneratedMetadata> = fc
  .record({
    token: tokenArbitrary,
    year: fc.integer({ min: 2000, max: 2099 }),
    draft: fc.boolean(),
    includeVideo: fc.boolean(),
  })
  .map(({ token, year, draft, includeVideo }) => ({
    title: `Talk ${token}`,
    eventName: `Event ${token}`,
    date: `${year.toString().padStart(4, "0")}-01-01`,
    location: `Location ${token}`,
    eventUrl: `https://events.example/${token}`,
    eventTypes: ["Conference"],
    ...(includeVideo ? { videoUrl: "https://youtu.be/abcdefghijk" } : {}),
    draft,
  }));

// Feature: talk-upload-endpoint, Property 1: Every accepted upload issues exactly one fully constrained grant
// **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3**
test("Property 1: accepted uploads issue one fully constrained grant", async () => {
  const capturedCommands: unknown[] = [];
  const sendImplementation = async (command: unknown): Promise<unknown> => {
    capturedCommands.push(command);
    if (command instanceof GetObjectCommand) {
      throw new S3ServiceException({
        name: "NoSuchKey",
        $fault: "client",
        $metadata: { httpStatusCode: 404 },
      });
    }
    if (command instanceof PutObjectCommand) {
      return { $metadata: {}, ETag: '"staged"' };
    }
    throw new Error("Unexpected AWS command in constrained grant test");
  };

  mock.method(
    S3Client.prototype,
    "send",
    sendImplementation as typeof S3Client.prototype.send,
  );
  mock.method(console, "log", () => undefined);

  const previousEnvironment = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_REGION: process.env.AWS_REGION,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    CONTENT_ALLOWED_CALLER_ARNS: process.env.CONTENT_ALLOWED_CALLER_ARNS,
    CONTENT_BUCKET_NAME: process.env.CONTENT_BUCKET_NAME,
  };
  process.env.AWS_ACCESS_KEY_ID = "AKIATESTONLY";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-access-key";
  process.env.AWS_REGION = "us-east-1";
  process.env.CONTENT_ALLOWED_CALLER_ARNS = ALLOWED_ARN;
  process.env.CONTENT_BUCKET_NAME = BUCKET;

  try {
    await fc.assert(
      fc.asyncProperty(metadataArbitrary, async (metadata) => {
        const deckOnlyCommandStart = capturedCommands.length;
        const deckOnlyIssuedAfter = Date.now();
        const deckOnlyResult = await invoke({});
        const deckOnlyIssuedBefore = Date.now();
        const deckOnlyCommands = capturedCommands.slice(deckOnlyCommandStart);
        assert.equal(deckOnlyCommands.length, 1);
        assert.ok(deckOnlyCommands[0] instanceof PutObjectCommand);

        const deckOnlyGrant = parseGrantResponse(deckOnlyResult);
        assertGrantConstraints(
          deckOnlyGrant,
          deckOnlyCommands[0],
          deckOnlyIssuedAfter,
          deckOnlyIssuedBefore,
        );
        assert.equal(deckOnlyGrant.recordKey, undefined);
        assert.deepEqual(stagedBody(deckOnlyCommands[0]), {});

        const metadataCommandStart = capturedCommands.length;
        const metadataIssuedAfter = Date.now();
        const metadataResult = await invoke({ metadata });
        const metadataIssuedBefore = Date.now();
        const metadataCommands = capturedCommands.slice(metadataCommandStart);
        assert.equal(metadataCommands.length, 2);
        assert.ok(metadataCommands[0] instanceof GetObjectCommand);
        assert.ok(metadataCommands[1] instanceof PutObjectCommand);

        const metadataGrant = parseGrantResponse(metadataResult);
        assertGrantConstraints(
          metadataGrant,
          metadataCommands[1],
          metadataIssuedAfter,
          metadataIssuedBefore,
        );
        assert.equal(metadataGrant.recordKey, expectedRecordKey(metadata));

        const staged = stagedBody(metadataCommands[1]);
        assert.deepEqual(Object.keys(staged), ["metadata"]);
        assert.deepEqual(staged.metadata, metadata);
        assert.notEqual(metadataGrant.deckId, deckOnlyGrant.deckId);
        assert.notEqual(metadataGrant.storageKey, deckOnlyGrant.storageKey);
      }),
      { numRuns: 100 },
    );
  } finally {
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    mock.restoreAll();
  }
});
