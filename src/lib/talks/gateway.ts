/**
 * Talks validated and published read gateways.
 *
 * Feature: talks-section
 *
 * This module is the only place that reads the raw `talks` collection. Every
 * talk-derived output (the HTML archive, the Markdown alternate, the sitemap
 * entry, and the LLM discovery indexes) resolves its data here so no consumer
 * can apply its own publication, normalization, or ordering rule.
 *
 * Two layers live in this file:
 *
 * 1. Pure projection helpers (`resolveValidatedTalks`, `selectPublishedTalks`,
 *    `sortPublishedTalks`) that operate on already-read records. These have no
 *    Astro dependency, so build code, verification scripts, and plain Node test
 *    processes can all exercise them.
 * 2. The collection boundary (`getValidatedTalks`, `getPublishedTalks`,
 *    `getPublishedTalksSnapshot`) which reaches `astro:content`.
 *
 * `astro:content` is imported dynamically so importing this module never
 * requires the Astro virtual-module graph; only the functions that actually
 * read the collection do.
 *
 * The gateway is read-only: it validates, normalizes, and projects. It never
 * writes, repairs, or rewrites an author-managed record or slide asset.
 */

import { validatePdfAsset, type SlideAssetValidationOptions } from "./asset";
import { deriveTalkIdentity, type TalkIdentity } from "./identity";
import {
  isPublishedTalk,
  TalkValidationError,
  type PublishedTalk,
  type ValidatedTalk,
  type ValidationIssue,
} from "./model";
import { normalizeTalkCandidate, validateSlidePath } from "./validation";

/** Build-time overrides, currently limited to the slide-directory root. */
export type TalksGatewayOptions = SlideAssetValidationOptions;

/**
 * One raw collection record. Structural rather than Astro-typed so the
 * validation pipeline can be driven from fixtures as well as from
 * `getCollection("talks")`.
 */
export type TalkSourceRecord = Readonly<{
  id: string;
  data: unknown;
}>;

/** Criterion reported when the collection itself is inconsistent. */
const CRITERION_RECORD_INTEGRITY = "2.9" as const;

/** Compares strings by code unit so ordering never depends on a locale. */
function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Reads the raw `slides` value of a candidate record, if it is text. */
function readSlidesValue(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;

  const slides: unknown = Reflect.get(data, "slides");
  return typeof slides === "string" ? slides : null;
}

/**
 * Defensive integrity check. Astro derives collection IDs from file paths and
 * therefore normally guarantees uniqueness, but the published projection must
 * emit every ID exactly once, so a collision is reported rather than silently
 * collapsing or duplicating a talk.
 */
function duplicateIdIssues(
  records: readonly TalkSourceRecord[],
): ValidationIssue[] {
  const counts = new Map<string, number>();

  for (const record of records) {
    counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  }

  const issues: ValidationIssue[] = [];

  for (const [id, count] of counts) {
    if (count < 2) continue;

    issues.push(
      Object.freeze({
        recordId: id,
        field: "record" as const,
        criterion: CRITERION_RECORD_INTEGRITY,
        message: `talk record id "${id}" is used by ${count} records; each talk must have exactly one record`,
      }),
    );
  }

  return issues;
}

type TalkSource = "api" | "git";

type IdentifiedTalk = Readonly<{
  talk: ValidatedTalk;
  identity: TalkIdentity;
  source: TalkSource;
}>;

type ConflictKind = "identity" | "slide";

/** Classifies records by the code-owned collection ID namespace. */
function talkSource(id: string): TalkSource {
  return id.startsWith("api/") ? "api" : "git";
}

function sourceDescription(record: IdentifiedTalk): string {
  const label =
    record.source === "api" ? "API-authored" : "repository-authored";
  return `${label} record "${record.talk.id}"`;
}

