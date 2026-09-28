import { CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
  Handler,
} from "aws-lambda";

import type { ApiTalkRecord } from "../../src/lib/talks/api-record.js" with {
  "resolution-mode": "import",
};
import type { DeckId } from "../../src/lib/talks/deck.js" with {
  "resolution-mode": "import",
};
import type { TalkRecordKey } from "../../src/lib/talks/identity.js" with {
  "resolution-mode": "import",
};
import type { PdfRejection } from "../../src/lib/talks/pdf-document.js" with {
  "resolution-mode": "import",
};
import type { TalkUploadRequest } from "../../src/lib/talks/upload-request.js" with {
  "resolution-mode": "import",
};
import {
  isExpectedEditor,
  jsonResponse,
  logDeckValidation,
  logTalkStoreChange,
  MAX_JSON_BODY_BYTES,
  requestBody,
  requestBodyByteLength,
  TALK_LOG_ACTIONS,
} from "./content-api-shared";

const RECORD_PREFIX = "talks/records/";

const codebuild = new CodeBuildClient({});
const s3 = new S3Client({});

async function loadTalkModules() {
  const [apiRecord, deck, identity, pdfDocument, uploadRequest] =
    await Promise.all([
      import("../../src/lib/talks/api-record.js"),
      import("../../src/lib/talks/deck.js"),
      import("../../src/lib/talks/identity.js"),
      import("../../src/lib/talks/pdf-document.js"),
      import("../../src/lib/talks/upload-request.js"),
    ]);

  return Object.freeze({
    ...apiRecord,
    ...deck,
    ...identity,
    ...pdfDocument,
    ...uploadRequest,
  });
}

type TalkModules = Awaited<ReturnType<typeof loadTalkModules>>;

type CompletionEvent = APIGatewayProxyEventV2WithIAMAuthorizer;

type StoredTalkState = Readonly<{
  record: ApiTalkRecord;
  version: string;
}>;

type ApprovedState = Readonly<{
  approvedStorageKey: string;
  deckId: DeckId;
  byteLength: number;
  pageCount: number;
  recordKey: TalkRecordKey | null;
  recordVersion: string | null;
  storedVersion: string | null;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidCompletionBody(event: CompletionEvent): boolean {
  const body = requestBody(event);
  if (body === null) return true;
  if (requestBodyByteLength(body) > MAX_JSON_BODY_BYTES) return false;

  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) && Reflect.ownKeys(parsed).length === 0;
  } catch {
    return false;
  }
}

function isS3Status(error: unknown, statusCode: number): boolean {
  return (
    error instanceof S3ServiceException &&
    error.$metadata.httpStatusCode === statusCode
  );
}

function recordObjectKey(recordKey: TalkRecordKey): string {
  return `${RECORD_PREFIX}${recordKey}.json`;
}

