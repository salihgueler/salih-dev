import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import type { ApiTalkRecord } from "../../src/lib/talks/api-record.js" with {
  "resolution-mode": "import",
};
import { handler as recordsHandler } from "../functions/talk-records";
import { handler as completionHandler } from "../functions/talk-upload-complete";
import { handler as startHandler } from "../functions/talk-upload-start";

const EDITOR_ARN = "arn:aws:iam::123456789012:root";
const FOREIGN_ARN = "arn:aws:iam::999999999999:root";
const BUCKET = "integration-content-bucket";
const DISTRIBUTION_ID = "INTEGRATIONDIST";
const DECK_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_DECK_ID = "20000000-0000-4000-8000-000000000002";
const PENDING_ETAG = '"pending-version"';
const RECORD_ETAG = '"record-version"';
const STALE_ETAG = '"stale-version"';

type AsyncHandler = (
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
) => Promise<APIGatewayProxyStructuredResultV2>;

type AwsSend = (command: unknown) => Promise<unknown>;
type PdfFixtures = Readonly<{
  truncated: Uint8Array;
  encryptedUnreadable: Uint8Array;
  zeroPage: Uint8Array;
  singlePage: Uint8Array;
  multiPage: Uint8Array;
}>;
type ParseApiTalkRecord = (value: unknown) => ApiTalkRecord | null;
type SerializeApiTalkRecord = (record: ApiTalkRecord) => string;
type DeriveTalkIdentity = (date: string, title: string) => string;
type DeriveTalkRecordKey = (identity: string) => string;

let parseApiTalkRecordImplementation: ParseApiTalkRecord | null = null;
let serializeApiTalkRecordImplementation: SerializeApiTalkRecord | null = null;
let deriveTalkIdentityImplementation: DeriveTalkIdentity | null = null;
let deriveTalkRecordKeyImplementation: DeriveTalkRecordKey | null = null;
let pdfFixtures: PdfFixtures | null = null;

function parseApiTalkRecord(value: unknown): ApiTalkRecord | null {
  if (parseApiTalkRecordImplementation === null) {
    throw new Error("API record module has not been loaded");
  }
  return parseApiTalkRecordImplementation(value);
}

function serializeApiTalkRecord(record: ApiTalkRecord): string {
  if (serializeApiTalkRecordImplementation === null) {
    throw new Error("API record module has not been loaded");
  }
  return serializeApiTalkRecordImplementation(record);
}

function deriveTalkIdentity(date: string, title: string): string {
  if (deriveTalkIdentityImplementation === null) {
    throw new Error("Talk identity module has not been loaded");
  }
  return deriveTalkIdentityImplementation(date, title);
}

function deriveTalkRecordKey(identity: string): string {
  if (deriveTalkRecordKeyImplementation === null) {
    throw new Error("Talk identity module has not been loaded");
  }
  return deriveTalkRecordKeyImplementation(identity);
}

function fixtures(): PdfFixtures {
  if (pdfFixtures === null)
    throw new Error("PDF fixtures have not been loaded");
  return pdfFixtures;
}

const invokeStart = startHandler as AsyncHandler;
const invokeCompletion = completionHandler as AsyncHandler;
const invokeRecords = recordsHandler as AsyncHandler;

const metadata = Object.freeze({
  title: "Focused integration talk",
  eventName: "Integration Conference",
  date: "2026-06-18",
  location: "Berlin, Germany",
  eventUrl: "https://example.com/focused-integration-talk",
  eventTypes: Object.freeze(["Conference"]),
  draft: false,
});

function apiEvent(
  options: Readonly<{
    method: "DELETE" | "GET" | "POST";
    path: string;
    body?: string;
    headers?: Readonly<Record<string, string>>;
    pathParameters?: Readonly<Record<string, string>>;
    userArn?: string;
  }>,
): APIGatewayProxyEventV2WithIAMAuthorizer {
  return {
    version: "2.0",
    routeKey: `${options.method} ${options.path}`,
    rawPath: options.path,
    rawQueryString: "",
    headers: { ...options.headers },
    requestContext: {
      accountId: "123456789012",
      apiId: "integration-api",
      authorizer: {
        iam: {
          accessKey: "ASIATEMPORARY",
          accountId: "123456789012",
          callerId: "integration-caller",
          cognitoIdentity: null,
          principalOrgId: "o-integration",
          userArn: options.userArn ?? EDITOR_ARN,
          userId: "integration-user",
        },
      },
      domainName: "api.example.test",
      domainPrefix: "api",
      http: {
        method: options.method,
        path: options.path,
        protocol: "HTTP/1.1",
        sourceIp: "192.0.2.10",
        userAgent: "integration-test",
      },
      requestId: `request-${options.method.toLowerCase()}`,
      routeKey: `${options.method} ${options.path}`,
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1_767_225_600_000,
    },
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.pathParameters === undefined
      ? {}
      : { pathParameters: { ...options.pathParameters } }),
    isBase64Encoded: false,
  };
}

