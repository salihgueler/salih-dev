import assert from "node:assert/strict";
import test from "node:test";

import type { APIGatewayProxyEventV2WithIAMAuthorizer } from "aws-lambda";
import * as fc from "fast-check";

import {
  isExpectedEditor,
  logDeckValidation,
  logTalkStoreChange,
  TALK_LOG_ACTIONS,
  type TalkStoreLogDetails,
} from "../functions/content-api-shared";

type GeneratedLogCase = Readonly<{
  seed: string;
  requestId: string;
  deckId: string;
  storedVersion: string;
  buildId: string;
  byteLength: number;
  pageCount: number;
}>;

type SensitiveValues = Readonly<{
  pdfBytes: string;
  renderedPage: string;
  clientIp: string;
  forwardedIp: string;
  cookie: string;
  query: string;
  userAgent: string;
  referrer: string;
  browserId: string;
  deviceId: string;
}>;

type JsonObject = Readonly<Record<string, unknown>>;

const AUTHORIZATION_FIELDS = [
  "action",
  "allowed",
  "callerArn",
  "requestId",
] as const;
const VALIDATION_FIELDS = [
  "action",
  "byteLength",
  "pageCount",
  "requestId",
  "storageKey",
  "validationOutcome",
] as const;
const STORE_FIELDS = [
  "action",
  "buildId",
  "requestId",
  "storedVersion",
] as const;

const FORBIDDEN_FIELD_NAMES = new Set([
  "browserid",
  "browseridentifier",
  "clientip",
  "cookie",
  "cookies",
  "deviceid",
  "deviceidentifier",
  "forwardedip",
  "pagecontent",
  "pdfbytes",
  "pdfcontent",
  "query",
  "querystring",
  "rawquerystring",
  "referer",
  "referrer",
  "renderedcontent",
  "renderedpage",
  "sourceip",
  "useragent",
  "xforwardedfor",
]);

const generatedLogCaseArbitrary: fc.Arbitrary<GeneratedLogCase> = fc.record({
  seed: fc.uuid(),
  requestId: fc.uuid(),
  deckId: fc.uuid(),
  storedVersion: fc.uuid().map((value) => `"${value}"`),
  buildId: fc.uuid().map((value) => `talk-publisher:${value}`),
  byteLength: fc.integer({ min: 1, max: 26_214_400 }),
  pageCount: fc.integer({ min: 1, max: 10_000 }),
});

function sensitiveValues(seed: string): SensitiveValues {
  return Object.freeze({
    pdfBytes: `%PDF-sensitive-bytes-${seed}`,
    renderedPage: `<canvas>rendered-page-${seed}</canvas>`,
    clientIp: `192.0.2.${Number.parseInt(seed.slice(0, 2), 16) % 255}`,
    forwardedIp: `forwarded-ip-${seed}`,
    cookie: `private-cookie-${seed}`,
    query: `private-query-${seed}`,
    userAgent: `private-user-agent-${seed}`,
    referrer: `https://private.example/referrer/${seed}`,
    browserId: `private-browser-${seed}`,
    deviceId: `private-device-${seed}`,
  });
}