function encodedCopySource(bucket: string, key: string): string {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${encodeURIComponent(bucket)}/${encodedKey}`;
}

function deckValidationFailure(
  event: CompletionEvent,
  storageKey: string,
  criterion: "4.2" | "4.3" | "4.4" | "4.5" | "4.6",
  byteLength: number | null,
  message: string,
): APIGatewayProxyResultV2 {
  logDeckValidation(event, {
    outcome: "rejected",
    storageKey,
    byteLength,
    pageCount: null,
  });
  return jsonResponse(422, {
    error: "deck_validation_failed",
    criterion,
    message,
  });
}

function pdfCriterion(rejection: PdfRejection): "4.3" | "4.4" | "4.5" | "4.6" {
  switch (rejection.kind) {
    case "signature":
      return "4.3";
    case "empty":
      return "4.5";
    case "encrypted":
      return "4.6";
    case "malformed":
      return "4.4";
  }
}

function pdfRejectionMessage(rejection: PdfRejection): string {
  switch (rejection.kind) {
    case "signature":
      return "The pending deck does not begin with the required PDF signature";
    case "empty":
      return "The pending deck must contain at least one page";
    case "encrypted":
      return "The pending deck must be readable without a password";
    case "malformed":
      return "The pending deck is not a complete readable PDF document";
  }
}

async function readStagedRequest(
  bucket: string,
  deckId: DeckId,
  modules: TalkModules,
): Promise<TalkUploadRequest> {
  const staged = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: modules.pendingRequestKey(deckId),
    }),
  );
  if (staged.Body === undefined) {
    throw new Error("Staged upload request has no body");
  }

  const body = await staged.Body.transformToString();
  if (requestBodyByteLength(body) > MAX_JSON_BODY_BYTES) {
    throw new Error("Staged upload request exceeds its size limit");
  }

  const value: unknown = JSON.parse(body);
  const parsed = modules.parseTalkUploadRequest(
    value,
    modules.deckSlidePath(deckId),
  );
  if (!parsed.ok) {
    throw new Error("Staged upload request is invalid");
  }
  return parsed.request;
}

async function readStoredTalk(
  bucket: string,
  recordKey: TalkRecordKey,
  version: string,
  modules: TalkModules,
): Promise<StoredTalkState> {
  const stored = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      IfMatch: version,
      Key: recordObjectKey(recordKey),
    }),
  );
  if (stored.Body === undefined || stored.ETag === undefined) {
    throw new Error("Stored API talk record is incomplete");
  }

  const body = await stored.Body.transformToString();
  const value: unknown = JSON.parse(body);
  const record = modules.parseApiTalkRecord(value);
  if (record === null || record.recordKey !== recordKey) {
    throw new Error("Stored API talk record is invalid");
  }

  return Object.freeze({ record, version: stored.ETag });
}

function buildApiRecord(
  request: TalkUploadRequest,
  deckId: DeckId,
  byteLength: number,
  pageCount: number,
  previous: ApiTalkRecord | null,
  modules: TalkModules,
): ApiTalkRecord | null {
  if (request.metadata === null) return null;

  const talkIdentity = modules.deriveTalkIdentity(
    request.metadata.date,
    request.metadata.title,
  );
  const recordKey = modules.deriveTalkRecordKey(talkIdentity);
  const now = new Date().toISOString();
  const createdAt = previous?.createdAt ?? now;
  const updatedAt = createdAt > now ? createdAt : now;

  return Object.freeze({
    schemaVersion: modules.API_TALK_RECORD_SCHEMA_VERSION,
    talkIdentity,
    recordKey,
    deckId,
    deck: Object.freeze({ byteLength, pageCount }),
    createdAt,
    updatedAt,
    frontmatter: request.metadata,
  });
}

async function removePendingObjects(
  bucket: string,
  deckId: DeckId,
  modules: TalkModules,
): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: modules.pendingDeckKey(deckId),
    }),
  );
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: modules.pendingRequestKey(deckId),
    }),
  );
}

function logStored(
  event: CompletionEvent,
  state: ApprovedState,
  buildId: string | null,
): void {
  logTalkStoreChange(event, {
    action: TALK_LOG_ACTIONS.store,
    storedVersion: state.storedVersion,
    buildId,
  });
}

export const handler: Handler<
  CompletionEvent,
  APIGatewayProxyResultV2
> = async (event) => {
  if (!isExpectedEditor(event)) {
    return jsonResponse(403, { error: "forbidden" });
  }

  if (!hasValidCompletionBody(event)) {
    return jsonResponse(400, {
      error: "invalid_request",
      message: "The completion request body must be absent or an empty object",
    });
  }

  let modules: TalkModules;
  try {
    modules = await loadTalkModules();
  } catch {
    console.error("Talk upload validation modules could not be loaded");
    return jsonResponse(500, { error: "talk_upload_failed" });
  }

  const deckIdValue = event.pathParameters?.deckId;
  if (typeof deckIdValue !== "string" || !modules.isDeckId(deckIdValue)) {
    return jsonResponse(400, {
      error: "invalid_request",
      message: "deckId must be a code-generated deck identifier",
    });
  }
  const deckId = deckIdValue;

  const bucket = process.env.CONTENT_BUCKET_NAME;
  const publisherProjectName = process.env.PUBLISHER_PROJECT_NAME;
  if (!bucket || !publisherProjectName) {
    console.error("Talk upload completion configuration is missing");
    return jsonResponse(500, { error: "talk_upload_failed" });
  }

  let request: TalkUploadRequest;
  try {
    request = await readStagedRequest(bucket, deckId, modules);
  } catch (error: unknown) {
    if (isS3Status(error, 404)) {
      return jsonResponse(404, { error: "pending_deck_not_found" });
    }
    console.error("Talk upload staged request could not be read");
    return jsonResponse(500, { error: "talk_upload_failed" });
  }

  const pendingStorageKey = modules.pendingDeckKey(deckId);
  let pendingContentLength: number;
  let pendingEntityTag: string;
  try {
    const pendingHead = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: pendingStorageKey }),
    );

    if (
      pendingHead.ContentType !== modules.DECK_MEDIA_TYPE ||
      pendingHead.ContentLength === undefined ||
      !Number.isInteger(pendingHead.ContentLength) ||
      pendingHead.ContentLength < modules.DECK_MIN_BYTES ||
      pendingHead.ContentLength > modules.DECK_MAX_BYTES
    ) {
      return deckValidationFailure(
        event,
        pendingStorageKey,
        "4.2",
        pendingHead.ContentLength ?? null,
        `The pending deck must have media type ${modules.DECK_MEDIA_TYPE} and contain ${modules.DECK_MIN_BYTES} to ${modules.DECK_MAX_BYTES} bytes`,
      );
    }
    if (pendingHead.ETag === undefined) {
      throw new Error("Pending deck has no entity tag");
    }

    pendingContentLength = pendingHead.ContentLength;
    pendingEntityTag = pendingHead.ETag;
  } catch (error: unknown) {
    if (isS3Status(error, 404)) {
      return jsonResponse(404, { error: "pending_deck_not_found" });
    }
    console.error("Talk upload pending deck metadata could not be read");
    logDeckValidation(event, {
      outcome: "error",
      storageKey: pendingStorageKey,
      byteLength: null,
      pageCount: null,
    });
    return jsonResponse(500, { error: "deck_validation_error" });
  }

  let bytes: Uint8Array;
  try {
    const pending = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        IfMatch: pendingEntityTag,
        Key: pendingStorageKey,
      }),
    );
    if (pending.Body === undefined) {
      throw new Error("Pending deck has no body");
    }
    bytes = await pending.Body.transformToByteArray();

    if (
      pending.ContentType !== modules.DECK_MEDIA_TYPE ||
      pending.ContentLength !== pendingContentLength ||
      pending.ETag !== pendingEntityTag ||
      bytes.byteLength !== pendingContentLength
    ) {
      throw new Error("Pending deck changed during validation");
    }
  } catch (error: unknown) {
    if (isS3Status(error, 404)) {
      return jsonResponse(404, { error: "pending_deck_not_found" });
    }
    console.error(
      "Talk upload pending deck bytes could not be read consistently",
    );
    logDeckValidation(event, {
      outcome: "error",
      storageKey: pendingStorageKey,
      byteLength: pendingContentLength,
      pageCount: null,
    });
    return jsonResponse(500, { error: "deck_validation_error" });
  }

  if (!modules.hasPdfSignature(bytes)) {
    return deckValidationFailure(
      event,
      pendingStorageKey,
      "4.3",
      pendingContentLength,
      "The pending deck does not begin with the required PDF signature",
    );
  }

  let parsedPdf: Awaited<ReturnType<TalkModules["readPdfDocument"]>>;
  try {
    parsedPdf = await modules.readPdfDocument(bytes);
  } catch {
    console.error("Talk upload PDF parser failed unexpectedly");
    logDeckValidation(event, {
      outcome: "error",
      storageKey: pendingStorageKey,
      byteLength: pendingContentLength,
      pageCount: null,
    });
    return jsonResponse(500, { error: "deck_validation_error" });
  }

  if (!parsedPdf.ok) {
    return deckValidationFailure(
      event,
      pendingStorageKey,
      pdfCriterion(parsedPdf.rejection),
      pendingContentLength,
      pdfRejectionMessage(parsedPdf.rejection),
    );
  }

  const pageCount = parsedPdf.pageCount;
  logDeckValidation(event, {
    outcome: "accepted",
    storageKey: pendingStorageKey,
    byteLength: pendingContentLength,
    pageCount,
  });

  let previous: StoredTalkState | null = null;
  let prospectiveRecordKey: TalkRecordKey | null = null;
  if (request.metadata !== null) {
    const identity = modules.deriveTalkIdentity(
      request.metadata.date,
      request.metadata.title,
    );
    prospectiveRecordKey = modules.deriveTalkRecordKey(identity);

    if (request.replaces !== null) {
      try {
        previous = await readStoredTalk(
          bucket,
          request.replaces.recordKey,
          request.replaces.version,
          modules,
        );
      } catch (error: unknown) {
        if (isS3Status(error, 404)) {
          return jsonResponse(404, { error: "record_not_found" });
        }
        if (isS3Status(error, 412)) {
          return jsonResponse(412, { error: "record_changed" });
        }
        console.error("Replacement API talk record could not be read");
        return jsonResponse(500, { error: "talk_upload_failed" });
      }
    } else {
      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: recordObjectKey(prospectiveRecordKey),
          }),
        );
        return jsonResponse(409, {
          error: "talk_identity_conflict",
          talkIdentity: identity,
        });
      } catch (error: unknown) {
        if (!isS3Status(error, 404)) {
          console.error("API talk identity could not be checked");
          return jsonResponse(500, { error: "talk_upload_failed" });
        }
      }
    }
  }

  let record: ApiTalkRecord | null;
  try {
    record = buildApiRecord(
      request,
      deckId,
      pendingContentLength,
      pageCount,
      previous?.record ?? null,
      modules,
    );
    if (record !== null) {
      modules.serializeApiTalkRecord(record);
    }
  } catch {
    console.error("Validated talk upload could not be serialized");
    return jsonResponse(500, { error: "talk_upload_failed" });
  }

  const approvedStorageKey = modules.approvedDeckKey(deckId);
  let approvedVersion: string | null = null;
  try {
    const approved = await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CacheControl: "no-store",
        ContentType: modules.DECK_MEDIA_TYPE,
        CopySource: encodedCopySource(bucket, pendingStorageKey),
        CopySourceIfMatch: pendingEntityTag,
        Key: approvedStorageKey,
        Metadata: {
          "byte-length": String(pendingContentLength),
          "page-count": String(pageCount),
        },
        MetadataDirective: "REPLACE",
      }),
    );
    approvedVersion =
      approved.VersionId ?? approved.CopyObjectResult?.ETag ?? null;
  } catch {
    console.error("Validated talk deck could not be stored");
    return jsonResponse(500, { error: "talk_upload_failed" });
  }

  let recordVersion: string | null = null;
  if (record !== null && prospectiveRecordKey !== null) {
    try {
      const stored = await s3.send(
        new PutObjectCommand({
          Body: modules.serializeApiTalkRecord(record),
          Bucket: bucket,
          CacheControl: "no-store",
          ContentType: "application/json; charset=utf-8",
          ...(request.replaces === null
            ? { IfNoneMatch: "*" }
            : { IfMatch: request.replaces.version }),
          Key: recordObjectKey(prospectiveRecordKey),
        }),
      );
      if (stored.ETag === undefined) {
        throw new Error("Stored API talk record has no entity tag");
      }
      recordVersion = stored.ETag;
    } catch (error: unknown) {
      const state: ApprovedState = {
        approvedStorageKey,
        deckId,
        byteLength: pendingContentLength,
        pageCount,
        recordKey: prospectiveRecordKey,
        recordVersion: null,
        storedVersion: approvedVersion,
      };
      logStored(event, state, null);
      if (isS3Status(error, 412)) {
        return request.replaces === null
          ? jsonResponse(409, {
              error: "talk_identity_conflict",
              talkIdentity: record.talkIdentity,
            })
          : jsonResponse(412, { error: "record_changed" });
      }
      console.error("Validated API talk record could not be stored");
      return jsonResponse(500, { error: "talk_upload_failed" });
    }
  }

  const approvedState: ApprovedState = Object.freeze({
    approvedStorageKey,
    deckId,
    byteLength: pendingContentLength,
    pageCount,
    recordKey: prospectiveRecordKey,
    recordVersion,
    storedVersion: recordVersion ?? approvedVersion,
  });

  try {
    await removePendingObjects(bucket, deckId, modules);
    if (previous !== null && previous.record.deckId !== deckId) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: modules.approvedDeckKey(previous.record.deckId),
        }),
      );
    }
  } catch {
    console.error(
      "Talk upload pending or superseded objects could not be cleaned up",
    );
    logStored(event, approvedState, null);
    return jsonResponse(500, { error: "talk_upload_failed" });
  }

  let buildId: string;
  try {
    const publication = await codebuild.send(
      new StartBuildCommand({ projectName: publisherProjectName }),
    );
    if (!publication.build?.id) {
      throw new Error("Publisher returned no build identifier");
    }
    buildId = publication.build.id;
  } catch {
    console.error("Talk upload stored but publication failed to start");
    logStored(event, approvedState, null);
    return jsonResponse(503, {
      error: "publication_not_started",
      deckId,
      approvedStorageKey,
      ...(prospectiveRecordKey === null
        ? {}
        : {
            recordKey: prospectiveRecordKey,
            recordVersion,
          }),
    });
  }

  logStored(event, approvedState, buildId);
  return jsonResponse(
    202,
    {
      status: "publishing",
      deckId,
      approvedStorageKey,
      byteLength: pendingContentLength,
      pageCount,
      buildId,
      ...(prospectiveRecordKey === null
        ? {}
        : {
            recordKey: prospectiveRecordKey,
            recordVersion,
            etag: recordVersion,
          }),
    },
    recordVersion === null ? {} : { etag: recordVersion },
  );
};