function conflictRemediation(records: readonly IdentifiedTalk[]): string {
  const apiRecordIds = records
    .filter((record) => record.source === "api")
    .map((record) => record.talk.id);
  const hasGitRecord = records.some((record) => record.source === "git");

  if (hasGitRecord && apiRecordIds.length > 0) {
    const apiRecords = apiRecordIds
      .map((recordId) => `"${recordId}"`)
      .join(", ");
    const noun = apiRecordIds.length === 1 ? "record" : "records";
    return `repository-authored records are authoritative; remove API-authored ${noun} ${apiRecords}`;
  }

  if (hasGitRecord) {
    return "resolve the repository-authored records so only one remains";
  }

  return "resolve the API-authored records so only one remains";
}

/**
 * Detects every canonical-identity and slide-path collision among records that
 * passed metadata and asset validation. Drafts intentionally participate: they
 * are part of the validated snapshot even though publication later projects
 * them out.
 */
function conflictIssues(records: readonly IdentifiedTalk[]): ValidationIssue[] {
  const identityGroups = new Map<string, IdentifiedTalk[]>();
  const slideGroups = new Map<string, IdentifiedTalk[]>();

  for (const record of records) {
    const identityGroup = identityGroups.get(record.identity) ?? [];
    identityGroup.push(record);
    identityGroups.set(record.identity, identityGroup);

    const slideGroup = slideGroups.get(record.talk.slidePath) ?? [];
    slideGroup.push(record);
    slideGroups.set(record.talk.slidePath, slideGroup);
  }

  const issues: ValidationIssue[] = [];

  function addGroupIssues(
    groups: ReadonlyMap<string, readonly IdentifiedTalk[]>,
    kind: ConflictKind,
  ): void {
    for (const [value, group] of groups) {
      if (group.length < 2) continue;

      const participants = [...group].sort((left, right) =>
        compareIds(left.talk.id, right.talk.id),
      );
      const subject = kind === "identity" ? "talk identity" : "slide path";
      const sources = participants.map(sourceDescription).join(", ");

      issues.push(
        Object.freeze({
          recordId: participants[0].talk.id,
          field:
            kind === "identity" ? ("record" as const) : ("slides" as const),
          criterion: "7.4" as const,
          message: `${subject} "${value}" is shared by ${sources}; ${conflictRemediation(participants)}`,
        }),
      );
    }
  }

  addGroupIssues(identityGroups, "identity");
  addGroupIssues(slideGroups, "slide");

  return issues;
}

type RecordValidationResult = Readonly<{
  talk: ValidatedTalk | null;
  issues: readonly ValidationIssue[];
}>;

/**
 * Validates one record's metadata and its slide asset, collecting the issues of
 * both so a single build reports every invalid field.
 *
 * The PDF is validated whenever the raw `slides` value is already a safe
 * root-relative path, even if another field failed. When the path itself is
 * unsafe, metadata validation has already reported that association issue and
 * the asset validator is not invoked, so the Author sees one diagnostic instead
 * of two for the same field.
 */
async function validateRecord(
  record: TalkSourceRecord,
  options: TalksGatewayOptions,
): Promise<RecordValidationResult> {
  const normalized = normalizeTalkCandidate(record.data, record.id);

  const rawSlides = readSlidesValue(record.data);
  const hasSafeSlidePath =
    rawSlides !== null && validateSlidePath(rawSlides) !== null;

  const asset =
    rawSlides !== null && hasSafeSlidePath
      ? await validatePdfAsset(rawSlides, record.id, options)
      : null;

  const issues: ValidationIssue[] = [
    ...(normalized.ok ? [] : normalized.issues),
    ...(asset !== null && !asset.ok ? asset.issues : []),
  ];

  if (!normalized.ok || asset === null || !asset.ok) {
    return Object.freeze({ talk: null, issues: Object.freeze(issues) });
  }

  // Public and embed values are already derived from validated data during
  // normalization; the gateway only adds the repository file path proven by
  // asset validation.
  const talk: ValidatedTalk = Object.freeze({
    ...normalized.talk,
    slideFilePath: asset.asset.slideFilePath,
  });

  return Object.freeze({ talk, issues: Object.freeze(issues) });
}

/**
 * Validates every supplied record and returns the validated talks, drafts
 * included, ordered by record ID.
 *
 * Metadata and PDF issues are aggregated across all records and reported once
 * through `TalkValidationError`, whose message is deterministically ordered by
 * record, field, criterion, and message. No talk-derived output is produced
 * from a collection that contains a single invalid record.
 */
