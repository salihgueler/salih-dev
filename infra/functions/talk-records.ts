import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  paginateListObjectsV2,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
  Handler,
} from "aws-lambda";

import {
  invalidateDynamicPaths,
  isExpectedEditor,
  jsonResponse,
  logTalkStoreChange,
  maybeStartPublisherBuild,
  parseIfMatchPrecondition,
  parseStrongEntityTag,
  requestHeader,
  TALK_LOG_ACTIONS,
  TALKS_DYNAMIC_PATHS,
  type StrongEntityTag,
} from "./content-api-shared";

const TALK_RECORD_PREFIX = "talks/records/";
const TALK_RECORD_SUFFIX = ".json";
const REMOVAL_CONFIRMATION = "confirmed";

const s3 = new S3Client({});

async function loadApiRecordModule() {
  return import("../../src/lib/talks/api-record.js");
}

async function loadDeckModule() {
  return import("../../src/lib/talks/deck.js");
}

async function loadIdentityModule() {
  return import("../../src/lib/talks/identity.js");
}

type ApiRecordModule = Awaited<ReturnType<typeof loadApiRecordModule>>;
type ApiTalkRecord = NonNullable<
  ReturnType<ApiRecordModule["parseApiTalkRecord"]>
>;
type RecordKeyValidator = (value: string) => boolean;

type ListedTalkRecord = Readonly<{
  record: ApiTalkRecord;
  recordVersion: StrongEntityTag;
  etag: StrongEntityTag;
  storageVersion?: string;
}>;

type StoredTalkRecord = Readonly<{
  record: ApiTalkRecord;
  etag: StrongEntityTag;
  storageVersion?: string;
}>;

class InvalidStoredRecordError extends Error {
  constructor() {
    super("Stored API talk record is invalid");
    this.name = "InvalidStoredRecordError";
  }
}

function recordObjectKey(recordKey: string): string {
  return `${TALK_RECORD_PREFIX}${recordKey}${TALK_RECORD_SUFFIX}`;
}

function recordKeyFromObjectKey(
  key: string,
  isTalkRecordKey: RecordKeyValidator,
): string | null {
  if (
    !key.startsWith(TALK_RECORD_PREFIX) ||
    !key.endsWith(TALK_RECORD_SUFFIX)
  ) {
    return null;
  }

  const candidate = key.slice(
    TALK_RECORD_PREFIX.length,
    -TALK_RECORD_SUFFIX.length,
  );
  return isTalkRecordKey(candidate) ? candidate : null;
}

function isS3Status(error: unknown, statusCode: number): boolean {
  return (
    error instanceof S3ServiceException &&
    error.$metadata.httpStatusCode === statusCode
  );
}

function isMissingObject(error: unknown): boolean {
  return error instanceof NoSuchKey || isS3Status(error, 404);
}

function isFailedPrecondition(error: unknown): boolean {
  return isS3Status(error, 412);
}

function requiredEnvironment(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? null : value;
}

function isRepositoryAuthoredRecordKey(
  recordKey: string,
  isTalkRecordKey: RecordKeyValidator,
): boolean {
  return (process.env.REPOSITORY_TALK_RECORD_KEYS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(isTalkRecordKey)
    .includes(recordKey);
}

async function readStoredRecord(
  bucketName: string,
  objectKey: string,
  expectedRecordKey: string,
  ifMatch?: StrongEntityTag,
): Promise<StoredTalkRecord> {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: bucketName,
      IfMatch: ifMatch,
      Key: objectKey,
    }),
  );
  const body = await result.Body?.transformToString("utf8");
  const parsedEtag = parseStrongEntityTag(result.ETag);
  if (body === undefined || !parsedEtag.ok) {
    throw new InvalidStoredRecordError();
  }

  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    throw new InvalidStoredRecordError();
  }

  const { parseApiTalkRecord } = await loadApiRecordModule();
  const record = parseApiTalkRecord(value);
  if (record === null || record.recordKey !== expectedRecordKey) {
    throw new InvalidStoredRecordError();
  }

  return Object.freeze({
    record,
    etag: parsedEtag.value,
    ...(result.VersionId === undefined
      ? {}
      : { storageVersion: result.VersionId }),
  });
}

async function listTalkRecords(
  bucketName: string,
): Promise<ListedTalkRecord[]> {
  const { isTalkRecordKey } = await loadIdentityModule();
  const records: ListedTalkRecord[] = [];

  for await (const page of paginateListObjectsV2(
    { client: s3 },
    { Bucket: bucketName, Prefix: TALK_RECORD_PREFIX },
  )) {
    for (const object of page.Contents ?? []) {
      if (object.Key === undefined || object.Key === TALK_RECORD_PREFIX) {
        continue;
      }

      const recordKey = recordKeyFromObjectKey(object.Key, isTalkRecordKey);
      if (recordKey === null) {
        throw new InvalidStoredRecordError();
      }

      let stored: StoredTalkRecord;
      try {
        stored = await readStoredRecord(bucketName, object.Key, recordKey);
      } catch (error) {
        if (isMissingObject(error)) {
          continue;
        }
        throw error;
      }

      records.push(
        Object.freeze({
          record: stored.record,
          recordVersion: stored.etag,
          etag: stored.etag,
          ...(stored.storageVersion === undefined
            ? {}
            : { storageVersion: stored.storageVersion }),
        }),
      );
    }
  }

  records.sort((left, right) =>
    left.record.recordKey.localeCompare(right.record.recordKey, "en"),
  );
  return records;
}

