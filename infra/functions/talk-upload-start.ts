import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
  Handler,
} from "aws-lambda";

import {
  isExpectedEditor,
  isRequestBodyTooLarge,
  jsonResponse,
  MAX_JSON_BODY_BYTES,
  parseStrongEntityTag,
  requestBody,
} from "./content-api-shared";
import type { ApiTalkRecord } from "../../src/lib/talks/api-record.js" with {
  "resolution-mode": "import",
};
import type { TalkRecordKey } from "../../src/lib/talks/identity.js" with {
  "resolution-mode": "import",
};
import type { TalkFrontmatter } from "../../src/lib/talks/model.js" with {
  "resolution-mode": "import",
};
import type {
  TalkUploadRequest,
  UploadIssue,
} from "../../src/lib/talks/upload-request.js" with {
  "resolution-mode": "import",
};

const s3 = new S3Client({});

const API_TALK_RECORD_PREFIX = "talks/records/";
const UPLOAD_GRANT_EXPIRES_SECONDS = 899;

type StoredRecord = Readonly<{
  etag: string;
  record: ApiTalkRecord;
}>;

type RequestResolution =
  | Readonly<{
      ok: true;
      recordKey: TalkRecordKey | null;
      request: TalkUploadRequest;
    }>
  | Readonly<{
      ok: false;
      response: APIGatewayProxyStructuredResultV2;
    }>;

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordObjectKey(recordKey: TalkRecordKey): string {
  return `${API_TALK_RECORD_PREFIX}${recordKey}.json`;
}

function replacementVersionIsMissing(
  rawRequest: unknown,
  issues: readonly UploadIssue[],
): boolean {
  if (!isRecord(rawRequest) || !isRecord(rawRequest.replaces)) return false;

  const recordKeyIsInvalid = issues.some(
    (issue) =>
      issue.code === "invalid_precondition" &&
      issue.path === "replaces.recordKey",
  );
  const { recordKey, version } = rawRequest.replaces;
  return (
    typeof recordKey === "string" &&
    !recordKeyIsInvalid &&
    (version === undefined || version === null || version === "")
  );
}

function requestErrorResponse(
  issues: readonly UploadIssue[],
  rawRequest: unknown,
): APIGatewayProxyStructuredResultV2 {
  if (replacementVersionIsMissing(rawRequest, issues)) {
    return jsonResponse(428, {
      error: "precondition_required",
      issues,
    });
  }

  const error = issues.some((issue) => issue.code === "unsupported_member")
    ? "unsupported_member"
    : issues.some((issue) => issue.code === "invalid_precondition")
      ? "invalid_precondition"
      : issues.some(
            (issue) => issue.code === "talk_identity_change_unsupported",
          )
        ? "talk_identity_change_unsupported"
        : issues.some((issue) => issue.code === "invalid_metadata")
          ? "invalid_metadata"
          : "invalid_request";

  return jsonResponse(
    error === "talk_identity_change_unsupported" ? 409 : 400,
    { error, issues },
  );
}

function preservedReplacementMetadata(
  frontmatter: TalkFrontmatter,
  slidePath: string,
): TalkFrontmatter {
  const common = {
    title: frontmatter.title,
    eventName: frontmatter.eventName,
    date: frontmatter.date,
    location: frontmatter.location,
    eventUrl: frontmatter.eventUrl,
    eventTypes: Object.freeze([...frontmatter.eventTypes]),
    slides: slidePath,
    draft: frontmatter.draft,
  };

  return Object.freeze(
    frontmatter.videoUrl === undefined
      ? common
      : { ...common, videoUrl: frontmatter.videoUrl },
  );
}

type StagedUploadRequest = Readonly<{
  metadata?: Omit<TalkFrontmatter, "slides">;
  replaces?: NonNullable<TalkUploadRequest["replaces"]>;
}>;

function stagedUploadRequest(request: TalkUploadRequest): StagedUploadRequest {
  const metadata =
    request.metadata === null
      ? null
      : Object.freeze({
          title: request.metadata.title,
          eventName: request.metadata.eventName,
          date: request.metadata.date,
          location: request.metadata.location,
          eventUrl: request.metadata.eventUrl,
          eventTypes: Object.freeze([...request.metadata.eventTypes]),
          ...(request.metadata.videoUrl === undefined
            ? {}
            : { videoUrl: request.metadata.videoUrl }),
          draft: request.metadata.draft,
        });

  return Object.freeze({
    ...(metadata === null ? {} : { metadata }),
    ...(request.replaces === null ? {} : { replaces: request.replaces }),
  });
}

function isObjectAbsent(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    (error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404)
  );
}

async function readStoredRecord(
  bucket: string,
  recordKey: TalkRecordKey,
): Promise<StoredRecord | null> {
  let result;
  try {
    result = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: recordObjectKey(recordKey),
      }),
    );
  } catch (error) {
    if (isObjectAbsent(error)) return null;
    throw error;
  }

  if (result.Body === undefined || result.ETag === undefined) {
    throw new Error("Stored talk record is missing its body or entity tag");
  }

  let value: unknown;
  try {
    value = JSON.parse(await result.Body.transformToString("utf8"));
  } catch {
    throw new Error("Stored talk record is not valid JSON");
  }

  const { parseApiTalkRecord } =
    await import("../../src/lib/talks/api-record.js");
  const record = parseApiTalkRecord(value);
  if (record === null || record.recordKey !== recordKey) {
    throw new Error("Stored talk record is invalid or inconsistent");
  }

  return Object.freeze({ etag: result.ETag, record });
}

