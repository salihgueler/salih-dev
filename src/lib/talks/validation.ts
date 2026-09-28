/**
 * Pure talks metadata validation and normalization.
 *
 * Feature: talks-section
 *
 * Every function here is deterministic and free of side effects: it reads no
 * files, performs no network request, and never mutates or rewrites the
 * author-managed candidate values it inspects. Filesystem and PDF checks live
 * in the asset validator; publication, filtering, and serialization reuse the
 * helpers exported from this module.
 */

import { SITE_ORIGIN } from "../../config/site-origin.js";
import {
  sortValidationIssues,
  type FieldFailure,
  type FieldResult,
  type GitHubUrl,
  type HttpsUrl,
  type IsoDate,
  type IsoDateParts,
  type NormalizedEventType,
  type NormalizedTag,
  type NormalizedTalk,
  type NormalizedVideo,
  type SlidePath,
  type TalkCandidate,
  type TalkCriterion,
  type TalkDataField,
  type TalkNormalizationResult,
  type ValidationIssue,
} from "./model.js";

/** Maximum Unicode code points for title, event name, and location. */
export const TALK_TEXT_MAX_CODE_POINTS = 200;

/** Maximum Unicode code points for one event-type label. */
export const TALK_EVENT_TYPE_MAX_CODE_POINTS = 50;

/** Inclusive event-type cardinality bounds. */
export const TALK_EVENT_TYPE_MIN_COUNT = 1;
export const TALK_EVENT_TYPE_MAX_COUNT = 10;

/** Maximum Unicode code points for one topical tag label. */
export const TALK_TAG_MAX_CODE_POINTS = 50;

/**
 * Inclusive topical-tag cardinality bounds. Tags are optional, so the minimum
 * is zero: an absent field and an empty list both mean "no topical tags". The
 * maximum bounds how many distinct subjects one talk may carry.
 */
export const TALK_TAG_MIN_COUNT = 0;
export const TALK_TAG_MAX_COUNT = 20;

/** Maximum Unicode code points for an external URL field. */
export const TALK_URL_MAX_CODE_POINTS = 2048;

/** Root-relative directory that must contain every slide deck. */
export const TALK_SLIDE_PATH_PREFIX = "/talks/slides/";

/** Privacy-enhanced, code-owned embed origin. */
export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/** Accepted YouTube watch hosts, compared after URL parsing. */
const YOUTUBE_WATCH_HOSTS: ReadonlySet<string> = new Set([
  "www.youtube.com",
  "youtube.com",
]);

/** Accepted YouTube short-link host, compared after URL parsing. */
const YOUTUBE_SHORT_HOST = "youtu.be";

/**
 * Canonical GitHub host accepted for a source-code link, compared after URL
 * parsing. The `www.` alias normalizes to this host; every other host,
 * including a deceptive suffix host such as `github.com.evil.example` or
 * `notgithub.com`, is rejected because the comparison is exact.
 */
const GITHUB_CANONICAL_HOST = "github.com";
const GITHUB_WWW_HOST = "www.github.com";

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SLIDE_FILE_NAME_PATTERN = /^[^/]+\.pdf$/i;

const ENCODED_PATH_CHARACTER_PATTERN = /%(?:2f|5c|2e)/i;

