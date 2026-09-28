/**
 * Talks domain model.
 *
 * Feature: talks-section
 *
 * This module owns the exact types shared by the talks content schema, the
 * validated/published read gateways, the archive and filter projections, and
 * the Markdown serializer. It contains no side effects, no filesystem access,
 * and no Astro-specific imports so it can be consumed from build code and
 * plain Node test processes alike.
 */

/** Author-managed frontmatter fields of one talk record. */
export const TALK_DATA_FIELDS = [
  "title",
  "eventName",
  "date",
  "location",
  "eventUrl",
  "eventTypes",
  "tags",
  "slides",
  "videoUrl",
  "sourceCodeUrl",
  "draft",
] as const;

export type TalkDataField = (typeof TALK_DATA_FIELDS)[number];

/**
 * Diagnostic subject. `record` is used for issues that belong to the record as
 * a whole rather than to one author-managed field.
 */
export type TalkField = "record" | TalkDataField;

/** Deterministic field ordering used when sorting diagnostics. */
export const TALK_FIELD_ORDER: readonly TalkField[] = [
  "record",
  ...TALK_DATA_FIELDS,
];

/**
 * Approved acceptance criterion a diagnostic refers to, expressed as the
 * requirement criterion identifier from the talks-section requirements.
 */
export type TalkCriterion =
  | "2.1"
  | "2.2"
  | "2.3"
  | "2.4"
  | "2.5"
  | "2.6"
  | "2.7"
  | "2.8"
  | "2.9"
  | "2.10"
  | "2.11"
  | "5.7"
  | "6.5"
  | "6.6"
  | "6.7"
  | "7.4"
  | "7.6";

/** One author-facing validation diagnostic. */
export type ValidationIssue = Readonly<{
  recordId: string;
  field: TalkField;
  criterion: TalkCriterion;
  message: string;
}>;

/** Failure of a single field check, before it is associated with a record. */
export type FieldFailure = Readonly<{
  criterion: TalkCriterion;
  message: string;
}>;

/** Result of one pure field validator. */
export type FieldResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failures: readonly FieldFailure[] }>;

/** Calendar date that has been validated as a real ISO 8601 full date. */
export type IsoDate = string & Readonly<{ __isoDate: true }>;

/** Root-relative slide path that has been validated as safe. */
export type SlidePath = string & Readonly<{ __slidePath: true }>;

/** Absolute HTTPS URL that has been validated as credential-free. */
export type HttpsUrl = string & Readonly<{ __httpsUrl: true }>;

/**
 * Credential-free absolute HTTPS URL on github.com that has been validated as a
 * safe source-code link (a canonical `github.com` host and a non-empty path).
 * Every `GitHubUrl` is also a valid `HttpsUrl`.
 */
export type GitHubUrl = HttpsUrl & Readonly<{ __gitHubUrl: true }>;

/** Decomposed calendar parts of a validated ISO date. */
export type IsoDateParts = Readonly<{
  year: number;
  month: number;
  day: number;
}>;

/**
 * Event-type tag with the Author's display label preserved and a canonical
 * comparison key used for uniqueness, filter options, and filtering.
 */
export type NormalizedEventType = Readonly<{
  label: string;
  comparisonKey: string;
}>;

/**
 * Topical tag with the Author's display label preserved and a canonical
 * comparison key used for uniqueness, filter options, and filtering.
 *
 * A topical tag is a subject classifier ("Serverless", "AWS Amplify") and is
 * deliberately a distinct type from {@link NormalizedEventType}, which
 * classifies the event format. The two never share a field, a filter axis, or
 * a comparison namespace, so a talk's event types and its topical tags cannot
 * be conflated even when a label coincides.
 */
export type NormalizedTag = Readonly<{
  label: string;
  comparisonKey: string;
}>;

/** Supported embeddable video providers. */
export type TalkVideoProvider = "youtube";

/**
 * Normalized video. `embedUrl` is always code-owned: it is derived from the
 * extracted provider ID and the privacy-enhanced host, never from author text.
 */
