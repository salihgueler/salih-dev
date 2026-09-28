import assert from "node:assert/strict";
import test from "node:test";

import { CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import fc from "fast-check";

import { handler as recordsHandler } from "../functions/talk-records";
import { handler as uploadStartHandler } from "../functions/talk-upload-start";

const EDITOR_ARN = "arn:aws:iam::123456789012:root";
const MATCHING_VERSION = '"version-current"';
const STALE_VERSION = '"version-stale"';
const DECK_ID = "00000000-0000-4000-8000-000000000001";

let recordKey = "";
let storedRecordBody = "";

type RouteKind = "removal" | "replacement";
type PreconditionShape = "invalid" | "missing" | "valid";
type Scenario = Readonly<{
  route: RouteKind;
  targetPresent: boolean;
  versionMatches: boolean;
}>;
type ExpectedResponse = Readonly<{
  statusCode: number;
  error?: string;
}>;
type AsyncHandler = (
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
) => Promise<APIGatewayProxyStructuredResultV2>;

const invokeRecords = recordsHandler as AsyncHandler;
const invokeUploadStart = uploadStartHandler as AsyncHandler;

let activeScenario: Scenario | null = null;
let mutatingStoreCalls: string[] = [];
let buildStartCalls = 0;

function scenario(): Scenario {
  const current = activeScenario;
  if (current === null) {
    throw new Error("An active property scenario is required");
  }
  return current;
}

function serviceError(statusCode: number): S3ServiceException {
  return new S3ServiceException({
    name: statusCode === 404 ? "NoSuchKey" : "PreconditionFailed",
    $fault: "client",
    $metadata: { httpStatusCode: statusCode },
    message: "Stubbed S3 response",
  });
}

function storedRecordResult(etag: string): Readonly<{
  Body: Readonly<{ transformToString: () => Promise<string> }>;
  ETag: string;
}> {
  return Object.freeze({
    Body: Object.freeze({
      transformToString: async () => storedRecordBody,
    }),
    ETag: etag,
  });
}

function event(
  method: "DELETE" | "POST",
  headers: Readonly<Record<string, string>>,
  body?: string,
): APIGatewayProxyEventV2WithIAMAuthorizer {
  const path =
    method === "DELETE"
      ? `/v1/talks/records/${recordKey}`
      : "/v1/talks/uploads";

  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { ...headers },
    requestContext: {
      accountId: "123456789012",
      apiId: "property-test-api",
      authorizer: {
        iam: {
          accessKey: "property-test-access-key",
          accountId: "123456789012",
          callerId: "property-test-caller",
          cognitoIdentity: null,
          principalOrgId: "o-property-test",
          userArn: EDITOR_ARN,
          userId: "property-test-user",
        },
      },
      domainName: "example.test",
      domainPrefix: "example",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "property-test",
      },
      requestId: "property-test-request",
      routeKey: `${method} ${path}`,
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1_767_225_600_000,
    },
    ...(method === "DELETE" ? { pathParameters: { recordKey } } : {}),
    ...(body === undefined ? {} : { body }),
    isBase64Encoded: false,
  };
}

function expectedResponse(
  shape: PreconditionShape,
  targetPresent: boolean,
  versionMatches: boolean,
): ExpectedResponse {
  if (shape === "missing") {
    return { statusCode: 428, error: "precondition_required" };
  }
  if (shape === "invalid") {
    return { statusCode: 400, error: "invalid_precondition" };
  }
  if (!targetPresent) {
    return { statusCode: 404, error: "record_not_found" };
  }
  if (!versionMatches) {
    return { statusCode: 412, error: "record_changed" };
  }
  return { statusCode: 201 };
}

function responseError(
  response: APIGatewayProxyStructuredResultV2,
): string | undefined {
  const responseBody = response.body;
  if (typeof responseBody !== "string") {
    throw new TypeError("The handler response body must be a JSON string");
  }
  const parsed = JSON.parse(responseBody) as unknown;
  assert.equal(typeof parsed, "object");
  assert.notEqual(parsed, null);
  const body = parsed as Readonly<Record<string, unknown>>;
  return typeof body.error === "string" ? body.error : undefined;
}

function replacementBody(
  shape: PreconditionShape,
  invalidValue: string,
): string {
  const replaces: Record<string, unknown> = { recordKey };
  if (shape === "valid") replaces.version = MATCHING_VERSION;
  if (shape === "invalid") replaces.version = invalidValue;
  return JSON.stringify({ replaces });
}

function removalHeaders(
  shape: PreconditionShape,
  invalidValue: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    "x-talk-removal": "confirmed",
    ...(shape === "valid" ? { "if-match": MATCHING_VERSION } : {}),
    ...(shape === "invalid" ? { "if-match": invalidValue } : {}),
  });
}

const invalidEntityTagArbitrary = fc.constantFrom(
  "*",
  "version-without-quotes",
  'W/"weak-version"',
  '"unterminated',
  '"first", "second"',
  '"contains space"',
);
const preconditionShapeArbitrary = fc.constantFrom<PreconditionShape>(
  "missing",
  "invalid",
  "valid",
);
const preconditionCaseArbitrary = fc.record({
  shape: preconditionShapeArbitrary,
  invalidValue: invalidEntityTagArbitrary,
  targetPresent: fc.boolean(),
  versionMatches: fc.boolean(),
});

