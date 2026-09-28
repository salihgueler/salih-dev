import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import fc from "fast-check";

import { handler } from "../functions/talk-records";

type StoredTalkRecordFixture = Readonly<{
  deckId: string;
  recordKey: string;
}>;

type Ownership = "api" | "git" | "absent";

type Scenario = Readonly<{
  targetSeed: number;
  targetOwnership: Ownership;
  otherOwnerships: readonly Ownership[];
}>;

type StoredRecord = Readonly<{
  body: string;
  etag: string;
  record: StoredTalkRecordFixture;
}>;

type StoreState = {
  apiRecords: Map<string, StoredRecord>;
  approvedDecks: Set<string>;
  buildCalls: number;
  gitRecordKeys: Set<string>;
  s3Calls: string[];
};

type StoreSnapshot = Readonly<{
  apiRecords: readonly (readonly [string, string])[];
  approvedDecks: readonly string[];
  gitRecordKeys: readonly string[];
}>;

type RemovalHandler = (
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
) => Promise<APIGatewayProxyResultV2>;

const AUTHOR_ARN = "arn:aws:iam::111122223333:root";
const BUCKET_NAME = "local-test-content";
const PROJECT_NAME = "local-test-publisher";
const VERSION = '"property-version"';

const ownershipArbitrary = fc.constantFrom<Ownership>("api", "git", "absent");
const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  targetSeed: fc.integer({ min: 0, max: 9_999 }),
  targetOwnership: ownershipArbitrary,
  otherOwnerships: fc.array(ownershipArbitrary, { maxLength: 12 }),
});

function recordKeyFor(date: string, title: string): string {
  const normalizedTitle = title
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  const identity = `${date}|${normalizedTitle}`;
  return `${date}-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

function approvedDeckKey(deckId: string): string {
  return `talks/decks/${deckId}.pdf`;
}

function createRecord(seed: number): Readonly<{
  body: string;
  record: StoredTalkRecordFixture;
}> {
  const day = (seed % 28) + 1;
  const year = 2000 + (Math.floor(seed / 28) % 100);
  const date = `${String(year).padStart(4, "0")}-01-${String(day).padStart(2, "0")}`;
  const title = `Property talk ${seed}`;
  const talkIdentity = `${date}|${title.toLowerCase()}`;
  const recordKey = recordKeyFor(date, title);
  const deckId = randomUUID();
  const timestamp = "2026-01-01T00:00:00.000Z";
  const storedValue = {
    schemaVersion: 1,
    talkIdentity,
    recordKey,
    deckId,
    deck: { byteLength: 1_024, pageCount: 2 },
    createdAt: timestamp,
    updatedAt: timestamp,
    frontmatter: {
      title,
      eventName: `Property event ${seed}`,
      date,
      location: "Test City",
      eventUrl: `https://example.com/talks/${seed}`,
      eventTypes: ["Conference"],
      slides: `/talks/slides/api/${deckId}.pdf`,
      draft: false,
    },
  };

  return {
    body: `${JSON.stringify(storedValue, null, 2)}\n`,
    record: { deckId, recordKey },
  };
}

function createState(scenario: Scenario): Readonly<{
  state: StoreState;
  targetKey: string;
}> {
  const state: StoreState = {
    apiRecords: new Map(),
    approvedDecks: new Set(),
    buildCalls: 0,
    gitRecordKeys: new Set(),
    s3Calls: [],
  };
  const ownerships = [scenario.targetOwnership, ...scenario.otherOwnerships];
  let targetKey: string | null = null;

  ownerships.forEach((ownership, index) => {
    const fixture = createRecord(scenario.targetSeed + index * 10_000);
    const { record } = fixture;
    if (index === 0) targetKey = record.recordKey;

    if (ownership === "api") {
      state.apiRecords.set(record.recordKey, {
        body: fixture.body,
        etag: VERSION,
        record,
      });
      state.approvedDecks.add(approvedDeckKey(record.deckId));
    } else if (ownership === "git") {
      state.gitRecordKeys.add(record.recordKey);
    }
  });

  if (targetKey === null) {
    throw new Error("A generated removal scenario must have a target");
  }
  return { state, targetKey };
}