export type NormalizedVideo = Readonly<{
  provider: TalkVideoProvider;
  sourceUrl: HttpsUrl;
  videoId: string;
  embedUrl: HttpsUrl;
}>;

/**
 * Unvalidated record shape. Every field is `unknown` because candidates come
 * from author-managed source files and may be missing or wrongly typed.
 */
export type TalkCandidate = Readonly<{
  [Field in TalkDataField]?: unknown;
}>;

/** Author-facing record contract after schema validation. */
export type TalkFrontmatter = Readonly<{
  title: string;
  eventName: string;
  date: string;
  location: string;
  eventUrl: string;
  eventTypes: readonly string[];
  tags?: readonly string[];
  slides: string;
  videoUrl?: string;
  sourceCodeUrl?: string;
  draft: boolean;
}>;

/**
 * Record whose metadata has passed every pure validation rule. Filesystem and
 * PDF-derived values are added separately by asset validation.
 */
export type NormalizedTalk = Readonly<{
  id: string;
  title: string;
  eventName: string;
  date: IsoDate;
  sortEpochMs: number;
  location: string;
  eventUrl: HttpsUrl;
  eventTypes: readonly NormalizedEventType[];
  tags: readonly NormalizedTag[];
  slidePath: SlidePath;
  slidePublicUrl: HttpsUrl;
  video: NormalizedVideo | null;
  sourceCodeUrl: GitHubUrl | null;
  draft: boolean;
}>;

/** Record whose metadata and slide asset have both passed validation. */
export type ValidatedTalk = NormalizedTalk &
  Readonly<{
    slideFilePath: string;
  }>;

/** Validated record that is included in the public build. */
export type PublishedTalk = Omit<ValidatedTalk, "draft"> &
  Readonly<{
    draft: false;
  }>;

/** One selectable talk filter option with a code-owned identifier. */
export type TalkFilterOption = Readonly<{
  id: string;
  label: string;
  comparisonKey: string;
}>;

/** Result of normalizing one candidate record. */
export type TalkNormalizationResult =
  | Readonly<{ ok: true; talk: NormalizedTalk }>
  | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>;

/** Narrows a validated record to the published projection. */
export function isPublishedTalk(talk: ValidatedTalk): talk is PublishedTalk {
  return talk.draft === false;
}

/** Compares two strings by code unit so ordering never depends on a locale. */
function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function fieldRank(field: TalkField): number {
  const index = TALK_FIELD_ORDER.indexOf(field);
  return index === -1 ? TALK_FIELD_ORDER.length : index;
}

/**
 * Deterministic diagnostic ordering: record ID, then canonical field order,
 * then criterion, then message.
 */
export function compareValidationIssues(
  left: ValidationIssue,
  right: ValidationIssue,
): number {
  const byRecord = compareStrings(left.recordId, right.recordId);
  if (byRecord !== 0) return byRecord;

  const byField = fieldRank(left.field) - fieldRank(right.field);
  if (byField !== 0) return byField;

  const byCriterion = compareStrings(left.criterion, right.criterion);
  if (byCriterion !== 0) return byCriterion;

  return compareStrings(left.message, right.message);
}

/** Renders one diagnostic as a single author-facing line. */
export function formatValidationIssue(issue: ValidationIssue): string {
  return `- ${issue.recordId}.${issue.field} [Requirement ${issue.criterion}]: ${issue.message}`;
}

/** Sorts diagnostics into the deterministic author-facing order. */
export function sortValidationIssues(
  issues: readonly ValidationIssue[],
): ValidationIssue[] {
  return [...issues].sort(compareValidationIssues);
}

/**
 * Aggregate build failure. Every discoverable issue across every record is
 * reported at once, in a deterministic order, so the Author does not have to
 * fix one problem per build.
 */
export class TalkValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const ordered = sortValidationIssues(issues);
    const heading = `Talk validation failed (${ordered.length} ${
      ordered.length === 1 ? "issue" : "issues"
    })`;

    super([heading, ...ordered.map(formatValidationIssue)].join("\n"));

    this.name = "TalkValidationError";
    this.issues = Object.freeze(ordered);
  }
}