function startEvent(body?: string, userArn?: string) {
  return apiEvent({
    method: "POST",
    path: "/v1/talks/uploads",
    ...(body === undefined ? {} : { body }),
    ...(userArn === undefined ? {} : { userArn }),
  });
}

function completionEvent(
  options: Readonly<{
    deckId?: string;
    body?: string;
    userArn?: string;
  }> = {},
) {
  const deckId = options.deckId ?? DECK_ID;
  return apiEvent({
    method: "POST",
    path: `/v1/talks/uploads/${deckId}/completion`,
    pathParameters: { deckId },
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.userArn === undefined ? {} : { userArn: options.userArn }),
  });
}

function recordsEvent(
  options: Readonly<{
    method: "DELETE" | "GET";
    recordKey?: string;
    headers?: Readonly<Record<string, string>>;
    userArn?: string;
  }>,
) {
  const path =
    options.method === "GET"
      ? "/v1/talks/records"
      : `/v1/talks/records/${options.recordKey ?? "missing"}`;
  return apiEvent({
    method: options.method,
    path,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.method === "DELETE"
      ? { pathParameters: { recordKey: options.recordKey ?? "missing" } }
      : {}),
    ...(options.userArn === undefined ? {} : { userArn: options.userArn }),
  });
}

function responseBody(
  response: APIGatewayProxyStructuredResultV2,
): Readonly<Record<string, unknown>> {
  if (typeof response.body !== "string") {
    assert.fail("Expected a serialized JSON response body");
  }
  const parsed: unknown = JSON.parse(response.body);
  assert.ok(
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
  );
  return parsed as Readonly<Record<string, unknown>>;
}

function s3Error(statusCode: 404 | 412): S3ServiceException {
  return new S3ServiceException({
    name: statusCode === 404 ? "NoSuchKey" : "PreconditionFailed",
    $fault: "client",
    $metadata: { httpStatusCode: statusCode },
  });
}

function stringBody(value: string) {
  return {
    transformToString: async (): Promise<string> => value,
  };
}

function byteBody(value: Uint8Array) {
  return {
    transformToByteArray: async (): Promise<Uint8Array> => value,
  };
}

