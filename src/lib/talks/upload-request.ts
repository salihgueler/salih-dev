import {
  type TalkCandidate,
  type TalkCriterion,
  type TalkDataField,
  type TalkField,
  type TalkFrontmatter,
  type ValidationIssue,
} from "./model.js";
import {
  deriveTalkIdentity,
  deriveTalkRecordKey,
  isTalkRecordKey,
  type TalkRecordKey,
} from "./identity.js";
import { normalizeTalkCandidate } from "./validation.js";

/** Members accepted by the one code-owned talk upload request contract. */
export const TALK_UPLOAD_REQUEST_FIELDS = ["metadata", "replaces"] as const;

/** Approved talk fields callers may supply; `slides` is always code-derived. */
export const TALK_UPLOAD_METADATA_FIELDS = [
  "title",
  "eventName",
  "date",
  "location",
  "eventUrl",
  "eventTypes",
  "videoUrl",
  "sourceCodeUrl",
  "draft",
] as const;

/** Members required to identify and conditionally replace one stored record. */
export const TALK_UPLOAD_REPLACEMENT_FIELDS = [
  "recordKey",
  "version",
] as const;

export type TalkUploadMetadataField =
  (typeof TALK_UPLOAD_METADATA_FIELDS)[number];

export type TalkUploadReplacement = Readonly<{
  recordKey: TalkRecordKey;
  version: string;
}>;

/** Parsed request with normalized metadata and an injected slide association. */
export type TalkUploadRequest = Readonly<{
  metadata: TalkFrontmatter | null;
  replaces: TalkUploadReplacement | null;
}>;

export type UploadIssue =
  | Readonly<{
      code: "invalid_request";
      path: "request" | "metadata" | "replaces";
      message: string;
    }>
  | Readonly<{
      code: "unsupported_member";
      path: "request" | "metadata" | "replaces";
      member: string;
      message: string;
    }>
  | Readonly<{
      code: "invalid_metadata";
      path: string;
      field: TalkField;
      criterion: TalkCriterion | "6.3";
      message: string;
    }>
  | Readonly<{
      code: "invalid_precondition";
      path: "replaces.recordKey" | "replaces.version";
      message: string;
    }>
  | Readonly<{
      code: "talk_identity_change_unsupported";
      path: "replaces.recordKey";
      message: string;
    }>;

export type UploadRequestResult =
  | Readonly<{ ok: true; request: TalkUploadRequest }>
  | Readonly<{ ok: false; issues: readonly UploadIssue[] }>;

type UnknownRecord = Readonly<Record<string, unknown>>;

const API_UNSAFE_TEXT_PATTERN = /[\\\p{Cc}\u2028\u2029]/u;
const ENTITY_TAG_PATTERN = /^"[!#-~]+"$/u;
const PARSER_RECORD_ID = "talk-upload-request";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: UnknownRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function unsupportedMemberIssues(
  value: UnknownRecord,
  allowed: readonly string[],
  path: "request" | "metadata" | "replaces",
): UploadIssue[] {
  const allowedFields = new Set(allowed);

  return Object.keys(value)
    .filter((member) => !allowedFields.has(member))
    .sort()
    .map((member) =>
      Object.freeze({
        code: "unsupported_member" as const,
        path,
        member,
        message: `${path} has unsupported member ${JSON.stringify(member)}`,
      }),
    );
}

function invalidMetadataIssue(
  issue: ValidationIssue,
): Extract<UploadIssue, { code: "invalid_metadata" }> {
  return Object.freeze({
    code: "invalid_metadata",
    path:
      issue.field === "record" ? "metadata" : `metadata.${issue.field}`,
    field: issue.field,
    criterion: issue.criterion,
    message: issue.message,
  });
}

function roundTripTextIssue(
  field: TalkDataField,
  path: string,
): Extract<UploadIssue, { code: "invalid_metadata" }> {
  return Object.freeze({
    code: "invalid_metadata",
    path,
    field,
    criterion: "6.3",
    message: `${path} must contain no control characters, line separators, or backslashes`,
  });
}

function roundTripTextIssues(metadata: UnknownRecord): UploadIssue[] {
  const issues: UploadIssue[] = [];
  const scalarFields: readonly TalkUploadMetadataField[] = [
    "title",
    "eventName",
    "date",
    "location",
    "eventUrl",
    "videoUrl",
    "sourceCodeUrl",
  ];

  for (const field of scalarFields) {
    const value = metadata[field];
    if (typeof value === "string" && API_UNSAFE_TEXT_PATTERN.test(value)) {
      issues.push(roundTripTextIssue(field, `metadata.${field}`));
    }
  }

  const eventTypes = metadata.eventTypes;
  if (Array.isArray(eventTypes)) {
    eventTypes.forEach((value: unknown, index: number) => {
      if (typeof value === "string" && API_UNSAFE_TEXT_PATTERN.test(value)) {
        issues.push(
          roundTripTextIssue("eventTypes", `metadata.eventTypes[${index}]`),
        );
      }
    });
  }

  return issues;
}

function metadataCandidate(
  metadata: UnknownRecord,
  slidePath: string,
): TalkCandidate {
  return Object.freeze({
    title: metadata.title,
    eventName: metadata.eventName,
    date: metadata.date,
    location: metadata.location,
    eventUrl: metadata.eventUrl,
    eventTypes: metadata.eventTypes,
    slides: slidePath,
    videoUrl: metadata.videoUrl,
    sourceCodeUrl: metadata.sourceCodeUrl,
    draft: metadata.draft,
  });
}