function snapshot(state: StoreState): StoreSnapshot {
  return {
    apiRecords: [...state.apiRecords.entries()]
      .map(([key, value]) => [key, value.body] as const)
      .sort(([left], [right]) => left.localeCompare(right, "en")),
    approvedDecks: [...state.approvedDecks].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
    gitRecordKeys: [...state.gitRecordKeys].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
  };
}

function removalEvent(
  recordKey: string,
): APIGatewayProxyEventV2WithIAMAuthorizer {
  return {
    version: "2.0",
    routeKey: "DELETE /v1/talks/records/{recordKey}",
    rawPath: `/v1/talks/records/${recordKey}`,
    rawQueryString: "",
    headers: {
      "if-match": VERSION,
      "x-talk-removal": "confirmed",
    },
    requestContext: {
      accountId: "111122223333",
      apiId: "local-api",
      authorizer: {
        iam: {
          accessKey: "temporary-access-key",
          accountId: "111122223333",
          callerId: "local-caller",
          cognitoIdentity: null,
          principalOrgId: "",
          userArn: AUTHOR_ARN,
          userId: "local-user",
        },
      },
      domainName: "localhost",
      domainPrefix: "local",
      http: {
        method: "DELETE",
        path: `/v1/talks/records/${recordKey}`,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "local-property-test",
      },
      requestId: `request-${recordKey}`,
      routeKey: "DELETE /v1/talks/records/{recordKey}",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1_767_225_600_000,
    },
    pathParameters: { recordKey },
    isBase64Encoded: false,
  };
}

function structuredResponse(
  response: APIGatewayProxyResultV2,
): APIGatewayProxyStructuredResultV2 {
  if (typeof response !== "object" || response === null) {
    throw new Error("Expected a structured API Gateway response");
  }
  return response;
}

function responseBody(
  response: APIGatewayProxyStructuredResultV2,
): Readonly<Record<string, unknown>> {
  if (response.body === undefined) {
    throw new Error("Expected a JSON response body");
  }
  const parsed: unknown = JSON.parse(response.body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object response body");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function missingObject(): S3ServiceException {
  return new S3ServiceException({
    name: "NoSuchKey",
    $fault: "client",
    $metadata: { httpStatusCode: 404 },
  });
}

function installSendStub(
  prototype: object,
  replacement: (command: unknown) => Promise<unknown>,
): () => void {
  const previous = Object.getOwnPropertyDescriptor(prototype, "send");
  Object.defineProperty(prototype, "send", {
    configurable: true,
    value: replacement,
    writable: true,
  });

  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(prototype, "send");
    } else {
      Object.defineProperty(prototype, "send", previous);
    }
  };
}

function requiredState(state: StoreState | null): StoreState {
  if (state === null)
    throw new Error("Property store state is not initialized");
  return state;
}