function storedRecord(
  deckId: string,
  overrides: Readonly<{ title?: string; date?: string }> = {},
): ApiTalkRecord {
  const title = overrides.title ?? metadata.title;
  const date = overrides.date ?? metadata.date;
  const talkIdentity = deriveTalkIdentity(date, title);
  const recordKey = deriveTalkRecordKey(talkIdentity);
  const value: unknown = {
    schemaVersion: 1,
    talkIdentity,
    recordKey,
    deckId,
    deck: { byteLength: 1_024, pageCount: 2 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    frontmatter: {
      ...metadata,
      title,
      date,
      slides: `/talks/slides/api/${deckId}.pdf`,
    },
  };
  const parsed = parseApiTalkRecord(value);
  if (parsed === null)
    assert.fail("The integration stored-record fixture is invalid");
  return parsed;
}

function stagedBody(
  options: Readonly<{
    replaces?: Readonly<{ recordKey: string; version: string }>;
    metadata?: Readonly<Record<string, unknown>>;
  }> = {},
): string {
  return JSON.stringify({
    metadata: options.metadata ?? metadata,
    ...(options.replaces === undefined ? {} : { replaces: options.replaces }),
  });
}

function pendingHead(bytes: Uint8Array) {
  return {
    ContentLength: bytes.byteLength,
    ContentType: "application/pdf",
    ETag: PENDING_ETAG,
  };
}

function pendingObject(bytes: Uint8Array) {
  const responseBytes = Uint8Array.from(bytes);
  return {
    Body: byteBody(responseBytes),
    ContentLength: responseBytes.byteLength,
    ContentType: "application/pdf",
    ETag: PENDING_ETAG,
  };
}

function pendingKey(deckId: string): string {
  return `talks/pending/${deckId}.pdf`;
}

function stagedKey(deckId: string): string {
  return `talks/pending/${deckId}.upload.json`;
}

function approvedKey(deckId: string): string {
  return `talks/decks/${deckId}.pdf`;
}

function recordObjectKey(recordKey: string): string {
  return `talks/records/${recordKey}.json`;
}

function policyConditions(
  response: APIGatewayProxyStructuredResultV2,
): readonly unknown[] {
  const body = responseBody(response);
  const upload = body.upload;
  assert.ok(
    typeof upload === "object" && upload !== null && !Array.isArray(upload),
  );
  const fields = (upload as Readonly<Record<string, unknown>>).fields;
  assert.ok(
    typeof fields === "object" && fields !== null && !Array.isArray(fields),
  );
  const policy = (fields as Readonly<Record<string, unknown>>).Policy;
  if (typeof policy !== "string") {
    assert.fail("Expected the presigned POST policy to be a string");
  }
  const decoded: unknown = JSON.parse(
    Buffer.from(policy, "base64").toString("utf8"),
  );
  assert.ok(
    typeof decoded === "object" && decoded !== null && !Array.isArray(decoded),
  );
  const conditions = (decoded as Readonly<Record<string, unknown>>).conditions;
  assert.ok(Array.isArray(conditions));
  return conditions;
}

function exactCondition(
  conditions: readonly unknown[],
  field: string,
  expected: string,
): boolean {
  return conditions.some(
    (condition) =>
      typeof condition === "object" &&
      condition !== null &&
      !Array.isArray(condition) &&
      Reflect.ownKeys(condition).length === 1 &&
      (condition as Readonly<Record<string, unknown>>)[field] === expected,
  );
}

function removalHeaders(version: string = RECORD_ETAG) {
  return { "if-match": version, "x-talk-removal": "confirmed" };
}

function commandName(command: unknown): string {
  if (command instanceof GetObjectCommand) return `get:${command.input.Key}`;
  if (command instanceof HeadObjectCommand) return `head:${command.input.Key}`;
  if (command instanceof CopyObjectCommand) return `copy:${command.input.Key}`;
  if (command instanceof PutObjectCommand) return `put:${command.input.Key}`;
  if (command instanceof DeleteObjectCommand)
    return `delete:${command.input.Key}`;
  if (command instanceof ListObjectsV2Command) return "list";
  return "unknown";
}

test("talk upload handlers integrate through stubbed AWS clients", async (t) => {
  const [apiRecordModule, identityModule, pdfFixtureModule] = await Promise.all(
    [
      import("../../src/lib/talks/api-record.js"),
      import("../../src/lib/talks/identity.js"),
      import("../../src/lib/talks/__fixtures__/pdf.js"),
    ],
  );
  parseApiTalkRecordImplementation = apiRecordModule.parseApiTalkRecord;
  serializeApiTalkRecordImplementation = apiRecordModule.serializeApiTalkRecord;
  deriveTalkIdentityImplementation = (date, title) =>
    identityModule.deriveTalkIdentity(date, title);
  deriveTalkRecordKeyImplementation = (identity) =>
    identityModule.deriveTalkRecordKey(
      identity as ReturnType<typeof identityModule.deriveTalkIdentity>,
    );
  pdfFixtures = pdfFixtureModule.PDF_TEST_FIXTURES;

  const originalS3Send = S3Client.prototype.send;
  const originalCloudFrontSend = CloudFrontClient.prototype.send;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const environmentNames = [
    "AWS_ACCESS_KEY_ID",
    "AWS_REGION",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "CONTENT_ALLOWED_CALLER_ARNS",
    "CONTENT_BUCKET_NAME",
    "DISTRIBUTION_ID",
    "REPOSITORY_TALK_RECORD_KEYS",
  ] as const;
  const previousEnvironment = new Map(
    environmentNames.map((name) => [name, process.env[name]] as const),
  );

  let s3Send: AwsSend = async (command) => {
    throw new Error(`Unexpected S3 command: ${commandName(command)}`);
  };
  let cloudFrontSend: AwsSend = async () => {
    throw new Error("Unexpected CloudFront command");
  };

  S3Client.prototype.send = (async (command: unknown) =>
    s3Send(command)) as S3Client["send"];
  CloudFrontClient.prototype.send = (async (command: unknown) =>
    cloudFrontSend(command)) as CloudFrontClient["send"];

  Object.assign(process.env, {
    AWS_ACCESS_KEY_ID: "ASIATESTONLY",
    AWS_REGION: "us-east-1",
    AWS_SECRET_ACCESS_KEY: "integration-secret-key",
    AWS_SESSION_TOKEN: "integration-session-token",
    CONTENT_ALLOWED_CALLER_ARNS: EDITOR_ARN,
    CONTENT_BUCKET_NAME: BUCKET,
    DISTRIBUTION_ID: DISTRIBUTION_ID,
    REPOSITORY_TALK_RECORD_KEYS: "",
  });
  console.log = () => undefined;
  console.error = () => undefined;

  t.after(() => {
    S3Client.prototype.send = originalS3Send;
    CloudFrontClient.prototype.send = originalCloudFrontSend;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    for (const name of environmentNames) {
      const previous = previousEnvironment.get(name);
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  await t.test(
    "authorizes every handler before parsing or calling AWS",
    async () => {
      const calls: string[] = [];
      s3Send = async (command) => {
        calls.push(commandName(command));
        return {};
      };
      cloudFrontSend = async () => {
        calls.push("invalidate");
        return { Invalidation: { Id: "unexpected" } };
      };

      const responses = await Promise.all([
        invokeStart(startEvent("{", FOREIGN_ARN)),
        invokeCompletion(
          completionEvent({ body: "not-json", userArn: FOREIGN_ARN }),
        ),
        invokeRecords(recordsEvent({ method: "GET", userArn: FOREIGN_ARN })),
      ]);

      for (const response of responses) {
        assert.equal(response.statusCode, 403);
        assert.equal(responseBody(response).error, "forbidden");
      }
      assert.deepEqual(calls, []);
    },
  );

  await t.test(
    "enforces start body boundaries and names every unknown member",
    async () => {
      const calls: unknown[] = [];
      s3Send = async (command) => {
        calls.push(command);
        if (command instanceof PutObjectCommand) return { ETag: '"staged"' };
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };
      cloudFrontSend = async () => {
        assert.fail("Rejected upload-start requests must not start an invalidation");
      };

      const empty = await invokeStart(startEvent());
      assert.equal(empty.statusCode, 400);
      assert.equal(responseBody(empty).error, "invalid_request");

      const malformed = await invokeStart(startEvent("{"));
      assert.equal(malformed.statusCode, 400);
      assert.equal(responseBody(malformed).error, "invalid_request");

      const acceptedBoundaryBody = `{}`.padEnd(65_536, " ");
      const boundary = await invokeStart(startEvent(acceptedBoundaryBody));
      assert.equal(boundary.statusCode, 201);
      assert.equal(calls.length, 1);
      assert.ok(calls[0] instanceof PutObjectCommand);

      const oversize = await invokeStart(
        startEvent(`${acceptedBoundaryBody} `),
      );
      assert.equal(oversize.statusCode, 413);
      assert.equal(responseBody(oversize).error, "content_too_large");
      assert.equal(calls.length, 1);

      const fixture = storedRecord(OTHER_DECK_ID);
      const unknown = await invokeStart(
        startEvent(
          JSON.stringify({
            unexpectedTop: true,
            metadata: { ...metadata, slides: "/caller/path.pdf" },
            replaces: {
              recordKey: fixture.recordKey,
              version: RECORD_ETAG,
              storageKey: "caller-key",
            },
          }),
        ),
      );
      assert.equal(unknown.statusCode, 400);
      const unknownBody = responseBody(unknown);
      assert.equal(unknownBody.error, "unsupported_member");
      assert.ok(Array.isArray(unknownBody.issues));
      const members = (unknownBody.issues as readonly unknown[])
        .flatMap((issue) =>
          typeof issue === "object" && issue !== null && !Array.isArray(issue)
            ? [(issue as Readonly<Record<string, unknown>>).member]
            : [],
        )
        .filter((member): member is string => typeof member === "string")
        .sort();
      assert.deepEqual(members, ["slides", "storageKey", "unexpectedTop"]);
      assert.equal(calls.length, 1);
    },
  );

  await t.test(
    "issues a locally signed, fully constrained upload policy",
    async () => {
      const stagedCommands: PutObjectCommand[] = [];
      s3Send = async (command) => {
        if (command instanceof PutObjectCommand) {
          stagedCommands.push(command);
          return { ETag: '"staged"' };
        }
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };

      const response = await invokeStart(startEvent("{}"));
      assert.equal(response.statusCode, 201);
      const body = responseBody(response);
      const storageKey = body.storageKey;
      assert.equal(typeof storageKey, "string");
      assert.equal(stagedCommands.length, 1);
      const staged = stagedCommands[0];
      if (staged === undefined) {
        assert.fail("Expected one staged request command");
      }
      assert.equal(staged.input.IfNoneMatch, "*");
      assert.equal(
        staged.input.Key,
        `${String(storageKey).replace(/\.pdf$/u, "")}.upload.json`,
      );

      const conditions = policyConditions(response);
      assert.equal(exactCondition(conditions, "key", String(storageKey)), true);
      assert.equal(
        exactCondition(conditions, "Content-Type", "application/pdf"),
        true,
      );
      assert.equal(
        conditions.some(
          (condition) =>
            Array.isArray(condition) &&
            condition.length === 3 &&
            condition[0] === "content-length-range" &&
            condition[1] === 1 &&
            condition[2] === 26_214_400,
        ),
        true,
      );
    },
  );

  await t.test(
    "stages topical tags and source-code links without dropping metadata",
    async () => {
      const stagedCommands: PutObjectCommand[] = [];
      s3Send = async (command) => {
        if (command instanceof GetObjectCommand) throw s3Error(404);
        if (command instanceof PutObjectCommand) {
          stagedCommands.push(command);
          return { ETag: '"staged-metadata"' };
        }
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };

      const sourceCodeUrl = "https://github.com/salihgueler/salih-dev";
      const taggedMetadata = {
        ...metadata,
        eventTypes: ["Session"],
        tags: ["AI-DLC", "Kiro", "Spec-driven development"],
        sourceCodeUrl,
      };
      const response = await invokeStart(
        startEvent(JSON.stringify({ metadata: taggedMetadata })),
      );

      assert.equal(response.statusCode, 201);
      assert.equal(stagedCommands.length, 1);
      const staged = stagedCommands[0];
      if (staged === undefined) assert.fail("Expected one staged request");
      const body = JSON.parse(String(staged.input.Body)) as {
        metadata?: Readonly<Record<string, unknown>>;
      };
      assert.deepEqual(body.metadata?.eventTypes, ["Session"]);
      assert.deepEqual(body.metadata?.tags, [
        "AI-DLC",
        "Kiro",
        "Spec-driven development",
      ]);
      assert.equal(body.metadata?.sourceCodeUrl, sourceCodeUrl);
    },
  );

  await t.test(
    "rejects malformed completion bodies before AWS work",
    async () => {
      const calls: string[] = [];
      s3Send = async (command) => {
        calls.push(commandName(command));
        return {};
      };
      cloudFrontSend = async () => {
        calls.push("invalidate");
        return {};
      };

      for (const body of [
        "",
        "{",
        '{"unexpected":true}',
        "{}".padEnd(65_537, " "),
      ]) {
        const response = await invokeCompletion(completionEvent({ body }));
        assert.equal(response.statusCode, 400);
        assert.equal(responseBody(response).error, "invalid_request");
      }
      assert.deepEqual(calls, []);
    },
  );

  await t.test(
    "strictly rejects malformed, encrypted, and zero-page PDFs without mutation",
    async () => {
      const cases = [
        { bytes: fixtures().truncated, criterion: "4.4" },
        { bytes: fixtures().encryptedUnreadable, criterion: "4.6" },
        { bytes: fixtures().zeroPage, criterion: "4.5" },
      ] as const;

      for (const fixture of cases) {
        const calls: unknown[] = [];
        let buildCalls = 0;
        s3Send = async (command) => {
          calls.push(command);
          if (command instanceof GetObjectCommand) {
            return command.input.Key === stagedKey(DECK_ID)
              ? { Body: stringBody("{}") }
              : pendingObject(fixture.bytes);
          }
          if (command instanceof HeadObjectCommand)
            return pendingHead(fixture.bytes);
          throw new Error(
            `Mutation attempted for rejected PDF: ${commandName(command)}`,
          );
        };
        cloudFrontSend = async () => {
          buildCalls += 1;
          return { Invalidation: { Id: "unexpected" } };
        };

        const response = await invokeCompletion(completionEvent());
        assert.equal(response.statusCode, 422);
        assert.equal(responseBody(response).error, "deck_validation_failed");
        assert.equal(responseBody(response).criterion, fixture.criterion);
        assert.equal(
          calls.some(
            (command) =>
              command instanceof CopyObjectCommand ||
              command instanceof PutObjectCommand ||
              command instanceof DeleteObjectCommand,
          ),
          false,
        );
        assert.equal(buildCalls, 0);
      }
    },
  );

  await t.test(
    "stores a valid record only after validation and starts one invalidation",
    async () => {
      const bytes = fixtures().multiPage;
      const expectedRecordKey = deriveTalkRecordKey(
        deriveTalkIdentity(metadata.date, metadata.title),
      );
      const sequence: string[] = [];
      let storedBody = "";

      s3Send = async (command) => {
        sequence.push(commandName(command));
        if (command instanceof GetObjectCommand) {
          return command.input.Key === stagedKey(DECK_ID)
            ? { Body: stringBody(stagedBody()) }
            : pendingObject(bytes);
        }
        if (command instanceof HeadObjectCommand) {
          if (command.input.Key === pendingKey(DECK_ID))
            return pendingHead(bytes);
          throw s3Error(404);
        }
        if (command instanceof CopyObjectCommand) {
          assert.equal(command.input.CopySourceIfMatch, PENDING_ETAG);
          assert.deepEqual(command.input.Metadata, {
            "byte-length": String(bytes.byteLength),
            "page-count": "2",
          });
          return { VersionId: "approved-storage-version" };
        }
        if (command instanceof PutObjectCommand) {
          assert.equal(command.input.IfNoneMatch, "*");
          assert.equal(command.input.Key, recordObjectKey(expectedRecordKey));
          assert.equal(typeof command.input.Body, "string");
          storedBody = String(command.input.Body);
          return { ETag: '"new-record-version"' };
        }
        if (command instanceof DeleteObjectCommand) return {};
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };
      cloudFrontSend = async (command) => {
        assert.ok(command instanceof CreateInvalidationCommand);
        assert.equal(command.input.DistributionId, DISTRIBUTION_ID);
        sequence.push("invalidate");
        return { Invalidation: { Id: "invalidation-success" } };
      };

      const response = await invokeCompletion(completionEvent({ body: "{}" }));
      assert.equal(response.statusCode, 202);
      const body = responseBody(response);
      assert.equal(body.status, "published");
      assert.equal(body.recordKey, expectedRecordKey);
      assert.equal(body.recordVersion, '"new-record-version"');
      assert.equal(body.invalidationId, "invalidation-success");
      assert.equal(response.headers?.etag, '"new-record-version"');
      assert.notEqual(
        parseApiTalkRecord(JSON.parse(storedBody) as unknown),
        null,
      );
      assert.deepEqual(sequence, [
        `get:${stagedKey(DECK_ID)}`,
        `head:${pendingKey(DECK_ID)}`,
        `get:${pendingKey(DECK_ID)}`,
        `head:${recordObjectKey(expectedRecordKey)}`,
        `copy:${approvedKey(DECK_ID)}`,
        `put:${recordObjectKey(expectedRecordKey)}`,
        `delete:${pendingKey(DECK_ID)}`,
        `delete:${stagedKey(DECK_ID)}`,
        "invalidate",
      ]);
    },
  );

  await t.test(
    "persists supplied topical tags into the stored record",
    async () => {
      const bytes = fixtures().multiPage;
      const taggedMetadata = { ...metadata, tags: ["Serverless", "GraphQL"] };
      const expectedRecordKey = deriveTalkRecordKey(
        deriveTalkIdentity(metadata.date, metadata.title),
      );
      let storedBody = "";

      s3Send = async (command) => {
        if (command instanceof GetObjectCommand) {
          return command.input.Key === stagedKey(DECK_ID)
            ? { Body: stringBody(stagedBody({ metadata: taggedMetadata })) }
            : pendingObject(bytes);
        }
        if (command instanceof HeadObjectCommand) {
          if (command.input.Key === pendingKey(DECK_ID))
            return pendingHead(bytes);
          throw s3Error(404);
        }
        if (command instanceof CopyObjectCommand) {
          return { VersionId: "approved-storage-version" };
        }
        if (command instanceof PutObjectCommand) {
          storedBody = String(command.input.Body);
          return { ETag: '"tagged-record-version"' };
        }
        if (command instanceof DeleteObjectCommand) return {};
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };
      cloudFrontSend = async () => ({ Invalidation: { Id: "invalidation-tagged" } });

      const response = await invokeCompletion(completionEvent({ body: "{}" }));
      assert.equal(response.statusCode, 202);

      const parsed = parseApiTalkRecord(JSON.parse(storedBody) as unknown);
      assert.notEqual(parsed, null);
      assert.deepEqual(parsed?.frontmatter.tags, ["Serverless", "GraphQL"]);
      assert.equal(parsed?.recordKey, expectedRecordKey);
    },
  );

  await t.test(
    "replaces conditionally and removes the superseded deck last",
    async () => {
      const bytes = fixtures().singlePage;
      const previous = storedRecord(OTHER_DECK_ID);
      const sequence: string[] = [];

      s3Send = async (command) => {
        sequence.push(commandName(command));
        if (command instanceof GetObjectCommand) {
          if (command.input.Key === stagedKey(DECK_ID)) {
            return {
              Body: stringBody(
                stagedBody({
                  replaces: {
                    recordKey: previous.recordKey,
                    version: RECORD_ETAG,
                  },
                }),
              ),
            };
          }
          if (command.input.Key === pendingKey(DECK_ID))
            return pendingObject(bytes);
          assert.equal(command.input.Key, recordObjectKey(previous.recordKey));
          assert.equal(command.input.IfMatch, RECORD_ETAG);
          return {
            Body: stringBody(serializeApiTalkRecord(previous)),
            ETag: RECORD_ETAG,
          };
        }
        if (command instanceof HeadObjectCommand) return pendingHead(bytes);
        if (command instanceof CopyObjectCommand)
          return { VersionId: "approved-v2" };
        if (command instanceof PutObjectCommand) {
          assert.equal(command.input.IfMatch, RECORD_ETAG);
          assert.equal(command.input.IfNoneMatch, undefined);
          return { ETag: '"replacement-version"' };
        }
        if (command instanceof DeleteObjectCommand) return {};
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };
      cloudFrontSend = async () => {
        sequence.push("invalidate");
        return { Invalidation: { Id: "replacement-invalidation" } };
      };

      const response = await invokeCompletion(completionEvent());
      assert.equal(response.statusCode, 202);
      assert.equal(responseBody(response).recordKey, previous.recordKey);
      assert.deepEqual(sequence, [
        `get:${stagedKey(DECK_ID)}`,
        `head:${pendingKey(DECK_ID)}`,
        `get:${pendingKey(DECK_ID)}`,
        `get:${recordObjectKey(previous.recordKey)}`,
        `copy:${approvedKey(DECK_ID)}`,
        `put:${recordObjectKey(previous.recordKey)}`,
        `delete:${pendingKey(DECK_ID)}`,
        `delete:${stagedKey(DECK_ID)}`,
        `delete:${approvedKey(OTHER_DECK_ID)}`,
        "invalidate",
      ]);
    },
  );

  await t.test(
    "returns exact precondition statuses without mutation or invalidation",
    async () => {
      const existing = storedRecord(OTHER_DECK_ID);
      const mutations: string[] = [];
      let buildCalls = 0;
      s3Send = async (command) => {
        if (command instanceof GetObjectCommand) {
          if (command.input.IfMatch === STALE_ETAG) throw s3Error(412);
          return {
            Body: stringBody(serializeApiTalkRecord(existing)),
            ETag: RECORD_ETAG,
          };
        }
        if (
          command instanceof PutObjectCommand ||
          command instanceof DeleteObjectCommand
        ) {
          mutations.push(commandName(command));
          return {};
        }
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };
      cloudFrontSend = async () => {
        buildCalls += 1;
        return { Invalidation: { Id: "unexpected" } };
      };

      const missingReplacement = await invokeStart(
        startEvent(
          JSON.stringify({ replaces: { recordKey: existing.recordKey } }),
        ),
      );
      assert.equal(missingReplacement.statusCode, 428);
      assert.equal(
        responseBody(missingReplacement).error,
        "precondition_required",
      );

      const staleReplacement = await invokeStart(
        startEvent(
          JSON.stringify({
            replaces: { recordKey: existing.recordKey, version: STALE_ETAG },
          }),
        ),
      );
      assert.equal(staleReplacement.statusCode, 412);
      assert.equal(responseBody(staleReplacement).error, "record_changed");

      const missingRemoval = await invokeRecords(
        recordsEvent({ method: "DELETE", recordKey: existing.recordKey }),
      );
      assert.equal(missingRemoval.statusCode, 428);
      assert.equal(responseBody(missingRemoval).error, "precondition_required");

      const malformedRemoval = await invokeRecords(
        recordsEvent({
          method: "DELETE",
          recordKey: existing.recordKey,
          headers: removalHeaders("not-quoted"),
        }),
      );
      assert.equal(malformedRemoval.statusCode, 400);
      assert.equal(
        responseBody(malformedRemoval).error,
        "invalid_precondition",
      );

      const staleRemoval = await invokeRecords(
        recordsEvent({
          method: "DELETE",
          recordKey: existing.recordKey,
          headers: removalHeaders(STALE_ETAG),
        }),
      );
      assert.equal(staleRemoval.statusCode, 412);
      assert.equal(responseBody(staleRemoval).error, "record_changed");
      assert.deepEqual(mutations, []);
      assert.equal(buildCalls, 0);
    },
  );

  await t.test(
    "lists strict records in record-key order without deck bytes",
    async () => {
      const later = storedRecord(DECK_ID, {
        title: "Zulu integration talk",
        date: "2026-06-19",
      });
      const earlier = storedRecord(OTHER_DECK_ID, {
        title: "Alpha integration talk",
        date: "2026-06-17",
      });
      const byKey = new Map([
        [recordObjectKey(later.recordKey), later],
        [recordObjectKey(earlier.recordKey), earlier],
      ]);

      s3Send = async (command) => {
        if (command instanceof ListObjectsV2Command) {
          return {
            Contents: [
              { Key: recordObjectKey(later.recordKey) },
              { Key: recordObjectKey(earlier.recordKey) },
            ],
            IsTruncated: false,
          };
        }
        if (command instanceof GetObjectCommand) {
          const record = byKey.get(String(command.input.Key));
          if (record === undefined) throw s3Error(404);
          return {
            Body: stringBody(serializeApiTalkRecord(record)),
            ETag: RECORD_ETAG,
            VersionId: `storage-${record.recordKey}`,
          };
        }
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };

      const response = await invokeRecords(recordsEvent({ method: "GET" }));
      assert.equal(response.statusCode, 200);
      const records = responseBody(response).records;
      assert.ok(Array.isArray(records));
      const keys = records.map((entry) => {
        assert.ok(
          typeof entry === "object" && entry !== null && !Array.isArray(entry),
        );
        const record = (entry as Readonly<Record<string, unknown>>).record;
        assert.ok(
          typeof record === "object" &&
            record !== null &&
            !Array.isArray(record),
        );
        assert.equal("bytes" in record, false);
        return (record as Readonly<Record<string, unknown>>).recordKey;
      });
      assert.deepEqual(keys, [earlier.recordKey, later.recordKey].sort());
    },
  );

  await t.test(
    "conditionally removes a record and tolerates an already-absent deck",
    async () => {
      const record = storedRecord(OTHER_DECK_ID);
      const sequence: string[] = [];
      s3Send = async (command) => {
        sequence.push(commandName(command));
        if (command instanceof GetObjectCommand) {
          assert.equal(command.input.IfMatch, RECORD_ETAG);
          return {
            Body: stringBody(serializeApiTalkRecord(record)),
            ETag: RECORD_ETAG,
          };
        }
        if (command instanceof DeleteObjectCommand) {
          if (command.input.Key === recordObjectKey(record.recordKey)) {
            assert.equal(command.input.IfMatch, RECORD_ETAG);
            return {};
          }
          throw s3Error(404);
        }
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };
      cloudFrontSend = async (command) => {
        assert.ok(command instanceof CreateInvalidationCommand);
        sequence.push("invalidate");
        return { Invalidation: { Id: "removal-invalidation" } };
      };

      const response = await invokeRecords(
        recordsEvent({
          method: "DELETE",
          recordKey: record.recordKey,
          headers: removalHeaders(),
        }),
      );
      assert.equal(response.statusCode, 202);
      assert.equal(responseBody(response).invalidationId, "removal-invalidation");
      assert.deepEqual(sequence, [
        `get:${recordObjectKey(record.recordKey)}`,
        `delete:${recordObjectKey(record.recordKey)}`,
        `delete:${approvedKey(record.deckId)}`,
        "invalidate",
      ]);
    },
  );

  await t.test(
    "retries completion safely after a record-store failure",
    async () => {
      const bytes = fixtures().singlePage;
      let recordWriteAttempts = 0;
      let buildCalls = 0;
      let approvedCopies = 0;
      let cleanupCalls = 0;

      s3Send = async (command) => {
        if (command instanceof GetObjectCommand) {
          return command.input.Key === stagedKey(DECK_ID)
            ? { Body: stringBody(stagedBody()) }
            : pendingObject(bytes);
        }
        if (command instanceof HeadObjectCommand) {
          if (command.input.Key === pendingKey(DECK_ID))
            return pendingHead(bytes);
          throw s3Error(404);
        }
        if (command instanceof CopyObjectCommand) {
          approvedCopies += 1;
          return { VersionId: `approved-${approvedCopies}` };
        }
        if (command instanceof PutObjectCommand) {
          recordWriteAttempts += 1;
          if (recordWriteAttempts === 1)
            throw new Error("stubbed record-store failure");
          return { ETag: '"retry-record-version"' };
        }
        if (command instanceof DeleteObjectCommand) {
          cleanupCalls += 1;
          return {};
        }
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };
      cloudFrontSend = async () => {
        buildCalls += 1;
        return { Invalidation: { Id: "retry-invalidation" } };
      };

      const first = await invokeCompletion(completionEvent());
      assert.equal(first.statusCode, 500);
      assert.equal(responseBody(first).error, "talk_upload_failed");
      assert.equal(cleanupCalls, 0);
      assert.equal(buildCalls, 0);

      const retry = await invokeCompletion(completionEvent());
      assert.equal(retry.statusCode, 202);
      assert.equal(responseBody(retry).invalidationId, "retry-invalidation");
      assert.equal(recordWriteAttempts, 2);
      assert.equal(approvedCopies, 2);
      assert.equal(cleanupCalls, 2);
      assert.equal(buildCalls, 1);
    },
  );

  await t.test(
    "retains a stored record when invalidation fails and prevents duplicate retry mutation",
    async () => {
      const bytes = fixtures().singlePage;
      const recordKey = deriveTalkRecordKey(
        deriveTalkIdentity(metadata.date, metadata.title),
      );
      let stagedAvailable = true;
      let recordBody = "";
      let copyCalls = 0;
      let recordWrites = 0;
      let buildCalls = 0;

      s3Send = async (command) => {
        if (command instanceof GetObjectCommand) {
          if (command.input.Key === stagedKey(DECK_ID)) {
            if (!stagedAvailable) throw s3Error(404);
            return { Body: stringBody(stagedBody()) };
          }
          return pendingObject(bytes);
        }
        if (command instanceof HeadObjectCommand) {
          if (command.input.Key === pendingKey(DECK_ID))
            return pendingHead(bytes);
          throw s3Error(404);
        }
        if (command instanceof CopyObjectCommand) {
          copyCalls += 1;
          return { VersionId: "approved-version" };
        }
        if (command instanceof PutObjectCommand) {
          recordWrites += 1;
          recordBody = String(command.input.Body);
          return { ETag: '"retained-record-version"' };
        }
        if (command instanceof DeleteObjectCommand) {
          if (command.input.Key === stagedKey(DECK_ID)) stagedAvailable = false;
          return {};
        }
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };
      cloudFrontSend = async () => {
        buildCalls += 1;
        throw new Error("stubbed invalidation failure");
      };

      const failedPublication = await invokeCompletion(completionEvent());
      assert.equal(failedPublication.statusCode, 503);
      const failedBody = responseBody(failedPublication);
      assert.equal(failedBody.error, "invalidation_not_started");
      assert.equal(failedBody.recordKey, recordKey);
      assert.notEqual(
        parseApiTalkRecord(JSON.parse(recordBody) as unknown),
        null,
      );

      const duplicateRetry = await invokeCompletion(completionEvent());
      assert.equal(duplicateRetry.statusCode, 404);
      assert.equal(
        responseBody(duplicateRetry).error,
        "pending_deck_not_found",
      );
      assert.equal(copyCalls, 1);
      assert.equal(recordWrites, 1);
      assert.equal(buildCalls, 1);
    },
  );

  await t.test(
    "returns invalidation failure when removal cannot obtain an invalidation identifier",
    async () => {
      const record = storedRecord(OTHER_DECK_ID);
      s3Send = async (command) => {
        if (command instanceof GetObjectCommand) {
          return {
            Body: stringBody(serializeApiTalkRecord(record)),
            ETag: RECORD_ETAG,
          };
        }
        if (command instanceof DeleteObjectCommand) return {};
        throw new Error(`Unexpected S3 command: ${commandName(command)}`);
      };
      cloudFrontSend = async () => ({});

      const response = await invokeRecords(
        recordsEvent({
          method: "DELETE",
          recordKey: record.recordKey,
          headers: removalHeaders(),
        }),
      );
      assert.equal(response.statusCode, 503);
      assert.equal(responseBody(response).error, "invalidation_not_started");
    },
  );
});
