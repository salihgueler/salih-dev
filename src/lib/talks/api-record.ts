import {
  DECK_MAX_BYTES,
  DECK_MIN_BYTES,
  deckSlidePath,
  isDeckId,
  type DeckId,
} from "./deck.js";
import {
  deriveTalkIdentity,
  deriveTalkRecordKey,
  isTalkRecordKey,
  type TalkIdentity,
  type TalkRecordKey,
} from "./identity.js";
import type { NormalizedTalk, TalkFrontmatter } from "./model.js";
import { normalizeTalkCandidate } from "./validation.js";

/** Current stored representation of an API-authored talk record. */
export const API_TALK_RECORD_SCHEMA_VERSION = 1 as const;

/** Validated PDF facts recorded when a pending deck becomes approved. */
export type ApiTalkDeckFacts = Readonly<{
  byteLength: number;
  pageCount: number;
}>;

/** Versioned, self-consistent record stored beneath `talks/records/`. */
export type ApiTalkRecord = Readonly<{
  schemaVersion: typeof API_TALK_RECORD_SCHEMA_VERSION;
  talkIdentity: TalkIdentity;
  recordKey: TalkRecordKey;
  deckId: DeckId;
  deck: ApiTalkDeckFacts;
  createdAt: string;
  updatedAt: string;
  frontmatter: TalkFrontmatter;
}>;

type UnknownRecord = Readonly<Record<string, unknown>>;

const TOP_LEVEL_FIELDS = [
  "schemaVersion",
  "talkIdentity",
  "recordKey",
  "deckId",
  "deck",
  "createdAt",
  "updatedAt",
  "frontmatter",
] as const;

const DECK_FIELDS = ["byteLength", "pageCount"] as const;

const REQUIRED_FRONTMATTER_FIELDS = [
  "title",
  "eventName",
  "date",
  "location",
  "eventUrl",
  "eventTypes",
  "slides",
  "draft",
] as const;

const OPTIONAL_FRONTMATTER_FIELDS = [
  "tags",
  "videoUrl",
  "sourceCodeUrl",
] as const;

const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * The existing verifier deliberately supports only a small frontmatter scalar
 * subset. Values requiring escapes other than quotes cannot round-trip through
 * it, so API-authored records reject those values before materialization.
 */