// Feature: talk-upload-endpoint, Property 12: Removal resolves by owning store
// **Validates: Requirements 9.8**
test("Property 12: only API-owned talks are removable and rejected removals preserve every store", async () => {
  let currentState: StoreState | null = null;
  const originalConsoleLog = console.log;
  const originalEnvironment = {
    CONTENT_ALLOWED_CALLER_ARNS: process.env.CONTENT_ALLOWED_CALLER_ARNS,
    CONTENT_BUCKET_NAME: process.env.CONTENT_BUCKET_NAME,
    PUBLISHER_PROJECT_NAME: process.env.PUBLISHER_PROJECT_NAME,
    REPOSITORY_TALK_RECORD_KEYS: process.env.REPOSITORY_TALK_RECORD_KEYS,
  };

  const restoreS3 = installSendStub(S3Client.prototype, async (command) => {
    const state = requiredState(currentState);

    if (command instanceof GetObjectCommand) {
      const key = command.input.Key;
      state.s3Calls.push(`get:${key ?? ""}`);
      if (key === undefined) throw new Error("GetObject requires a key");
      const stored = state.apiRecords.get(
        key.replace(/^talks\/records\//u, "").replace(/\.json$/u, ""),
      );
      if (stored === undefined) throw missingObject();
      if (command.input.IfMatch !== stored.etag) {
        throw new S3ServiceException({
          name: "PreconditionFailed",
          $fault: "client",
          $metadata: { httpStatusCode: 412 },
        });
      }
      return {
        Body: {
          transformToString: async () => stored.body,
        },
        ETag: stored.etag,
        VersionId: `storage-${stored.record.recordKey}`,
      };
    }

    if (command instanceof DeleteObjectCommand) {
      const key = command.input.Key;
      state.s3Calls.push(`delete:${key ?? ""}`);
      if (key === undefined) throw new Error("DeleteObject requires a key");

      if (key.startsWith("talks/records/")) {
        const recordKey = key
          .replace(/^talks\/records\//u, "")
          .replace(/\.json$/u, "");
        const stored = state.apiRecords.get(recordKey);
        if (stored === undefined) throw missingObject();
        assert.equal(command.input.IfMatch, stored.etag);
        state.apiRecords.delete(recordKey);
      } else if (key.startsWith("talks/decks/")) {
        state.approvedDecks.delete(key);
      } else {
        throw new Error(`Unexpected DeleteObject key: ${key}`);
      }
      return {};
    }

    throw new Error(`Unexpected S3 command: ${command?.constructor.name}`);
  });

  const restoreCodeBuild = installSendStub(
    CodeBuildClient.prototype,
    async (command) => {
      const state = requiredState(currentState);
      assert.ok(command instanceof StartBuildCommand);
      assert.equal(command.input.projectName, PROJECT_NAME);
      state.buildCalls += 1;
      return { build: { id: "local-build" } };
    },
  );

  try {
    console.log = () => undefined;
    process.env.CONTENT_ALLOWED_CALLER_ARNS = AUTHOR_ARN;
    process.env.CONTENT_BUCKET_NAME = BUCKET_NAME;
    process.env.PUBLISHER_PROJECT_NAME = PROJECT_NAME;

    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async (scenario) => {
        const generated = createState(scenario);
        const { state, targetKey } = generated;
        currentState = state;
        process.env.REPOSITORY_TALK_RECORD_KEYS = [...state.gitRecordKeys].join(
          ",",
        );
        const before = snapshot(state);
        const target = state.apiRecords.get(targetKey)?.record;

        const result = structuredResponse(
          await (handler as RemovalHandler)(removalEvent(targetKey)),
        );
        const body = responseBody(result);

        if (scenario.targetOwnership === "api") {
          assert.equal(result.statusCode, 202);
          assert.equal(body.status, "publishing");
          assert.equal(body.recordKey, targetKey);
          assert.ok(target !== undefined);
          assert.equal(state.apiRecords.has(targetKey), false);
          assert.equal(
            state.approvedDecks.has(approvedDeckKey(target.deckId)),
            false,
          );
          assert.deepEqual(
            [...state.gitRecordKeys].sort((left, right) =>
              left.localeCompare(right, "en"),
            ),
            before.gitRecordKeys,
          );
          assert.equal(state.buildCalls, 1);
          assert.deepEqual(state.s3Calls, [
            `get:talks/records/${targetKey}.json`,
            `delete:talks/records/${targetKey}.json`,
            `delete:${approvedDeckKey(target.deckId)}`,
          ]);
          return;
        }

        assert.deepEqual(snapshot(state), before);
        assert.equal(state.buildCalls, 0);

        if (scenario.targetOwnership === "git") {
          assert.equal(result.statusCode, 409);
          assert.equal(body.error, "repository_authored_talk");
          assert.deepEqual(state.s3Calls, []);
        } else {
          assert.equal(result.statusCode, 404);
          assert.equal(body.error, "record_not_found");
          assert.deepEqual(state.s3Calls, [
            `get:talks/records/${targetKey}.json`,
          ]);
        }
      }),
      { numRuns: 150 },
    );
  } finally {
    currentState = null;
    restoreCodeBuild();
    restoreS3();
    console.log = originalConsoleLog;

    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
