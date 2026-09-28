import assert from "node:assert/strict";
import test from "node:test";

import { CodeBuildClient } from "@aws-sdk/client-codebuild";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import fc from "fast-check";

import { handler } from "../functions/talk-upload-complete";

const ALLOWED_ARN = "arn:aws:iam::123456789012:root";
const DECK_ID = "00000000-0000-4000-8000-000000000000";
const PENDING_ETAG = '"pending-etag"';
const DECK_MEDIA_TYPE = "application/pdf";
const DECK_MAX_BYTES = 26_214_400;
const APPROVED_CRITERIA = ["4.2", "4.3", "4.4", "4.5", "4.6"] as const;

type ApprovedCriterion = (typeof APPROVED_CRITERIA)[number];
type GeneratedCriterion = Extract<ApprovedCriterion, "4.2" | "4.3">;

type RejectionScenario = Readonly<{
  contentType: string;
  contentLength: number;
  bytes: Uint8Array | null;
  expectedCriterion: GeneratedCriterion;
}>;

type MutationCounts = {
  approvedDeckWrites: number;
  recordWrites: number;
  deletes: number;
  publisherInvocations: number;
};

function completionEvent(): APIGatewayProxyEventV2WithIAMAuthorizer {
  return {
    version: "2.0",
    routeKey: "POST /v1/talks/uploads/{deckId}/completion",
    rawPath: `/v1/talks/uploads/${DECK_ID}/completion`,
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "123456789012",
      apiId: "local-test",
      authorizer: {
        iam: {
          accessKey: "temporary-test-access-key",
          accountId: "123456789012",
          callerId: "local-test-caller",
          cognitoIdentity: null,
          principalOrgId: "",
          userArn: ALLOWED_ARN,
          userId: "local-test-user",
        },
      },
      domainName: "local.test",
      domainPrefix: "local",
      http: {
        method: "POST",
        path: `/v1/talks/uploads/${DECK_ID}/completion`,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "local-property-test",
      },
      requestId: "property-13-request",
      routeKey: "POST /v1/talks/uploads/{deckId}/completion",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1_767_225_600_000,
    },
    pathParameters: { deckId: DECK_ID },
    isBase64Encoded: false,
  };
}

function structuredResponse(
  result: APIGatewayProxyResultV2 | void,
): APIGatewayProxyStructuredResultV2 {
  assert.notEqual(result, undefined);
  assert.equal(typeof result, "object");
  assert.notEqual(result, null);
  return result as APIGatewayProxyStructuredResultV2;
}

function responseBody(
  response: APIGatewayProxyStructuredResultV2,
): Record<string, unknown> {
  const serialized = response.body;
  if (typeof serialized !== "string") {
    assert.fail("Expected a serialized JSON response body");
  }
  const parsed: unknown = JSON.parse(serialized);
  assert.equal(typeof parsed, "object");
  assert.notEqual(parsed, null);
  assert.equal(Array.isArray(parsed), false);
  return parsed as Record<string, unknown>;
}

function restoreProperty(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    assert.equal(Reflect.deleteProperty(target, property), true);
    return;
  }
  Object.defineProperty(target, property, descriptor);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

const wrongMediaTypeArbitrary = fc
  .string({ maxLength: 48 })
  .filter((contentType) => contentType !== DECK_MEDIA_TYPE);

const boundaryLengthArbitrary = fc.constantFrom(
  0,
  1,
  2,
  DECK_MAX_BYTES - 1,
  DECK_MAX_BYTES,
  DECK_MAX_BYTES + 1,
);

const invalidSizeArbitrary = fc.constantFrom(0, DECK_MAX_BYTES + 1);

const arbitraryNonPdfBytes = fc
  .uint8Array({ minLength: 1, maxLength: 96 })
  .filter(
    (bytes) =>
      bytes.length < 5 ||
      bytes[0] !== 0x25 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x44 ||
      bytes[3] !== 0x46 ||
      bytes[4] !== 0x2d,
  );

const truncatedPdfHeader = fc
  .integer({ min: 1, max: 4 })
  .map((length) =>
    Uint8Array.from(Buffer.from("%PDF-", "ascii").subarray(0, length)),
  );

const rejectionSetArbitrary = fc
  .tuple(
    wrongMediaTypeArbitrary,
    boundaryLengthArbitrary,
    invalidSizeArbitrary,
    arbitraryNonPdfBytes,
    truncatedPdfHeader,
  )
  .map(
    ([
      wrongMediaType,
      boundaryLength,
      invalidSize,
      arbitraryBytes,
      truncatedBytes,
    ]): readonly RejectionScenario[] => [
      {
        contentType: wrongMediaType,
        contentLength: boundaryLength,
        bytes: null,
        expectedCriterion: "4.2",
      },
      {
        contentType: DECK_MEDIA_TYPE,
        contentLength: invalidSize,
        bytes: null,
        expectedCriterion: "4.2",
      },
      {
        contentType: DECK_MEDIA_TYPE,
        contentLength: arbitraryBytes.byteLength,
        bytes: arbitraryBytes,
        expectedCriterion: "4.3",
      },
      {
        contentType: DECK_MEDIA_TYPE,
        contentLength: truncatedBytes.byteLength,
        bytes: truncatedBytes,
        expectedCriterion: "4.3",
      },
    ],
  );