function apiEvent(
  generated: GeneratedLogCase,
  callerArn: string,
): APIGatewayProxyEventV2WithIAMAuthorizer {
  const sensitive = sensitiveValues(generated.seed);

  return {
    version: "2.0",
    routeKey: "POST /v1/talks/uploads/{deckId}/completion",
    rawPath: `/v1/talks/uploads/${generated.deckId}/completion`,
    rawQueryString: `private=${encodeURIComponent(sensitive.query)}`,
    cookies: [sensitive.cookie],
    headers: {
      cookie: sensitive.cookie,
      referer: sensitive.referrer,
      "user-agent": sensitive.userAgent,
      "x-browser-id": sensitive.browserId,
      "x-device-id": sensitive.deviceId,
      "x-forwarded-for": sensitive.forwardedIp,
    },
    queryStringParameters: {
      private: sensitive.query,
    },
    requestContext: {
      accountId: "111111111111",
      apiId: "private-api",
      authorizer: {
        iam: {
          accessKey: sensitive.deviceId,
          accountId: "111111111111",
          callerId: sensitive.browserId,
          cognitoIdentity: null,
          principalOrgId: sensitive.forwardedIp,
          userArn: callerArn,
          userId: sensitive.cookie,
        },
      },
      domainName: "content.example.test",
      domainPrefix: "content",
      http: {
        method: "POST",
        path: `/v1/talks/uploads/${generated.deckId}/completion`,
        protocol: "HTTP/1.1",
        sourceIp: sensitive.clientIp,
        userAgent: sensitive.userAgent,
      },
      requestId: generated.requestId,
      routeKey: "POST /v1/talks/uploads/{deckId}/completion",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1_767_225_600_000,
    },
    body: JSON.stringify({
      pdfBytes: sensitive.pdfBytes,
      renderedPage: sensitive.renderedPage,
      visitor: {
        browserId: sensitive.browserId,
        deviceId: sensitive.deviceId,
        forwardedIp: sensitive.forwardedIp,
        referrer: sensitive.referrer,
      },
    }),
    pathParameters: {
      browserId: sensitive.browserId,
      deckId: generated.deckId,
      deviceId: sensitive.deviceId,
    },
    isBase64Encoded: false,
    stageVariables: {
      referrer: sensitive.referrer,
    },
  };
}

function captureLogs(run: () => void): readonly string[] {
  const captured: string[] = [];
  const originalLog = console.log;

  console.log = (...values: readonly unknown[]): void => {
    assert.equal(values.length, 1, "structured logger must emit one value");
    const [value] = values;
    assert.equal(typeof value, "string", "structured log must be JSON text");
    if (typeof value === "string") captured.push(value);
  };

  try {
    run();
  } finally {
    console.log = originalLog;
  }

  return captured;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedFieldName(field: string): string {
  return field.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
}

function assertNoForbiddenFields(value: unknown, path = "log"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoForbiddenFields(item, `${path}[${index}]`),
    );
    return;
  }
  if (!isJsonObject(value)) return;

  for (const [field, nestedValue] of Object.entries(value)) {
    assert.ok(
      !FORBIDDEN_FIELD_NAMES.has(normalizedFieldName(field)),
      `forbidden field ${JSON.stringify(field)} found at ${path}`,
    );
    assertNoForbiddenFields(nestedValue, `${path}.${field}`);
  }
}

function permittedFields(action: unknown): readonly string[] {
  if (action === TALK_LOG_ACTIONS.authorization) return AUTHORIZATION_FIELDS;
  if (action === TALK_LOG_ACTIONS.validation) return VALIDATION_FIELDS;
  if (
    action === TALK_LOG_ACTIONS.store ||
    action === TALK_LOG_ACTIONS.removal
  ) {
    return STORE_FIELDS;
  }
  assert.fail(`unexpected upload log action ${JSON.stringify(action)}`);
}

function parseAndValidateLog(
  line: string,
  sensitive: SensitiveValues,
): JsonObject {
  const parsed: unknown = JSON.parse(line) as unknown;
  assert.ok(isJsonObject(parsed), "structured log must be a JSON object");
  assert.deepEqual(
    Object.keys(parsed).sort(),
    [...permittedFields(parsed.action)].sort(),
    `action ${String(parsed.action)} must emit exactly its permitted fields`,
  );
  assertNoForbiddenFields(parsed);

  for (const secret of Object.values(sensitive)) {
    assert.ok(
      !line.includes(secret),
      `structured log leaked sensitive event content ${JSON.stringify(secret)}`,
    );
  }

  return parsed;
}