const UNSAFE_PATH_CHARACTER_PATTERN = /[\\?#\s]|[\u0000-\u001f\u007f]/;

/** Criterion reported for each author-managed field. */
const FIELD_CRITERIA: Readonly<Record<TalkDataField, TalkCriterion>> = {
  title: "2.1",
  eventName: "2.2",
  date: "2.3",
  location: "2.4",
  eventUrl: "2.5",
  eventTypes: "2.6",
  tags: "2.11",
  slides: "6.7",
  videoUrl: "2.8",
  sourceCodeUrl: "2.10",
  draft: "2.9",
};

/* ---------------------------------------------------------------------------
 * Text helpers
 * ------------------------------------------------------------------------ */

/** Counts Unicode code points, not UTF-16 code units. */
export function countCodePoints(value: string): number {
  return [...value].length;
}

/** Removes surrounding whitespace and applies Unicode NFC normalization. */
export function normalizeDisplayText(value: string): string {
  return value.trim().normalize("NFC");
}

function failure(
  criterion: TalkCriterion,
  message: string,
): Readonly<{ ok: false; failures: readonly FieldFailure[] }> {
  return Object.freeze({
    ok: false as const,
    failures: Object.freeze([Object.freeze({ criterion, message })]),
  });
}

function success<Value>(value: Value): Readonly<{ ok: true; value: Value }> {
  return Object.freeze({ ok: true as const, value });
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * Validates a required display string: exactly one scalar text value of the
 * permitted Unicode code-point length after trimming and NFC normalization.
 */
export function validateDisplayText(
  value: unknown,
  field: TalkDataField,
  maxCodePoints: number = TALK_TEXT_MAX_CODE_POINTS,
): FieldResult<string> {
  const criterion = FIELD_CRITERIA[field];

  if (isMissing(value)) {
    return failure(criterion, `${field} is required`);
  }

  if (typeof value !== "string") {
    return failure(criterion, `${field} must be a single text value`);
  }

  const normalized = normalizeDisplayText(value);
  const length = countCodePoints(normalized);

  if (length < 1 || length > maxCodePoints) {
    return failure(
      criterion,
      `${field} must be 1 to ${maxCodePoints} Unicode code points after trimming`,
    );
  }

  return success(normalized);
}

/* ---------------------------------------------------------------------------
 * Dates
 * ------------------------------------------------------------------------ */

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Parses an exact `YYYY-MM-DD` string into calendar parts, returning `null`
 * unless the components describe a real proleptic Gregorian date. Parsing is
 * component-based so no locale or legacy `Date` behavior can accept an
 * impossible date such as `2026-02-30`.
 */
export function parseIsoDateParts(value: string): IsoDateParts | null {
  if (!ISO_DATE_PATTERN.test(value)) return null;

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return Object.freeze({ year, month, day });
}

/** True when the value is exactly a real ISO 8601 full-date calendar date. */
export function validateIsoDate(value: string): boolean {
  return parseIsoDateParts(value) !== null;
}

/**
 * Converts a validated ISO date to a UTC epoch timestamp used for ordering.
 * `setUTCFullYear` avoids the legacy two-digit-year mapping of `Date.UTC`.
 */
export function isoDateToEpochMs(date: IsoDate): number {
  const parts = parseIsoDateParts(date);
  if (parts === null) {
    throw new Error(`Cannot convert an invalid ISO date: ${date}`);
  }

  const value = new Date(0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  value.setUTCHours(0, 0, 0, 0);
  return value.getTime();
}

function validateTalkDate(value: unknown): FieldResult<IsoDate> {
  const criterion = FIELD_CRITERIA.date;

  if (isMissing(value)) {
    return failure(criterion, "date is required");
  }

  if (typeof value !== "string") {
    return failure(
      criterion,
      "date must be a single quoted YYYY-MM-DD text value",
    );
  }

  if (!validateIsoDate(value)) {
    return failure(
      criterion,
      "date must be a real calendar date in exact YYYY-MM-DD form",
    );
  }

  return success(value as IsoDate);
}

/* ---------------------------------------------------------------------------
 * External URLs
 * ------------------------------------------------------------------------ */

/**
 * Parses a credential-free absolute HTTPS URL with a host, preserving the
 * author's trimmed value so links keep their exact source destination.
 */
export function parseHttpsUrl(value: string): HttpsUrl | null {
  const trimmed = value.trim();
  const length = countCodePoints(trimmed);

  if (length < 1 || length > TALK_URL_MAX_CODE_POINTS) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  if (url.username !== "" || url.password !== "") return null;

  return trimmed as HttpsUrl;
}

function validateEventUrl(value: unknown): FieldResult<HttpsUrl> {
  const criterion = FIELD_CRITERIA.eventUrl;

  if (isMissing(value)) {
    return failure(criterion, "eventUrl is required");
  }

  if (typeof value !== "string") {
    return failure(criterion, "eventUrl must be a single text value");
  }

  const parsed = parseHttpsUrl(value);
  if (parsed === null) {
    return failure(
      criterion,
      `eventUrl must be an absolute https URL with a host, no credentials, and 1 to ${TALK_URL_MAX_CODE_POINTS} Unicode code points`,
    );
  }

  return success(parsed);
}

/**
 * Parses a credential-free absolute HTTPS source-code link on github.com.
 *
 * Built on {@link parseHttpsUrl}, so credentials, non-HTTPS protocols, and
 * over-length values are already rejected. Hosts are compared after parsing:
 * only the canonical `github.com` and its `www.github.com` alias are accepted,
 * so a deceptive suffix host (`github.com.evil.example`), a look-alike host
 * (`notgithub.com`), or a subdomain (`gist.github.com`, `raw.github.com`) is
 * rejected. The `www.` alias normalizes to the canonical host while the rest of
 * the URL is preserved exactly, and the path must be a non-empty value beyond
 * the root so a bare host with no repository reference is rejected.
 */
export function parseGitHubHttpsUrl(value: string): GitHubUrl | null {
  const parsed = parseHttpsUrl(value);
  if (parsed === null) return null;

  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    return null;
  }

  if (url.hostname !== GITHUB_CANONICAL_HOST && url.hostname !== GITHUB_WWW_HOST) {
    return null;
  }

  // A non-empty safe path is required: the pathname must reach beyond the root
  // and every segment must carry content, so neither `https://github.com` nor
  // `https://github.com/` nor `https://github.com//` is accepted.
  const segments = url.pathname.split("/").slice(1);
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return null;
  }

  if (url.hostname === GITHUB_WWW_HOST) {
    url.hostname = GITHUB_CANONICAL_HOST;
    return url.toString() as GitHubUrl;
  }

  return parsed as GitHubUrl;
}

function validateSourceCodeUrl(
  value: unknown,
): FieldResult<GitHubUrl | null> {
  const criterion = FIELD_CRITERIA.sourceCodeUrl;

  if (value === undefined) return success(null);

  if (value === null) {
    return failure(
      criterion,
      "sourceCodeUrl must be omitted entirely when a talk has no source code",
    );
  }

  if (typeof value !== "string") {
    return failure(criterion, "sourceCodeUrl must be a single text value");
  }

  const parsed = parseGitHubHttpsUrl(value);
  if (parsed === null) {
    return failure(
      criterion,
      "sourceCodeUrl must be a credential-free absolute https URL on github.com with a non-empty repository path",
    );
  }

  return success(parsed);
}

/** True when the value is exactly an 11-character YouTube video ID. */
export function isYouTubeVideoId(value: string): boolean {
  return YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

/**
 * Extracts the video ID from a narrowly supported YouTube source URL:
 * `https://www.youtube.com/watch?v=ID`, `https://youtube.com/watch?v=ID`, or
 * `https://youtu.be/ID`. Hosts are compared after parsing, so deceptive
 * suffix hosts, credentials, ports, fragments, alternate providers, arbitrary
 * embed paths, playlist-only URLs, and invalid IDs are all rejected.
 */
export function parseYouTubeVideoId(value: string): string | null {
  const parsed = parseHttpsUrl(value);
  if (parsed === null) return null;

  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    return null;
  }

  if (url.port !== "") return null;
  if (url.hash !== "") return null;

  if (YOUTUBE_WATCH_HOSTS.has(url.hostname)) {
    if (url.pathname !== "/watch") return null;

    const ids = url.searchParams.getAll("v");
    if (ids.length !== 1) return null;

    const id = ids[0];
    return id !== undefined && isYouTubeVideoId(id) ? id : null;
  }

  if (url.hostname === YOUTUBE_SHORT_HOST) {
    const id = url.pathname.slice(1);
    return isYouTubeVideoId(id) ? id : null;
  }

  return null;
}

/**
 * Derives the code-owned privacy-enhanced embed URL. Host, path, ID, and query
 * are generated here; no author value can contribute an attribute or parameter.
 */
export function deriveYouTubeEmbedUrl(videoId: string): HttpsUrl {
  if (!isYouTubeVideoId(videoId)) {
    throw new Error("Cannot derive an embed URL for an invalid video ID");
  }

  return `${YOUTUBE_EMBED_ORIGIN}/embed/${videoId}?autoplay=1` as HttpsUrl;
}

/**
 * Normalizes a supplied video URL. Returns `null` when the value is not a
 * supported YouTube source form; record validation reports that as a failure
 * because only an absent optional field means "no video".
 */
export function normalizeVideoUrl(value: string): NormalizedVideo | null {
  const videoId = parseYouTubeVideoId(value);
  if (videoId === null) return null;

  return Object.freeze({
    provider: "youtube" as const,
    sourceUrl: value.trim() as HttpsUrl,
    videoId,
    embedUrl: deriveYouTubeEmbedUrl(videoId),
  });
}

function validateVideoUrl(value: unknown): FieldResult<NormalizedVideo | null> {
  const criterion = FIELD_CRITERIA.videoUrl;

  if (value === undefined) return success(null);

  if (value === null) {
    return failure(
      criterion,
      "videoUrl must be omitted entirely when a talk has no recording",
    );
  }

  if (typeof value !== "string") {
    return failure(criterion, "videoUrl must be a single text value");
  }

  const video = normalizeVideoUrl(value);
  if (video === null) {
    return failure(
      criterion,
      "videoUrl must be an https youtube.com/watch?v=ID or youtu.be/ID URL with a valid 11-character video ID",
    );
  }

  return success(video);
}

/* ---------------------------------------------------------------------------
 * Event types
 * ------------------------------------------------------------------------ */

/**
 * Normalizes one event-type label. The display label keeps the Author's
 * trimmed capitalization; the comparison key is locale-independent case-folded
 * NFC text used for uniqueness, filter options, and filtering.
 */
export function normalizeEventType(value: string): NormalizedEventType {
  const label = normalizeDisplayText(value);

  return Object.freeze({
    label,
    comparisonKey: label.toLowerCase().normalize("NFC"),
  });
}

function validateEventTypes(
  value: unknown,
): FieldResult<readonly NormalizedEventType[]> {
  const criterion = FIELD_CRITERIA.eventTypes;

  if (isMissing(value)) {
    return failure(criterion, "eventTypes is required");
  }

  if (!Array.isArray(value)) {
    return failure(
      criterion,
      `eventTypes must be a list of ${TALK_EVENT_TYPE_MIN_COUNT} to ${TALK_EVENT_TYPE_MAX_COUNT} text values`,
    );
  }

  const candidates: readonly unknown[] = value;
  const failures: FieldFailure[] = [];

  if (
    candidates.length < TALK_EVENT_TYPE_MIN_COUNT ||
    candidates.length > TALK_EVENT_TYPE_MAX_COUNT
  ) {
    failures.push({
      criterion,
      message: `eventTypes must contain ${TALK_EVENT_TYPE_MIN_COUNT} to ${TALK_EVENT_TYPE_MAX_COUNT} values`,
    });
  }

  const normalized: NormalizedEventType[] = [];
  const seen = new Map<string, string>();

  candidates.forEach((entry, index) => {
    if (typeof entry !== "string") {
      failures.push({
        criterion,
        message: `eventTypes[${index}] must be a single text value`,
      });
      return;
    }

    const eventType = normalizeEventType(entry);
    const length = countCodePoints(eventType.label);

    if (length < 1 || length > TALK_EVENT_TYPE_MAX_CODE_POINTS) {
      failures.push({
        criterion,
        message: `eventTypes[${index}] must be 1 to ${TALK_EVENT_TYPE_MAX_CODE_POINTS} Unicode code points after trimming`,
      });
      return;
    }

    const conflict = seen.get(eventType.comparisonKey);
    if (conflict !== undefined) {
      failures.push({
        criterion,
        message: `eventTypes[${index}] "${eventType.label}" duplicates "${conflict}" after normalization`,
      });
      return;
    }

    seen.set(eventType.comparisonKey, eventType.label);
    normalized.push(eventType);
  });

  if (failures.length > 0) {
    return Object.freeze({
      ok: false as const,
      failures: Object.freeze(failures.map((entry) => Object.freeze(entry))),
    });
  }

  return success(Object.freeze(normalized) as readonly NormalizedEventType[]);
}

/* ---------------------------------------------------------------------------
 * Topical tags
 * ------------------------------------------------------------------------ */

/**
 * Normalizes one topical-tag label. Mirrors {@link normalizeEventType} exactly:
 * the display label keeps the Author's trimmed capitalization, and the
 * comparison key is locale-independent case-folded NFC text used for
 * uniqueness, filter options, and filtering. The two remain distinct types so
 * the topical-tag axis is never conflated with the event-type axis.
 */
export function normalizeTag(value: string): NormalizedTag {
  const label = normalizeDisplayText(value);

  return Object.freeze({
    label,
    comparisonKey: label.toLowerCase().normalize("NFC"),
  });
}

/**
 * Validates the optional topical-tags field.
 *
 * The field is backward compatible: an omitted value means "no topical tags"
 * and normalizes to an empty list, so existing repository and API-authored
 * records without the field remain valid. An explicit `null` is rejected,
 * matching the strict repository schema and upload contract. When present it
 * must be a list of up to {@link TALK_TAG_MAX_COUNT} unique, non-empty display
 * labels of 1 to {@link TALK_TAG_MAX_CODE_POINTS} Unicode code points each.
 * Every malformed shape and value is rejected with an exact diagnostic; the
 * field is never repaired or truncated.
 */
function validateTags(
  value: unknown,
): FieldResult<readonly NormalizedTag[]> {
  const criterion = FIELD_CRITERIA.tags;

  if (value === undefined) {
    return success(Object.freeze([]) as readonly NormalizedTag[]);
  }

  if (!Array.isArray(value)) {
    return failure(
      criterion,
      `tags must be omitted or a list of 0 to ${TALK_TAG_MAX_COUNT} text values`,
    );
  }

  const candidates: readonly unknown[] = value;
  const failures: FieldFailure[] = [];

  if (candidates.length > TALK_TAG_MAX_COUNT) {
    failures.push({
      criterion,
      message: `tags must contain ${TALK_TAG_MIN_COUNT} to ${TALK_TAG_MAX_COUNT} values`,
    });
  }

  const normalized: NormalizedTag[] = [];
  const seen = new Map<string, string>();

  candidates.forEach((entry, index) => {
    if (typeof entry !== "string") {
      failures.push({
        criterion,
        message: `tags[${index}] must be a single text value`,
      });
      return;
    }

    const tag = normalizeTag(entry);
    const length = countCodePoints(tag.label);

    if (length < 1 || length > TALK_TAG_MAX_CODE_POINTS) {
      failures.push({
        criterion,
        message: `tags[${index}] must be 1 to ${TALK_TAG_MAX_CODE_POINTS} Unicode code points after trimming`,
      });
      return;
    }

    const conflict = seen.get(tag.comparisonKey);
    if (conflict !== undefined) {
      failures.push({
        criterion,
        message: `tags[${index}] "${tag.label}" duplicates "${conflict}" after normalization`,
      });
      return;
    }

    seen.set(tag.comparisonKey, tag.label);
    normalized.push(tag);
  });

  if (failures.length > 0) {
    return Object.freeze({
      ok: false as const,
      failures: Object.freeze(failures.map((entry) => Object.freeze(entry))),
    });
  }

  return success(Object.freeze(normalized) as readonly NormalizedTag[]);
}

/* ---------------------------------------------------------------------------
 * Slides
 * ------------------------------------------------------------------------ */

function hasSafeSlidePathShape(value: string): boolean {
  if (!value.startsWith(TALK_SLIDE_PATH_PREFIX)) return false;
  if (UNSAFE_PATH_CHARACTER_PATTERN.test(value)) return false;

  const segments = value.slice(1).split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    return false;
  }

  const fileName = segments.at(-1) ?? "";
  if (!SLIDE_FILE_NAME_PATTERN.test(fileName)) return false;

  return countCodePoints(fileName) > ".pdf".length;
}

