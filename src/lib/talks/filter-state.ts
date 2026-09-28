/**
 * Browser-safe filter identifiers, state naming, and message copy.
 *
 * Feature: talks-section
 *
 * This module is the one piece of talks logic that is shipped to the browser, so
 * it is deliberately the narrowest possible surface: code-owned option
 * identifiers, the filter state names, the selection shape the message
 * formatters read, and the copy itself. Everything here is a plain value
 * computation over its arguments.
 *
 * It must stay free of Node-only and environment-derived code. The server
 * projection (`projection.ts`) reaches validation and the site configuration,
 * which read the filesystem at build time; importing any of that from the client
 * enhancement externalizes `node:fs`/`node:path` in the dev server and breaks
 * filtering. Site-origin and URL derivation therefore stay out of this module,
 * and both the server projection and the client controller import the shared
 * pieces from here so the two cannot drift apart.
 */

import type { TalkFilterOption } from "./model";

/** Stable identifier of the "All talks" option. */
export const ALL_TALKS_FILTER_ID = "all-talks";

/** Visible and accessible label of the "All talks" option. */
export const ALL_TALKS_FILTER_LABEL = "All talks";

/** Prefix of every generated event-type identifier. */
export const EVENT_TYPE_ID_PREFIX = "event-type-";

/** Prefix of every generated topical-tag identifier. */
export const TOPIC_TAG_ID_PREFIX = "topic-tag-";

/** Copy shown when the published collection contains no talks. */
export const TALKS_EMPTY_MESSAGE = "No talks are currently published.";

/**
 * The "All talks" option. Its `comparisonKey` is `null`, which is the value that
 * makes filtering the identity projection.
 */
export type TalkAllFilterOption = Readonly<{
  id: typeof ALL_TALKS_FILTER_ID;
  label: string;
  comparisonKey: null;
}>;

/** Either the "All talks" option or one derived event-type option. */
export type TalkFilterSelection = TalkAllFilterOption | TalkFilterOption;

/** Filter outcome for one selection. */
export type TalkFilterState = "empty" | "all" | "filtered" | "no-matches";

/** The single "All talks" option value. */
export const allTalksFilterOption: TalkAllFilterOption = Object.freeze({
  id: ALL_TALKS_FILTER_ID,
  label: ALL_TALKS_FILTER_LABEL,
  comparisonKey: null,
});

/** Builds the generated identifier for the event-type option at `index`. */
export function eventTypeOptionId(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(
      `Event-type option index must be a non-negative integer: ${String(index)}`,
    );
  }

  return `${EVENT_TYPE_ID_PREFIX}${index}`;
}

/** Builds the generated identifier for the topical-tag option at `index`. */
export function topicTagOptionId(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(
      `Topical-tag option index must be a non-negative integer: ${String(index)}`,
    );
  }

  return `${TOPIC_TAG_ID_PREFIX}${index}`;
}

/** Copy naming the selected event type that produced no matches. */
export function formatNoMatchMessage(label: string): string {
  return `No matching talks are available for "${label}".`;
}

/** Copy reporting how many talks the current selection presents. */
export function formatResultMessage(
  selection: TalkFilterSelection,
  matchCount: number,
  totalCount: number,
): string {
  const noun = totalCount === 1 ? "talk" : "talks";

  if (selection.comparisonKey === null) {
    return `Showing all ${totalCount} ${noun}.`;
  }

  return `Showing ${matchCount} of ${totalCount} ${noun} for "${selection.label}".`;
}