// Feature: talk-upload-endpoint, Property 11: Version preconditions decide every mutating request
// **Validates: Requirements 9.1, 9.2, 9.3, 9.5**
test("Property 11: version preconditions decide replacement and removal mutations", async (context) => {
  const [deckModule, identityModule] = await Promise.all([
    import("../../src/lib/talks/deck.js"),
    import("../../src/lib/talks/identity.js"),
  ]);
  assert.equal(deckModule.isDeckId(DECK_ID), true);
  const talkIdentity = identityModule.deriveTalkIdentity(
    "2026-06-18",
    "Property test talk",
  );
  recordKey = identityModule.deriveTalkRecordKey(talkIdentity);
  storedRecordBody = JSON.stringify({
    schemaVersion: 1,
    talkIdentity,
    recordKey,
    deckId: DECK_ID,
    deck: { byteLength: 1_024, pageCount: 2 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    frontmatter: {
      title: "Property test talk",
      eventName: "Property Test Conference",
      date: "2026-06-18",
      location: "Berlin, Germany",
      eventUrl: "https://example.com/property-test-talk",
      eventTypes: ["Conference"],
      slides: `/talks/slides/api/${DECK_ID}.pdf`,
      draft: false,
    },
  });

  const originalS3Send = S3Client.prototype.send;
  const originalCodeBuildSend = CodeBuildClient.prototype.send;
  const originalConsoleLog = console.log;
  const environment = [
    "AWS_ACCESS_KEY_ID",
    "AWS_REGION",
    "AWS_SECRET_ACCESS_KEY",
    "CONTENT_ALLOWED_CALLER_ARNS",
    "CONTENT_BUCKET_NAME",
    "PUBLISHER_PROJECT_NAME",
    "REPOSITORY_TALK_RECORD_KEYS",
  ] as const;
  const previousEnvironment = new Map(
    environment.map((name) => [name, process.env[name]] as const),
  );

  Object.assign(process.env, {
    AWS_ACCESS_KEY_ID: "property-test-access-key",
    AWS_REGION: "us-east-1",
    AWS_SECRET_ACCESS_KEY: "property-test-secret-key",
    CONTENT_ALLOWED_CALLER_ARNS: EDITOR_ARN,
    CONTENT_BUCKET_NAME: "property-test-content-bucket",
    PUBLISHER_PROJECT_NAME: "property-test-publisher",
    REPOSITORY_TALK_RECORD_KEYS: "",
  });
  console.log = () => undefined;

  S3Client.prototype.send = (async (command: unknown) => {
    const current = scenario();
    if (command instanceof GetObjectCommand) {
      if (!current.targetPresent) throw serviceError(404);
      if (current.route === "removal" && !current.versionMatches) {
        throw serviceError(412);
      }
      return storedRecordResult(
        current.versionMatches ? MATCHING_VERSION : STALE_VERSION,
      );
    }
    if (command instanceof PutObjectCommand) {
      mutatingStoreCalls.push("PutObject");
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      mutatingStoreCalls.push("DeleteObject");
      return {};
    }
    throw new Error(`Unexpected S3 command: ${String(command)}`);
  }) as S3Client["send"];

  CodeBuildClient.prototype.send = (async (command: unknown) => {
    assert.ok(command instanceof StartBuildCommand);
    buildStartCalls += 1;
    return { build: { id: "property-test-build" } };
  }) as CodeBuildClient["send"];

  context.after(() => {
    S3Client.prototype.send = originalS3Send;
    CodeBuildClient.prototype.send = originalCodeBuildSend;
    console.log = originalConsoleLog;
    for (const name of environment) {
      const previous = previousEnvironment.get(name);
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  await fc.assert(
    fc.asyncProperty(preconditionCaseArbitrary, async (generated) => {
      activeScenario = {
        route: "replacement",
        targetPresent: generated.targetPresent,
        versionMatches: generated.versionMatches,
      };
      mutatingStoreCalls = [];
      buildStartCalls = 0;

      const response = await invokeUploadStart(
        event(
          "POST",
          { "content-type": "application/json" },
          replacementBody(generated.shape, generated.invalidValue),
        ),
      );
      const expected = expectedResponse(
        generated.shape,
        generated.targetPresent,
        generated.versionMatches,
      );

      assert.equal(response.statusCode, expected.statusCode);
      assert.equal(responseError(response), expected.error);
      if (expected.error === undefined) {
        assert.deepEqual(mutatingStoreCalls, ["PutObject"]);
      } else {
        assert.deepEqual(mutatingStoreCalls, []);
      }
      assert.equal(buildStartCalls, 0);
    }),
    { numRuns: 128 },
  );

  await fc.assert(
    fc.asyncProperty(preconditionCaseArbitrary, async (generated) => {
      activeScenario = {
        route: "removal",
        targetPresent: generated.targetPresent,
        versionMatches: generated.versionMatches,
      };
      mutatingStoreCalls = [];
      buildStartCalls = 0;

      const response = await invokeRecords(
        event(
          "DELETE",
          removalHeaders(generated.shape, generated.invalidValue),
        ),
      );
      const replacementExpectation = expectedResponse(
        generated.shape,
        generated.targetPresent,
        generated.versionMatches,
      );
      const expected = Object.freeze({
        ...replacementExpectation,
        ...(replacementExpectation.error === undefined
          ? { statusCode: 202 }
          : {}),
      });

      assert.equal(response.statusCode, expected.statusCode);
      assert.equal(responseError(response), expected.error);
      if (expected.error === undefined) {
        assert.deepEqual(mutatingStoreCalls, ["DeleteObject", "DeleteObject"]);
        assert.equal(buildStartCalls, 1);
      } else {
        assert.deepEqual(mutatingStoreCalls, []);
        assert.equal(buildStartCalls, 0);
      }
    }),
    { numRuns: 128 },
  );
});
