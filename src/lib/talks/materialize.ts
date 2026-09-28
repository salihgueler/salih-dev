import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  parseApiTalkRecord,
  toTalkFrontmatterDocument,
  type ApiTalkRecord,
} from "./api-record.js";

/** One API-authored record and its approved deck ready for filesystem writes. */
export type MaterializedApiTalk = Readonly<{
  recordPath: string;
  document: string;
  /** File name relative to the publisher's approved-deck cache root. */
  deckSource: string;
  deckTarget: string;
}>;

/** An otherwise valid record excluded because its approved deck is unavailable. */
export type SkippedApiTalk = Readonly<{
  recordKey: string;
  reason: "deck_absent";
}>;

/** Complete, immutable plan for one clear-then-write materialization pass. */
export type MaterializationPlan = Readonly<{
  records: readonly MaterializedApiTalk[];
  skipped: readonly SkippedApiTalk[];
}>;

export type MaterializationRoots = Readonly<{
  recordRoot: string;
  slideRoot: string;
}>;

const API_RECORD_ROOT_SEGMENTS = ["src", "content", "talks", "api"] as const;
const API_SLIDE_ROOT_SEGMENTS = [
  "public",
  "talks",
  "slides",
  "api",
] as const;

function requireCodeOwnedRoot(
  root: string,
  expectedSegments: readonly string[],
  label: string,
): string {
  if (root.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }

  const resolvedRoot = resolve(root);
  const expectedSuffix = join(...expectedSegments);
  if (
    resolvedRoot !== expectedSuffix &&
    !resolvedRoot.endsWith(`${sep}${expectedSuffix}`)
  ) {
    throw new RangeError(
      `${label} must resolve to the code-owned ${expectedSegments.join("/")} directory`,
    );
  }

  return resolvedRoot;
}

function ownedChild(root: string, fileName: string, label: string): string {
  const target = resolve(root, fileName);
  const fromRoot = relative(root, target);
  if (
    fromRoot.length === 0 ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot) ||
    fromRoot.includes(sep)
  ) {
    throw new RangeError(`${label} escapes its code-owned root`);
  }

  return target;
}

/**
 * Produces a filesystem-independent plan for API-authored talk materialization.
 *
 * Inputs must be records returned by `parseApiTalkRecord`. The defensive parse
 * below preserves that boundary at runtime. Targets are direct children of the
 * reserved API namespaces, so they cannot replace repository-authored records
 * or Git-tracked slide files. Approved decks without a referencing record are
 * ignored, while records whose approved deck is absent are reported as skipped.
 */
export function planMaterialization(
  records: readonly ApiTalkRecord[],
  availableDeckIds: ReadonlySet<string>,
  roots: MaterializationRoots,
): MaterializationPlan {
  const recordRoot = requireCodeOwnedRoot(
    roots.recordRoot,
    API_RECORD_ROOT_SEGMENTS,
    "recordRoot",
  );
  const slideRoot = requireCodeOwnedRoot(
    roots.slideRoot,
    API_SLIDE_ROOT_SEGMENTS,
    "slideRoot",
  );

  const parsedRecords = records.map((record) => {
    const parsed = parseApiTalkRecord(record);
    if (parsed === null) {
      throw new TypeError("Materialization requires strictly parsed API records");
    }
    return parsed;
  });

  parsedRecords.sort((left, right) =>
    left.recordKey.localeCompare(right.recordKey, "en"),
  );

  const seenRecordKeys = new Set<string>();
  const selectedDeckIds = new Set<string>();
  const plannedRecords: MaterializedApiTalk[] = [];
  const skippedRecords: SkippedApiTalk[] = [];

  for (const record of parsedRecords) {
    if (seenRecordKeys.has(record.recordKey)) {
      throw new TypeError(`Duplicate API talk record key: ${record.recordKey}`);
    }
    seenRecordKeys.add(record.recordKey);

    if (!availableDeckIds.has(record.deckId)) {
      skippedRecords.push(
        Object.freeze({
          recordKey: record.recordKey,
          reason: "deck_absent" as const,
        }),
      );
      continue;
    }

    if (selectedDeckIds.has(record.deckId)) {
      throw new TypeError(
        `Approved deck is referenced by more than one API talk record: ${record.deckId}`,
      );
    }
    selectedDeckIds.add(record.deckId);

    const recordFileName = `${record.recordKey}.md`;
    const deckFileName = `${record.deckId}.pdf`;
    plannedRecords.push(
      Object.freeze({
        recordPath: ownedChild(recordRoot, recordFileName, "recordPath"),
        document: toTalkFrontmatterDocument(record),
        deckSource: deckFileName,
        deckTarget: ownedChild(slideRoot, deckFileName, "deckTarget"),
      }),
    );
  }

  return Object.freeze({
    records: Object.freeze(plannedRecords),
    skipped: Object.freeze(skippedRecords),
  });
}