const UNSAFE_FRONTMATTER_TEXT_PATTERN = /[\\\p{Cc}\p{Zl}\p{Zp}]/u;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function hasExactFields(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);

  return (
    required.every((field) => Object.hasOwn(value, field)) &&
    keys.every((key) => typeof key === "string" && allowed.has(key))
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function hasRoundTripSafeText(value: string): boolean {
  return !UNSAFE_FRONTMATTER_TEXT_PATTERN.test(value);
}

function normalizedFrontmatter(talk: NormalizedTalk): TalkFrontmatter {
  const required = {
    title: talk.title,
    eventName: talk.eventName,
    date: talk.date,
    location: talk.location,
    eventUrl: talk.eventUrl,
    eventTypes: Object.freeze(
      talk.eventTypes.map((eventType) => eventType.label),
    ),
  };

  // Topical tags sit directly after eventTypes and are omitted when empty, so
  // an existing record without any topical tags produces byte-identical JSON.
  const withTags =
    talk.tags.length === 0
      ? required
      : {
          ...required,
          tags: Object.freeze(talk.tags.map((tag) => tag.label)),
        };

  const withSlides = {
    ...withTags,
    slides: talk.slidePath,
    draft: talk.draft,
  };

  const withVideo =
    talk.video === null
      ? withSlides
      : { ...withSlides, videoUrl: talk.video.sourceUrl };

  return Object.freeze(
    talk.sourceCodeUrl === null
      ? withVideo
      : { ...withVideo, sourceCodeUrl: talk.sourceCodeUrl },
  );
}

function frontmatterEquals(
  left: UnknownRecord,
  right: TalkFrontmatter,
): boolean {
  if (
    left.title !== right.title ||
    left.eventName !== right.eventName ||
    left.date !== right.date ||
    left.location !== right.location ||
    left.eventUrl !== right.eventUrl ||
    left.slides !== right.slides ||
    left.draft !== right.draft ||
    left.videoUrl !== right.videoUrl ||
    left.sourceCodeUrl !== right.sourceCodeUrl ||
    !isUnknownArray(left.eventTypes) ||
    left.eventTypes.length !== right.eventTypes.length
  ) {
    return false;
  }

  // Topical tags are canonical only when they match the normalized form. The
  // canonical record omits an empty list, so a stored `tags` present alongside
  // an absent canonical value (or vice versa) is a mismatch, and a present
  // pair must be identical element for element in order.
  if (right.tags === undefined) {
    if (Object.hasOwn(left, "tags")) return false;
  } else {
    if (
      !isUnknownArray(left.tags) ||
      left.tags.length !== right.tags.length ||
      !left.tags.every((tag, index) => tag === right.tags?.[index])
    ) {
      return false;
    }
  }

  return left.eventTypes.every(
    (eventType, index) => eventType === right.eventTypes[index],
  );
}

function isRoundTripSafeFrontmatter(frontmatter: TalkFrontmatter): boolean {
  const textValues = [
    frontmatter.title,
    frontmatter.eventName,
    frontmatter.location,
    frontmatter.eventUrl,
    ...frontmatter.eventTypes,
    ...(frontmatter.tags === undefined ? [] : frontmatter.tags),
    ...(frontmatter.videoUrl === undefined ? [] : [frontmatter.videoUrl]),
    ...(frontmatter.sourceCodeUrl === undefined
      ? []
      : [frontmatter.sourceCodeUrl]),
  ];

  return textValues.every(hasRoundTripSafeText);
}

function freezeFrontmatter(frontmatter: TalkFrontmatter): TalkFrontmatter {
  const required = {
    title: frontmatter.title,
    eventName: frontmatter.eventName,
    date: frontmatter.date,
    location: frontmatter.location,
    eventUrl: frontmatter.eventUrl,
    eventTypes: Object.freeze([...frontmatter.eventTypes]),
  };

  const withTags =
    frontmatter.tags === undefined
      ? required
      : { ...required, tags: Object.freeze([...frontmatter.tags]) };

  const withSlides = {
    ...withTags,
    slides: frontmatter.slides,
    draft: frontmatter.draft,
  };

  const withVideo =
    frontmatter.videoUrl === undefined
      ? withSlides
      : { ...withSlides, videoUrl: frontmatter.videoUrl };

  return Object.freeze(
    frontmatter.sourceCodeUrl === undefined
      ? withVideo
      : { ...withVideo, sourceCodeUrl: frontmatter.sourceCodeUrl },
  );
}

/**
 * Strictly parses one stored API talk record. Unknown fields, invalid approved
 * talk values, non-canonical values, and inconsistent derived associations are
 * all rejected rather than repaired.
 */
export function parseApiTalkRecord(value: unknown): ApiTalkRecord | null {
  if (!isRecord(value) || !hasExactFields(value, TOP_LEVEL_FIELDS)) {
    return null;
  }

  const deck = value.deck;
  const frontmatter = value.frontmatter;
  if (
    !isRecord(deck) ||
    !hasExactFields(deck, DECK_FIELDS) ||
    !isRecord(frontmatter) ||
    !hasExactFields(
      frontmatter,
      REQUIRED_FRONTMATTER_FIELDS,
      OPTIONAL_FRONTMATTER_FIELDS,
    )
  ) {
    return null;
  }

  if (
    value.schemaVersion !== API_TALK_RECORD_SCHEMA_VERSION ||
    typeof value.talkIdentity !== "string" ||
    typeof value.recordKey !== "string" ||
    !isTalkRecordKey(value.recordKey) ||
    typeof value.deckId !== "string" ||
    !isDeckId(value.deckId) ||
    typeof deck.byteLength !== "number" ||
    !Number.isInteger(deck.byteLength) ||
    deck.byteLength < DECK_MIN_BYTES ||
    deck.byteLength > DECK_MAX_BYTES ||
    typeof deck.pageCount !== "number" ||
    !Number.isInteger(deck.pageCount) ||
    deck.pageCount < 1 ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    value.createdAt > value.updatedAt
  ) {
    return null;
  }

  const normalized = normalizeTalkCandidate(frontmatter, value.recordKey);
  if (!normalized.ok) return null;

  const canonicalFrontmatter = normalizedFrontmatter(normalized.talk);
  const talkIdentity = deriveTalkIdentity(
    canonicalFrontmatter.date,
    canonicalFrontmatter.title,
  );

  if (
    !frontmatterEquals(frontmatter, canonicalFrontmatter) ||
    !isRoundTripSafeFrontmatter(canonicalFrontmatter) ||
    value.talkIdentity !== talkIdentity ||
    value.recordKey !== deriveTalkRecordKey(talkIdentity) ||
    canonicalFrontmatter.slides !== deckSlidePath(value.deckId)
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion: API_TALK_RECORD_SCHEMA_VERSION,
    talkIdentity,
    recordKey: value.recordKey,
    deckId: value.deckId,
    deck: Object.freeze({
      byteLength: deck.byteLength,
      pageCount: deck.pageCount,
    }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    frontmatter: freezeFrontmatter(canonicalFrontmatter),
  });
}

function requireApiTalkRecord(record: ApiTalkRecord): ApiTalkRecord {
  const parsed = parseApiTalkRecord(record);
  if (parsed === null) {
    throw new TypeError("Cannot serialize an invalid API talk record");
  }
  return parsed;
}

/** Serializes a valid API talk record with stable field ordering and spacing. */
export function serializeApiTalkRecord(record: ApiTalkRecord): string {
  return `${JSON.stringify(requireApiTalkRecord(record), null, 2)}\n`;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

/**
 * Emits frontmatter-only Markdown accepted by both Astro's strict talks schema
 * and the static verifier's intentionally small frontmatter parser.
 */
export function toTalkFrontmatterDocument(record: ApiTalkRecord): string {
  const { frontmatter } = requireApiTalkRecord(record);
  const lines = [
    "---",
    `title: ${quoted(frontmatter.title)}`,
    `eventName: ${quoted(frontmatter.eventName)}`,
    `date: ${quoted(frontmatter.date)}`,
    `location: ${quoted(frontmatter.location)}`,
    `eventUrl: ${quoted(frontmatter.eventUrl)}`,
    "eventTypes:",
    ...frontmatter.eventTypes.map((eventType) => `  - ${quoted(eventType)}`),
    ...(frontmatter.tags === undefined
      ? []
      : ["tags:", ...frontmatter.tags.map((tag) => `  - ${quoted(tag)}`)]),
    `slides: ${quoted(frontmatter.slides)}`,
  ];

  if (frontmatter.videoUrl !== undefined) {
    lines.push(`videoUrl: ${quoted(frontmatter.videoUrl)}`);
  }

  if (frontmatter.sourceCodeUrl !== undefined) {
    lines.push(`sourceCodeUrl: ${quoted(frontmatter.sourceCodeUrl)}`);
  }

  lines.push(`draft: ${frontmatter.draft}`, "---", "");
  return lines.join("\n");
}