function toFrontmatter(
  normalized: Extract<
    ReturnType<typeof normalizeTalkCandidate>,
    { ok: true }
  >["talk"],
): TalkFrontmatter {
  const eventTypes = Object.freeze(
    normalized.eventTypes.map((eventType) => eventType.label),
  );
  const common = {
    title: normalized.title,
    eventName: normalized.eventName,
    date: normalized.date,
    location: normalized.location,
    eventUrl: normalized.eventUrl,
    eventTypes,
    slides: normalized.slidePath,
    draft: normalized.draft,
  };

  const withVideo =
    normalized.video === null
      ? common
      : { ...common, videoUrl: normalized.video.sourceUrl };

  return Object.freeze(
    normalized.sourceCodeUrl === null
      ? withVideo
      : { ...withVideo, sourceCodeUrl: normalized.sourceCodeUrl },
  );
}

function parseMetadata(
  value: unknown,
  slidePath: string,
): Readonly<{
  metadata: TalkFrontmatter | null;
  issues: readonly UploadIssue[];
}> {
  if (!isRecord(value)) {
    return Object.freeze({
      metadata: null,
      issues: Object.freeze([
        Object.freeze({
          code: "invalid_request" as const,
          path: "metadata" as const,
          message: "metadata must be a mapping of the approved talk fields",
        }),
      ]),
    });
  }

  const issues: UploadIssue[] = [
    ...unsupportedMemberIssues(
      value,
      TALK_UPLOAD_METADATA_FIELDS,
      "metadata",
    ),
    ...roundTripTextIssues(value),
  ];
  const normalized = normalizeTalkCandidate(
    metadataCandidate(value, slidePath),
    PARSER_RECORD_ID,
  );

  if (!normalized.ok) {
    issues.push(...normalized.issues.map(invalidMetadataIssue));
  }

  return Object.freeze({
    metadata: normalized.ok ? toFrontmatter(normalized.talk) : null,
    issues: Object.freeze(issues),
  });
}

function parseReplacement(value: unknown): Readonly<{
  replacement: TalkUploadReplacement | null;
  issues: readonly UploadIssue[];
}> {
  if (!isRecord(value)) {
    return Object.freeze({
      replacement: null,
      issues: Object.freeze([
        Object.freeze({
          code: "invalid_request" as const,
          path: "replaces" as const,
          message: "replaces must be a mapping with recordKey and version",
        }),
      ]),
    });
  }

  const issues: UploadIssue[] = unsupportedMemberIssues(
    value,
    TALK_UPLOAD_REPLACEMENT_FIELDS,
    "replaces",
  );
  const recordKey = value.recordKey;
  const version = value.version;

  if (typeof recordKey !== "string" || !isTalkRecordKey(recordKey)) {
    issues.push(
      Object.freeze({
        code: "invalid_precondition",
        path: "replaces.recordKey",
        message: "replaces.recordKey must be a code-derived talk record key",
      }),
    );
  }

  if (typeof version !== "string" || !ENTITY_TAG_PATTERN.test(version)) {
    issues.push(
      Object.freeze({
        code: "invalid_precondition",
        path: "replaces.version",
        message: "replaces.version must be one non-empty quoted entity tag",
      }),
    );
  }

  if (
    typeof recordKey !== "string" ||
    !isTalkRecordKey(recordKey) ||
    typeof version !== "string" ||
    !ENTITY_TAG_PATTERN.test(version)
  ) {
    return Object.freeze({
      replacement: null,
      issues: Object.freeze(issues),
    });
  }

  return Object.freeze({
    replacement: Object.freeze({ recordKey, version }),
    issues: Object.freeze(issues),
  });
}

/**
 * Parses one upload request without trusting caller-controlled storage values.
 * Metadata is normalized by the repository validator after the code-derived
 * slide path is injected, and replacement identity is checked by deriving the
 * same canonical record key used by the store.
 */
export function parseTalkUploadRequest(
  body: unknown,
  slidePath: string,
): UploadRequestResult {
  if (!isRecord(body)) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([
        Object.freeze({
          code: "invalid_request" as const,
          path: "request" as const,
          message: "talk upload request must be a mapping",
        }),
      ]),
    });
  }

  const issues: UploadIssue[] = unsupportedMemberIssues(
    body,
    TALK_UPLOAD_REQUEST_FIELDS,
    "request",
  );

  const parsedMetadata = hasOwn(body, "metadata")
    ? parseMetadata(body.metadata, slidePath)
    : Object.freeze({ metadata: null, issues: Object.freeze([]) });
  issues.push(...parsedMetadata.issues);

  const parsedReplacement = hasOwn(body, "replaces")
    ? parseReplacement(body.replaces)
    : Object.freeze({ replacement: null, issues: Object.freeze([]) });
  issues.push(...parsedReplacement.issues);

  if (
    parsedMetadata.metadata !== null &&
    parsedReplacement.replacement !== null
  ) {
    const identity = deriveTalkIdentity(
      parsedMetadata.metadata.date,
      parsedMetadata.metadata.title,
    );
    const expectedKey = deriveTalkRecordKey(identity);

    if (expectedKey !== parsedReplacement.replacement.recordKey) {
      issues.push(
        Object.freeze({
          code: "talk_identity_change_unsupported",
          path: "replaces.recordKey",
          message:
            "replacement metadata must preserve the target talk identity",
        }),
      );
    }
  }

  if (issues.length > 0) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze(issues),
    });
  }

  return Object.freeze({
    ok: true as const,
    request: Object.freeze({
      metadata: parsedMetadata.metadata,
      replaces: parsedReplacement.replacement,
    }),
  });
}