async function resolveRequest(
  bucket: string,
  request: TalkUploadRequest,
  slidePath: string,
): Promise<RequestResolution> {
  if (request.replaces !== null) {
    const parsedVersion = parseStrongEntityTag(request.replaces.version);
    if (!parsedVersion.ok) {
      return Object.freeze({
        ok: false,
        response: jsonResponse(400, {
          error: "invalid_precondition",
          issues: [
            {
              code: "invalid_precondition",
              path: "replaces.version",
              message:
                "replaces.version must be one non-empty quoted entity tag",
            },
          ],
        }),
      });
    }

    const stored = await readStoredRecord(bucket, request.replaces.recordKey);
    if (stored === null) {
      return Object.freeze({
        ok: false,
        response: jsonResponse(404, { error: "record_not_found" }),
      });
    }
    if (stored.etag !== parsedVersion.value) {
      return Object.freeze({
        ok: false,
        response: jsonResponse(412, { error: "record_changed" }),
      });
    }

    return Object.freeze({
      ok: true,
      recordKey: request.replaces.recordKey,
      request: Object.freeze({
        metadata:
          request.metadata ??
          preservedReplacementMetadata(stored.record.frontmatter, slidePath),
        replaces: Object.freeze({
          recordKey: request.replaces.recordKey,
          version: parsedVersion.value,
        }),
      }),
    });
  }

  if (request.metadata === null) {
    return Object.freeze({ ok: true, recordKey: null, request });
  }

  const { deriveTalkIdentity, deriveTalkRecordKey } =
    await import("../../src/lib/talks/identity.js");
  const identity = deriveTalkIdentity(
    request.metadata.date,
    request.metadata.title,
  );
  const recordKey = deriveTalkRecordKey(identity);
  const existing = await readStoredRecord(bucket, recordKey);
  if (existing !== null) {
    return Object.freeze({
      ok: false,
      response: jsonResponse(409, {
        error: "talk_identity_conflict",
        talkIdentity: identity,
      }),
    });
  }

  return Object.freeze({ ok: true, recordKey, request });
}

export const handler: Handler<
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2
> = async (event) => {
  if (!isExpectedEditor(event)) {
    return jsonResponse(403, { error: "forbidden" });
  }

  const body = requestBody(event);
  if (body === null) {
    return jsonResponse(400, { error: "invalid_request" });
  }
  if (isRequestBodyTooLarge(body, MAX_JSON_BODY_BYTES)) {
    return jsonResponse(413, { error: "content_too_large" });
  }

  let rawRequest: unknown;
  try {
    rawRequest = JSON.parse(body);
  } catch {
    return jsonResponse(400, { error: "invalid_request" });
  }

  const [deckModule, uploadRequestModule] = await Promise.all([
    import("../../src/lib/talks/deck.js"),
    import("../../src/lib/talks/upload-request.js"),
  ]);
  const deckId = deckModule.createDeckId();
  const slidePath = deckModule.deckSlidePath(deckId);
  const parsed = uploadRequestModule.parseTalkUploadRequest(
    rawRequest,
    slidePath,
  );
  if (!parsed.ok) {
    return requestErrorResponse(parsed.issues, rawRequest);
  }

  const bucket = process.env.CONTENT_BUCKET_NAME;
  if (bucket === undefined || bucket.length === 0) {
    return jsonResponse(500, { error: "talk_upload_failed" });
  }

  let resolved: RequestResolution;
  try {
    resolved = await resolveRequest(bucket, parsed.request, slidePath);
  } catch {
    return jsonResponse(500, { error: "talk_upload_failed" });
  }
  if (!resolved.ok) return resolved.response;

  const issuedAtMilliseconds = Date.now();
  const expiresAt = new Date(
    issuedAtMilliseconds + UPLOAD_GRANT_EXPIRES_SECONDS * 1_000,
  ).toISOString();
  const locations = Object.freeze({
    storageKey: deckModule.pendingDeckKey(deckId),
    approvedStorageKey: deckModule.approvedDeckKey(deckId),
    slidePath,
  });

  let upload;
  try {
    upload = await createPresignedPost(s3, {
      Bucket: bucket,
      Key: locations.storageKey,
      Conditions: [
        { key: locations.storageKey },
        { "Content-Type": deckModule.DECK_MEDIA_TYPE },
        [
          "content-length-range",
          deckModule.DECK_MIN_BYTES,
          deckModule.DECK_MAX_BYTES,
        ],
      ],
      Fields: {
        key: locations.storageKey,
        "Content-Type": deckModule.DECK_MEDIA_TYPE,
      },
      Expires: UPLOAD_GRANT_EXPIRES_SECONDS,
    });

    await s3.send(
      new PutObjectCommand({
        Body: `${JSON.stringify(stagedUploadRequest(resolved.request), null, 2)}\n`,
        Bucket: bucket,
        CacheControl: "no-store",
        ContentType: "application/json; charset=utf-8",
        IfNoneMatch: "*",
        Key: deckModule.pendingRequestKey(deckId),
      }),
    );
  } catch {
    return jsonResponse(500, { error: "talk_upload_failed" });
  }

  return jsonResponse(201, {
    deckId,
    ...locations,
    ...(resolved.recordKey === null ? {} : { recordKey: resolved.recordKey }),
    expiresAt,
    upload,
  });
};
