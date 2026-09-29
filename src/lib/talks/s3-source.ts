/**
 * Request-time talk source adapter.
 *
 * Feature: backend-served-content
 *
 * The publisher materializes the private content bucket into the source tree
 * and bakes the Talks archive. To serve the archive at request time instead,
 * the render function reads the same stored objects and feeds them to the same
 * validated read gateway, so the request-time output matches what the static
 * build would have produced.
 *
 * This module is the boundary that turns stored objects into the two inputs the
 * gateway already understands:
 *
 * 1. `apiTalkSourceRecords` maps each stored API talk record JSON to the
 *    `TalkSourceRecord` shape `resolveValidatedTalks` consumes, exactly as the
 *    Astro `talks` collection would after materialization. The collection id is
 *    `api/<recordKey>` and the record's canonical frontmatter is the record
 *    `data`, so the gateway derives the identical validated snapshot.
 * 2. `planDeckMaterialization` reuses the publisher's own materialization plan
 *    to place approved deck bytes under a render root's
 *    `public/talks/slides/api/` directory, so the gateway's slide-asset
 *    validation resolves and parses the same PDF it would at build time.
 *
 * Everything here is pure over injected buffers and listings: it reads no file,
 * makes no network request, and writes nothing. The render function supplies
 * the S3 bytes and performs the temp-directory writes, so this module stays
 * unit-testable with stubbed inputs and free of any Astro or AWS dependency.
 */

import { parseApiTalkRecord, type ApiTalkRecord } from "./api-record.js";
import { isDeckId } from "./deck.js";
import { planMaterialization, type MaterializationPlan } from "./materialize.js";
import type { TalkSourceRecord } from "./gateway.js";

/** Object key prefix under which approved API talk records are stored. */
export const API_RECORD_PREFIX = "talks/records/";
/** Suffix of a stored API talk record object. */
export const API_RECORD_SUFFIX = ".json";
/** Object key prefix under which approved API talk decks are stored. */
export const API_DECK_PREFIX = "talks/decks/";
/** Suffix of a stored approved deck object. */
export const API_DECK_SUFFIX = ".pdf";

/** One stored API talk record object: its key and its UTF-8 JSON body. */
export type StoredRecordObject = Readonly<{
  key: string;
  body: string;
}>;

/** The collection subdirectory API-authored records materialize into. */
const API_COLLECTION_PREFIX = "api/";

/**
 * Parses one stored record JSON and returns the record together with the
 * collection id the Astro glob loader would assign the materialized file.
 *
 * A key or body that does not parse to a self-consistent record is rejected by
 * returning `null`, so a single corrupt object cannot silently drop or corrupt
 * the published snapshot; the caller decides whether to fail closed.
 */
export function parseStoredRecord(
  object: StoredRecordObject,
): Readonly<{ id: string; record: ApiTalkRecord }> | null {
  if (
    !object.key.startsWith(API_RECORD_PREFIX) ||
    !object.key.endsWith(API_RECORD_SUFFIX)
  ) {
    return null;
  }

  const recordKey = object.key.slice(
    API_RECORD_PREFIX.length,
    -API_RECORD_SUFFIX.length,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(object.body);
  } catch {
    return null;
  }

  const record = parseApiTalkRecord(parsed);
  if (record === null || record.recordKey !== recordKey) return null;

  return Object.freeze({
    id: `${API_COLLECTION_PREFIX}${record.recordKey}`,
    record,
  });
}

/**
 * Maps stored API talk record objects to the `TalkSourceRecord[]` the gateway
 * consumes, in stable record-key order so the derived snapshot is reproducible.
 *
 * The record `data` is the record's canonical frontmatter, which is exactly the
 * value the Astro collection exposes after the publisher materializes the same
 * record to `src/content/talks/api/<recordKey>.md`. Records that do not parse
 * are dropped, and the dropped keys are returned so the caller can log or fail
 * closed rather than serve a partial archive silently.
 */
export function apiTalkSourceRecords(
  objects: readonly StoredRecordObject[],
): Readonly<{
  records: readonly TalkSourceRecord[];
  parsed: readonly ApiTalkRecord[];
  droppedKeys: readonly string[];
}> {
  const records: TalkSourceRecord[] = [];
  const parsed: ApiTalkRecord[] = [];
  const droppedKeys: string[] = [];

  for (const object of objects) {
    const result = parseStoredRecord(object);
    if (result === null) {
      droppedKeys.push(object.key);
      continue;
    }

    records.push(
      Object.freeze({ id: result.id, data: result.record.frontmatter }),
    );
    parsed.push(result.record);
  }

  const order = (left: TalkSourceRecord, right: TalkSourceRecord): number =>
    left.id === right.id ? 0 : left.id < right.id ? -1 : 1;

  return Object.freeze({
    records: Object.freeze([...records].sort(order)),
    parsed: Object.freeze(parsed),
    droppedKeys: Object.freeze(droppedKeys),
  });
}

/** Extracts the set of available deck ids from stored deck object keys. */
export function availableDeckIds(
  deckKeys: readonly string[],
): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const key of deckKeys) {
    if (!key.startsWith(API_DECK_PREFIX) || !key.endsWith(API_DECK_SUFFIX)) {
      continue;
    }

    const deckId = key.slice(
      API_DECK_PREFIX.length,
      -API_DECK_SUFFIX.length,
    );
    if (isDeckId(deckId)) ids.add(deckId);
  }

  return ids;
}

/** Roots a render pass writes its materialized decks and records under. */
export type RenderRoots = Readonly<{
  recordRoot: string;
  slideRoot: string;
}>;

/**
 * Builds the same clear-then-write plan the publisher uses, so the render
 * function can place approved deck bytes under its render root's
 * `public/talks/slides/api/` directory and let the shared gateway resolve and
 * parse them. Records whose approved deck is absent are reported as skipped,
 * exactly as at build time.
 */
export function planDeckMaterialization(
  records: readonly ApiTalkRecord[],
  deckIds: ReadonlySet<string>,
  roots: RenderRoots,
): MaterializationPlan {
  return planMaterialization(records, deckIds, roots);
}