export async function resolveValidatedTalks(
  records: readonly TalkSourceRecord[],
  options: TalksGatewayOptions = {},
): Promise<readonly ValidatedTalk[]> {
  const results = await Promise.all(
    records.map((record) => validateRecord(record, options)),
  );

  const issues: ValidationIssue[] = [...duplicateIdIssues(records)];
  const identifiedTalks: IdentifiedTalk[] = [];

  for (const result of results) {
    issues.push(...result.issues);
    if (result.talk === null) continue;

    identifiedTalks.push(
      Object.freeze({
        talk: result.talk,
        identity: deriveTalkIdentity(result.talk.date, result.talk.title),
        source: talkSource(result.talk.id),
      }),
    );
  }

  issues.push(...conflictIssues(identifiedTalks));

  if (issues.length > 0) throw new TalkValidationError(issues);

  const talks = identifiedTalks.map((record) => record.talk);
  talks.sort((left, right) => compareIds(left.id, right.id));

  return Object.freeze(talks);
}

/**
 * Orders published talks newest first.
 *
 * Requirements permit any order among talks sharing a date, so the record ID is
 * used as a tie-breaker purely to make generation reproducible. The input array
 * is never mutated.
 */
export function sortPublishedTalks(
  talks: readonly PublishedTalk[],
): PublishedTalk[] {
  return [...talks].sort((left, right) => {
    const byDate = right.sortEpochMs - left.sortEpochMs;
    if (byDate !== 0) return byDate;

    return compareIds(left.id, right.id);
  });
}

/**
 * Projects validated talks to the published snapshot: drafts excluded, every
 * remaining record present exactly once, newest first, and frozen so consumers
 * share one immutable value.
 */
export function selectPublishedTalks(
  talks: readonly ValidatedTalk[],
): readonly PublishedTalk[] {
  const published = talks.filter(isPublishedTalk);
  return Object.freeze(sortPublishedTalks(published));
}

/** Reads the raw `talks` collection. The only such read in the codebase. */
async function readTalkCollection(): Promise<readonly TalkSourceRecord[]> {
  const { getCollection } = await import("astro:content");
  const entries = await getCollection("talks");

  return entries.map((entry) =>
    Object.freeze({ id: entry.id, data: entry.data }),
  );
}

/**
 * Every valid talk record, drafts included, after metadata and PDF validation.
 * Throws `TalkValidationError` when any record is invalid.
 */
export async function getValidatedTalks(
  options: TalksGatewayOptions = {},
): Promise<readonly ValidatedTalk[]> {
  return resolveValidatedTalks(await readTalkCollection(), options);
}

/**
 * The published talk snapshot: no drafts, newest first, immutable.
 *
 * Prefer `getPublishedTalksSnapshot()` from generation code so every output
 * shares one resolution of the same validated records.
 */
export async function getPublishedTalks(
  options: TalksGatewayOptions = {},
): Promise<readonly PublishedTalk[]> {
  return selectPublishedTalks(await getValidatedTalks(options));
}

let publishedSnapshot: Promise<readonly PublishedTalk[]> | null = null;

/**
 * One shared published snapshot for the whole generation pass.
 *
 * The HTML archive, the Markdown alternate, the sitemap, and the LLM discovery
 * indexes await this promise instead of rereading raw records, which is what
 * guarantees the human-readable and machine-readable outputs are derived from
 * the same validated version of every record.
 *
 * A failed resolution is not cached, so a retry revalidates rather than
 * replaying a stale error.
 */
export function getPublishedTalksSnapshot(): Promise<readonly PublishedTalk[]> {
  if (publishedSnapshot === null) {
    publishedSnapshot = getPublishedTalks().catch((error: unknown) => {
      publishedSnapshot = null;
      throw error;
    });
  }

  return publishedSnapshot;
}

/** Discards the shared snapshot. Intended for verification and fixtures. */
export function resetPublishedTalksSnapshot(): void {
  publishedSnapshot = null;
}