function decodePath(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Validates one root-relative slide path beneath `/talks/slides/`. Traversal
 * segments, backslashes, whitespace, control characters, query strings,
 * fragments, empty segments, encoded separators or dots, and non-PDF names are
 * rejected before any filesystem access.
 */
export function validateSlidePath(value: string): SlidePath | null {
  const trimmed = value.trim();

  if (!hasSafeSlidePathShape(trimmed)) return null;
  if (ENCODED_PATH_CHARACTER_PATTERN.test(trimmed)) return null;

  const decoded = decodePath(trimmed);
  if (decoded === null) return null;
  if (!hasSafeSlidePathShape(decoded)) return null;

  return trimmed as SlidePath;
}

/**
 * Derives the public slide URL from a validated path and the configured site
 * origin. The path is preserved exactly and the origin is never author-supplied.
 */
export function deriveSlidePublicUrl(slidePath: SlidePath): HttpsUrl {
  const url = new URL(slidePath, SITE_ORIGIN);

  if (url.protocol !== "https:" || url.hostname === "") {
    throw new Error(
      `Configured site origin must be an https URL with a host: ${SITE_ORIGIN}`,
    );
  }

  return url.toString() as HttpsUrl;
}

function validateSlides(value: unknown): FieldResult<SlidePath> {
  const criterion = FIELD_CRITERIA.slides;

  if (isMissing(value)) {
    return failure(
      criterion,
      "slides must reference exactly one PDF slide deck",
    );
  }

  if (typeof value !== "string") {
    return failure(
      criterion,
      "slides must be exactly one root-relative PDF path, not a list or object",
    );
  }

  const slidePath = validateSlidePath(value);
  if (slidePath === null) {
    return failure(
      criterion,
      `slides must be a safe root-relative .pdf path beneath ${TALK_SLIDE_PATH_PREFIX}`,
    );
  }

  return success(slidePath);
}

/* ---------------------------------------------------------------------------
 * Draft flag
 * ------------------------------------------------------------------------ */

function validateDraft(value: unknown): FieldResult<boolean> {
  if (value === undefined) return success(false);

  if (typeof value !== "boolean") {
    return failure(FIELD_CRITERIA.draft, "draft must be true or false");
  }

  return success(value);
}

/* ---------------------------------------------------------------------------
 * Record validation
 * ------------------------------------------------------------------------ */

function issuesFrom(
  recordId: string,
  field: TalkDataField,
  result: FieldResult<unknown>,
): ValidationIssue[] {
  if (result.ok) return [];

  return result.failures.map((entry) =>
    Object.freeze({
      recordId,
      field,
      criterion: entry.criterion,
      message: entry.message,
    }),
  );
}

function isCandidateRecord(value: unknown): value is TalkCandidate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates and normalizes one candidate record without mutating it. Every
 * violated field criterion produces its own diagnostic, and satisfied criteria
 * produce none.
 */
export function normalizeTalkCandidate(
  candidate: unknown,
  recordId: string,
): TalkNormalizationResult {
  if (!isCandidateRecord(candidate)) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([
        Object.freeze({
          recordId,
          field: "record" as const,
          criterion: "2.9" as const,
          message: "talk record must be a mapping of the approved talk fields",
        }),
      ]),
    });
  }

  const title = validateDisplayText(candidate.title, "title");
  const eventName = validateDisplayText(candidate.eventName, "eventName");
  const date = validateTalkDate(candidate.date);
  const location = validateDisplayText(candidate.location, "location");
  const eventUrl = validateEventUrl(candidate.eventUrl);
  const eventTypes = validateEventTypes(candidate.eventTypes);
  const tags = validateTags(candidate.tags);
  const slides = validateSlides(candidate.slides);
  const video = validateVideoUrl(candidate.videoUrl);
  const sourceCodeUrl = validateSourceCodeUrl(candidate.sourceCodeUrl);
  const draft = validateDraft(candidate.draft);

  const issues: ValidationIssue[] = [
    ...issuesFrom(recordId, "title", title),
    ...issuesFrom(recordId, "eventName", eventName),
    ...issuesFrom(recordId, "date", date),
    ...issuesFrom(recordId, "location", location),
    ...issuesFrom(recordId, "eventUrl", eventUrl),
    ...issuesFrom(recordId, "eventTypes", eventTypes),
    ...issuesFrom(recordId, "tags", tags),
    ...issuesFrom(recordId, "slides", slides),
    ...issuesFrom(recordId, "videoUrl", video),
    ...issuesFrom(recordId, "sourceCodeUrl", sourceCodeUrl),
    ...issuesFrom(recordId, "draft", draft),
  ];

  if (
    !title.ok ||
    !eventName.ok ||
    !date.ok ||
    !location.ok ||
    !eventUrl.ok ||
    !eventTypes.ok ||
    !tags.ok ||
    !slides.ok ||
    !video.ok ||
    !sourceCodeUrl.ok ||
    !draft.ok
  ) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze(sortValidationIssues(issues)),
    });
  }

  const talk: NormalizedTalk = Object.freeze({
    id: recordId,
    title: title.value,
    eventName: eventName.value,
    date: date.value,
    sortEpochMs: isoDateToEpochMs(date.value),
    location: location.value,
    eventUrl: eventUrl.value,
    eventTypes: eventTypes.value,
    tags: tags.value,
    slidePath: slides.value,
    slidePublicUrl: deriveSlidePublicUrl(slides.value),
    video: video.value,
    sourceCodeUrl: sourceCodeUrl.value,
    draft: draft.value,
  });

  return Object.freeze({ ok: true as const, talk });
}

/**
 * Returns every metadata diagnostic for one candidate record, in deterministic
 * order. An empty array means the record satisfied every pure metadata rule.
 */
export function validateTalkCandidate(
  candidate: unknown,
  recordId: string,
): ValidationIssue[] {
  const result = normalizeTalkCandidate(candidate, recordId);
  return result.ok ? [] : [...result.issues];
}