// Feature: talk-upload-endpoint, Property 13: Rejected deck bytes name a criterion and record nothing
// **Validates: Requirements 4.2, 4.3, 4.7**
test("Property 13: every rejected deck fails closed with exactly one approved criterion", async () => {
  const originalS3Send = Object.getOwnPropertyDescriptor(
    S3Client.prototype,
    "send",
  );
  const originalCodeBuildSend = Object.getOwnPropertyDescriptor(
    CodeBuildClient.prototype,
    "send",
  );
  const originalConsoleLog = console.log;
  const originalAllowedArns = process.env.CONTENT_ALLOWED_CALLER_ARNS;
  const originalBucket = process.env.CONTENT_BUCKET_NAME;
  const originalPublisher = process.env.PUBLISHER_PROJECT_NAME;

  let activeScenario: RejectionScenario | null = null;
  let mutationCounts: MutationCounts = {
    approvedDeckWrites: 0,
    recordWrites: 0,
    deletes: 0,
    publisherInvocations: 0,
  };

  Object.defineProperty(S3Client.prototype, "send", {
    configurable: true,
    value: async (command: unknown): Promise<unknown> => {
      assert.notEqual(activeScenario, null);
      const scenario = activeScenario as RejectionScenario;

      if (command instanceof GetObjectCommand) {
        if (command.input.Key?.endsWith(".upload.json") === true) {
          return {
            Body: {
              transformToString: async (): Promise<string> => "{}",
            },
          };
        }

        assert.notEqual(scenario.bytes, null);
        return {
          Body: {
            transformToByteArray: async (): Promise<Uint8Array> =>
              scenario.bytes as Uint8Array,
          },
          ContentLength: scenario.contentLength,
          ContentType: scenario.contentType,
          ETag: PENDING_ETAG,
        };
      }

      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: scenario.contentLength,
          ContentType: scenario.contentType,
          ETag: PENDING_ETAG,
        };
      }

      if (command instanceof CopyObjectCommand) {
        mutationCounts.approvedDeckWrites += 1;
        return { VersionId: "unexpected-approved-version" };
      }

      if (command instanceof PutObjectCommand) {
        mutationCounts.recordWrites += 1;
        return { ETag: '"unexpected-record-version"' };
      }

      if (command instanceof DeleteObjectCommand) {
        mutationCounts.deletes += 1;
        return {};
      }

      assert.fail(`Unexpected S3 command: ${String(command)}`);
    },
    writable: true,
  });

  Object.defineProperty(CodeBuildClient.prototype, "send", {
    configurable: true,
    value: async (): Promise<unknown> => {
      mutationCounts.publisherInvocations += 1;
      return { build: { id: "unexpected-build" } };
    },
    writable: true,
  });

  process.env.CONTENT_ALLOWED_CALLER_ARNS = ALLOWED_ARN;
  process.env.CONTENT_BUCKET_NAME = "local-property-test-bucket";
  process.env.PUBLISHER_PROJECT_NAME = "local-property-test-publisher";
  console.log = (): void => undefined;

  try {
    await fc.assert(
      fc.asyncProperty(rejectionSetArbitrary, async (scenarios) => {
        for (const scenario of scenarios) {
          activeScenario = scenario;
          mutationCounts = {
            approvedDeckWrites: 0,
            recordWrites: 0,
            deletes: 0,
            publisherInvocations: 0,
          };

          const result = await handler(
            completionEvent(),
            {} as Context,
            () => undefined,
          );
          const response = structuredResponse(result);
          const body = responseBody(response);

          assert.equal(response.statusCode, 422);
          assert.deepEqual(Object.keys(body).sort(), [
            "criterion",
            "error",
            "message",
          ]);
          assert.equal(body.error, "deck_validation_failed");
          assert.equal(body.criterion, scenario.expectedCriterion);

          const namedApprovedCriteria = Object.values(body).filter(
            (value): value is ApprovedCriterion =>
              typeof value === "string" &&
              APPROVED_CRITERIA.some((criterion) => criterion === value),
          );
          assert.deepEqual(namedApprovedCriteria, [scenario.expectedCriterion]);
          assert.deepEqual(mutationCounts, {
            approvedDeckWrites: 0,
            recordWrites: 0,
            deletes: 0,
            publisherInvocations: 0,
          });
        }
      }),
      { numRuns: 100 },
    );
  } finally {
    activeScenario = null;
    console.log = originalConsoleLog;
    restoreEnvironment("CONTENT_ALLOWED_CALLER_ARNS", originalAllowedArns);
    restoreEnvironment("CONTENT_BUCKET_NAME", originalBucket);
    restoreEnvironment("PUBLISHER_PROJECT_NAME", originalPublisher);
    restoreProperty(S3Client.prototype, "send", originalS3Send);
    restoreProperty(CodeBuildClient.prototype, "send", originalCodeBuildSend);
  }
});