// Feature: talk-upload-endpoint, Property 14: Upload log records carry only permitted fields
// **Validates: Requirements 10.2, 10.3, 10.4, 10.5**
test("Property 14: upload log records carry only permitted fields", () => {
  fc.assert(
    fc.property(generatedLogCaseArbitrary, (generated) => {
      const allowedCallerArn = "arn:aws:iam::111111111111:root";
      const deniedCallerArn = "arn:aws:iam::222222222222:root";
      const allowedEvent = apiEvent(generated, allowedCallerArn);
      const deniedEvent = apiEvent(generated, deniedCallerArn);
      const storageKey = `talks/pending/${generated.deckId}.pdf`;
      const storeOutcomes: readonly TalkStoreLogDetails[] = [
        {
          action: TALK_LOG_ACTIONS.store,
          storedVersion: generated.storedVersion,
          buildId: generated.buildId,
        },
        {
          action: TALK_LOG_ACTIONS.store,
          storedVersion: generated.storedVersion,
          buildId: null,
        },
        {
          action: TALK_LOG_ACTIONS.store,
          storedVersion: null,
          buildId: generated.buildId,
        },
        {
          action: TALK_LOG_ACTIONS.store,
          storedVersion: null,
          buildId: null,
        },
        {
          action: TALK_LOG_ACTIONS.removal,
          storedVersion: generated.storedVersion,
          buildId: generated.buildId,
        },
        {
          action: TALK_LOG_ACTIONS.removal,
          storedVersion: generated.storedVersion,
          buildId: null,
        },
        {
          action: TALK_LOG_ACTIONS.removal,
          storedVersion: null,
          buildId: generated.buildId,
        },
        {
          action: TALK_LOG_ACTIONS.removal,
          storedVersion: null,
          buildId: null,
        },
      ];
      const previousAllowedCallerArns = process.env.CONTENT_ALLOWED_CALLER_ARNS;

      const lines = captureLogs(() => {
        process.env.CONTENT_ALLOWED_CALLER_ARNS = allowedCallerArn;
        try {
          assert.equal(isExpectedEditor(allowedEvent), true);
          assert.equal(isExpectedEditor(deniedEvent), false);

          logDeckValidation(allowedEvent, {
            outcome: "accepted",
            storageKey,
            byteLength: generated.byteLength,
            pageCount: generated.pageCount,
          });
          logDeckValidation(allowedEvent, {
            outcome: "rejected",
            storageKey,
            byteLength: generated.byteLength,
            pageCount: null,
          });
          logDeckValidation(allowedEvent, {
            outcome: "error",
            storageKey,
            byteLength: null,
            pageCount: null,
          });

          for (const outcome of storeOutcomes) {
            logTalkStoreChange(allowedEvent, outcome);
          }
        } finally {
          if (previousAllowedCallerArns === undefined) {
            delete process.env.CONTENT_ALLOWED_CALLER_ARNS;
          } else {
            process.env.CONTENT_ALLOWED_CALLER_ARNS = previousAllowedCallerArns;
          }
        }
      });

      assert.equal(lines.length, 13);
      const parsed = lines.map((line) =>
        parseAndValidateLog(line, sensitiveValues(generated.seed)),
      );

      assert.deepEqual(parsed, [
        {
          action: TALK_LOG_ACTIONS.authorization,
          allowed: true,
          callerArn: allowedCallerArn,
          requestId: generated.requestId,
        },
        {
          action: TALK_LOG_ACTIONS.authorization,
          allowed: false,
          callerArn: deniedCallerArn,
          requestId: generated.requestId,
        },
        {
          action: TALK_LOG_ACTIONS.validation,
          validationOutcome: "accepted",
          storageKey,
          byteLength: generated.byteLength,
          pageCount: generated.pageCount,
          requestId: generated.requestId,
        },
        {
          action: TALK_LOG_ACTIONS.validation,
          validationOutcome: "rejected",
          storageKey,
          byteLength: generated.byteLength,
          pageCount: null,
          requestId: generated.requestId,
        },
        {
          action: TALK_LOG_ACTIONS.validation,
          validationOutcome: "error",
          storageKey,
          byteLength: null,
          pageCount: null,
          requestId: generated.requestId,
        },
        ...storeOutcomes.map((outcome) => ({
          action: outcome.action,
          storedVersion: outcome.storedVersion,
          buildId: outcome.buildId,
          requestId: generated.requestId,
        })),
      ]);
    }),
    { numRuns: 150 },
  );
});