async function handleList(): Promise<APIGatewayProxyResultV2> {
  const bucketName = requiredEnvironment("CONTENT_BUCKET_NAME");
  if (bucketName === null) {
    return jsonResponse(500, { error: "talk_record_operation_failed" });
  }

  try {
    const records = await listTalkRecords(bucketName);
    return jsonResponse(200, { records });
  } catch {
    return jsonResponse(500, { error: "talk_record_operation_failed" });
  }
}

function invalidRecordKeyResponse(): APIGatewayProxyResultV2 {
  return jsonResponse(400, {
    error: "invalid_request",
    message: "recordKey must be a code-derived talk record key",
  });
}

async function handleRemoval(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const { isTalkRecordKey } = await loadIdentityModule();
  const candidateRecordKey = event.pathParameters?.recordKey;
  if (
    candidateRecordKey === undefined ||
    !isTalkRecordKey(candidateRecordKey)
  ) {
    return invalidRecordKeyResponse();
  }
  const recordKey = candidateRecordKey;

  const ifMatch = parseIfMatchPrecondition(event);
  if (!ifMatch.ok) {
    return ifMatch.reason === "missing"
      ? jsonResponse(428, {
          error: "precondition_required",
          message: "If-Match is required for talk record removal",
        })
      : jsonResponse(400, {
          error: "invalid_precondition",
          message: "If-Match must contain one strong entity tag",
        });
  }

  const removalIntent = requestHeader(event, "x-talk-removal");
  if (removalIntent === undefined || removalIntent === "") {
    return jsonResponse(428, {
      error: "precondition_required",
      message: "x-talk-removal: confirmed is required",
    });
  }
  if (removalIntent !== REMOVAL_CONFIRMATION) {
    return jsonResponse(400, {
      error: "invalid_request",
      message: "x-talk-removal must be confirmed",
    });
  }

  if (isRepositoryAuthoredRecordKey(recordKey, isTalkRecordKey)) {
    return jsonResponse(409, {
      error: "repository_authored_talk",
      message:
        "Repository-authored talks can only be removed through a repository change",
      recordKey,
    });
  }

  const bucketName = requiredEnvironment("CONTENT_BUCKET_NAME");
  if (bucketName === null) {
    return jsonResponse(500, { error: "talk_record_operation_failed" });
  }

  const objectKey = recordObjectKey(recordKey);
  let stored: StoredTalkRecord;
  try {
    stored = await readStoredRecord(
      bucketName,
      objectKey,
      recordKey,
      ifMatch.value,
    );
  } catch (error) {
    if (isFailedPrecondition(error)) {
      return jsonResponse(412, { error: "record_changed" });
    }
    if (isMissingObject(error)) {
      return jsonResponse(404, { error: "record_not_found" });
    }
    return jsonResponse(500, { error: "talk_record_operation_failed" });
  }

  let deckObjectKey: string;
  try {
    const { approvedDeckKey } = await loadDeckModule();
    deckObjectKey = approvedDeckKey(stored.record.deckId);
  } catch {
    return jsonResponse(500, { error: "talk_record_operation_failed" });
  }

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        IfMatch: ifMatch.value,
        Key: objectKey,
      }),
    );
  } catch (error) {
    if (isFailedPrecondition(error)) {
      return jsonResponse(412, { error: "record_changed" });
    }
    if (isMissingObject(error)) {
      return jsonResponse(404, { error: "record_not_found" });
    }
    return jsonResponse(500, { error: "talk_record_operation_failed" });
  }

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: deckObjectKey,
      }),
    );
  } catch (error) {
    if (!isMissingObject(error)) {
      logTalkStoreChange(event, {
        action: TALK_LOG_ACTIONS.removal,
        storedVersion: stored.etag,
        invalidationId: null,
      });
      return jsonResponse(500, {
        error: "talk_record_operation_failed",
        recordKey,
      });
    }
  }

  try {
    const invalidation = await invalidateDynamicPaths(TALKS_DYNAMIC_PATHS);
    const invalidationId = invalidation.invalidationId;
    if (!invalidationId) {
      throw new Error("CloudFront returned no invalidation identifier");
    }
    // During the rollout, also refresh the baked pages the off path serves.
    const buildId = await maybeStartPublisherBuild();
    logTalkStoreChange(event, {
      action: TALK_LOG_ACTIONS.removal,
      storedVersion: stored.etag,
      invalidationId,
    });
    return jsonResponse(202, {
      invalidationId,
      ...(buildId === null ? {} : { buildId }),
      deckId: stored.record.deckId,
      recordKey,
      status: "published",
    });
  } catch {
    logTalkStoreChange(event, {
      action: TALK_LOG_ACTIONS.removal,
      storedVersion: stored.etag,
      invalidationId: null,
    });
    return jsonResponse(503, {
      deckId: stored.record.deckId,
      error: "invalidation_not_started",
      recordKey,
    });
  }
}

export const handler: Handler<
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2
> = async (event) => {
  if (!isExpectedEditor(event)) {
    return jsonResponse(403, { error: "forbidden" });
  }

  if (event.requestContext.http.method === "GET") {
    return handleList();
  }
  if (event.requestContext.http.method === "DELETE") {
    return handleRemoval(event);
  }

  return jsonResponse(400, { error: "invalid_request" });
};
