/**
 * Pure filter controller for the progressive talks archive enhancement.
 *
 * Feature: talks-section
 *
 * The DOM enhancement in `TalkFilter.astro` owns no filtering logic of its own:
 * it reads the rendered options and entries, hands them to this module, and
 * applies the returned state. Every transition is therefore a plain value
 * computation that can be exercised without a browser.
 *
 * Three properties are structural here rather than incidental to the DOM code:
 *
 * 1. Selection is one-hot by construction. State is derived from a single
 *    selected option identifier, so exactly one option is ever reported as
 *    selected, and it is always the most recently selected option.
 * 2. Author text never becomes a matching key. Entries are matched on the
 *    code-owned event-type identifiers (`event-type-0`, …) that the projection
 *    generates, and author labels are carried only as display copy for the
 *    result and no-match messages.
 * 3. Nothing is persisted. A transition returns a new immutable value and reads
 *    or writes no URL, cookie, storage entry, analytics event, or network
 *    resource. Message copy and state naming are reused from the shared
 *    `filter-state` module that the server projection also uses, so the client
 *    enhancement cannot drift from the static rendering.
 *
 * This module is shipped to the browser, so it may only import browser-safe
 * code: `filter-state` for the shared identifiers and copy, and types only from
 * the domain model. It must not reach the archive projection, validation, or the
 * site configuration, all of which are build-time code that reads the
 * filesystem.
 */

import {
  ALL_TALKS_FILTER_ID,
  TALKS_EMPTY_MESSAGE,
  formatNoMatchMessage,
  formatResultMessage,
  type TalkFilterSelection,
  type TalkFilterState,
} from "./filter-state";
import type { TalkFilterOption } from "./model";

/** One selectable option as rendered by the filter. */
export type FilterControllerOption = Readonly<{
  id: string;
  label: string;
}>;

/**
 * One rendered talk entry. `eventTypeIds` holds the generated identifiers of the
 * event types assigned to the entry, and `topicTagIds` the generated
 * identifiers of the topical tags assigned to the entry. Both are code-owned
 * identifiers, never author labels, and the two lists occupy separate
 * namespaces so a selection on one axis never matches on the other.
 */
export type FilterControllerEntry = Readonly<{
  id: string;
  eventTypeIds: readonly string[];
  topicTagIds: readonly string[];
}>;

/** Selected state of one option. */
export type FilterControllerOptionState = Readonly<{
  id: string;
  label: string;
  selected: boolean;
}>;

/** The immutable option/entry set one controller operates on. */
export type TalkFilterController = Readonly<{
  options: readonly FilterControllerOption[];
  entries: readonly FilterControllerEntry[];
}>;

/**
 * Everything a transition changes: the one-hot option states, which entries are
 * presented, the visible result and no-match copy, and the politely announced
 * message.
 *
 * `statusMessage` is empty for the initial state so nothing is announced before
 * a visitor changes the selection. `noMatchMessage` is non-null only in the
 * zero-match state, which is what lets the two visible message regions
 * alternate rather than both describe the same outcome.
 */
export type FilterControllerState = Readonly<{
  selectedOptionId: string;
  state: TalkFilterState;
  options: readonly FilterControllerOptionState[];
  visibleEntryIds: readonly string[];
  hiddenEntryIds: readonly string[];
  matchCount: number;
  totalCount: number;
  resultMessage: string;
  noMatchMessage: string | null;
  statusMessage: string;
}>;

/**
 * Adapts one option to the selection shape the projection's message formatters
 * expect.
 *
 * Event-type comparison keys are derived from author text and are deliberately
 * never emitted to the DOM, so the generated option identifier is the
 * client-side comparison key. The formatters only distinguish the "All talks"
 * selection (`comparisonKey === null`) from a specific event type, so the two
 * representations produce identical copy.
 */
function toSelection(option: FilterControllerOption): TalkFilterSelection {
  if (option.id === ALL_TALKS_FILTER_ID) {
    return {
      id: ALL_TALKS_FILTER_ID,
      label: option.label,
      comparisonKey: null,
    };
  }

  const eventTypeSelection: TalkFilterOption = {
    id: option.id,
    label: option.label,
    comparisonKey: option.id,
  };

  return eventTypeSelection;
}

/**
 * Builds the controller for one rendered filter and archive.
 *
 * Invalid input is rejected instead of being silently tolerated: an "All talks"
 * option must exist, and identifiers must be unique for one-hot selection and
 * entry toggling to be well defined. The DOM enhancement installs listeners and
 * reveals the filter only after this succeeds, so a malformed archive degrades
 * to the complete static listing rather than to inert or incorrect controls.
 */
export function createFilterController(
  options: readonly FilterControllerOption[],
  entries: readonly FilterControllerEntry[],
): TalkFilterController {
  const optionIds = new Set<string>();

  for (const option of options) {
    if (option.id === "")
      throw new Error("Filter option ids must be non-empty");
    if (optionIds.has(option.id)) {
      throw new Error(`Duplicate filter option id: ${option.id}`);
    }
    optionIds.add(option.id);
  }

  if (!optionIds.has(ALL_TALKS_FILTER_ID)) {
    throw new Error(
      `Filter options must include the "${ALL_TALKS_FILTER_ID}" option`,
    );
  }

  const entryIds = new Set<string>();

  for (const entry of entries) {
    if (entry.id === "") throw new Error("Talk entry ids must be non-empty");
    if (entryIds.has(entry.id)) {
      throw new Error(`Duplicate talk entry id: ${entry.id}`);
    }
    entryIds.add(entry.id);
  }

  return Object.freeze({
    options: Object.freeze(
      options.map((option) =>
        Object.freeze({ id: option.id, label: option.label }),
      ),
    ),
    entries: Object.freeze(
      entries.map((entry) =>
        Object.freeze({
          id: entry.id,
          eventTypeIds: Object.freeze([...entry.eventTypeIds]),
          topicTagIds: Object.freeze([...entry.topicTagIds]),
        }),
      ),
    ),
  });
}

/**
 * True when the entry is assigned the generated identifier `optionId`, on
 * whichever axis that identifier belongs to. Identifiers are namespaced
 * (`event-type-N` versus `topic-tag-N`), so a selection matches only against
 * the axis it names and the two filter dimensions never conflate.
 */
function entryMatches(entry: FilterControllerEntry, optionId: string): boolean {
  return (
    entry.eventTypeIds.includes(optionId) ||
    entry.topicTagIds.includes(optionId)
  );
}

/**
 * Derives the complete state for one selected option.
 *
 * Matching mirrors `filterTalks`: the "All talks" option is the identity
 * projection over the rendered order, and any other option presents exactly the
 * entries assigned that event type. The zero-match state is kept for defensive
 * DOM or data changes, so a filter that stops matching announces an explicit
 * message instead of leaving an apparently empty archive.
 */
function deriveState(
  controller: TalkFilterController,
  option: FilterControllerOption,
  announce: boolean,
): FilterControllerState {
  const isAll = option.id === ALL_TALKS_FILTER_ID;
  const visibleEntryIds: string[] = [];
  const hiddenEntryIds: string[] = [];

  for (const entry of controller.entries) {
    if (isAll || entryMatches(entry, option.id)) visibleEntryIds.push(entry.id);
    else hiddenEntryIds.push(entry.id);
  }

  const totalCount = controller.entries.length;
  const matchCount = visibleEntryIds.length;

  const state: TalkFilterState =
    totalCount === 0
      ? "empty"
      : matchCount === 0
        ? "no-matches"
        : isAll
          ? "all"
          : "filtered";

  const resultMessage =
    state === "empty"
      ? TALKS_EMPTY_MESSAGE
      : formatResultMessage(toSelection(option), matchCount, totalCount);

  const noMatchMessage =
    state === "no-matches" ? formatNoMatchMessage(option.label) : null;

  return Object.freeze({
    selectedOptionId: option.id,
    state,
    options: Object.freeze(
      controller.options.map((candidate) =>
        Object.freeze({
          id: candidate.id,
          label: candidate.label,
          selected: candidate.id === option.id,
        }),
      ),
    ),
    visibleEntryIds: Object.freeze(visibleEntryIds),
    hiddenEntryIds: Object.freeze(hiddenEntryIds),
    matchCount,
    totalCount,
    resultMessage,
    noMatchMessage,
    statusMessage: announce ? (noMatchMessage ?? resultMessage) : "",
  });
}

function findOption(
  controller: TalkFilterController,
  optionId: string,
): FilterControllerOption | null {
  return controller.options.find((option) => option.id === optionId) ?? null;
}

/**
 * The state the archive loads with: the "All talks" option selected, every
 * entry presented, result copy that already matches the static rendering, and
 * an empty status region so nothing is announced before a visitor acts.
 */
export function initialFilterState(
  controller: TalkFilterController,
): FilterControllerState {
  const option = findOption(controller, ALL_TALKS_FILTER_ID);
  if (option === null) {
    throw new Error(
      `Filter options must include the "${ALL_TALKS_FILTER_ID}" option`,
    );
  }

  return deriveState(controller, option, false);
}

/**
 * Applies one selection.
 *
 * An unrecognized identifier leaves the current state untouched, so a stray
 * activation can never clear the one-hot selection. Any recognized identifier,
 * including the already selected one, produces a fully derived state and an
 * announcement.
 */
export function selectFilterOption(
  controller: TalkFilterController,
  current: FilterControllerState,
  optionId: string,
): FilterControllerState {
  const option = findOption(controller, optionId);
  if (option === null) return current;

  return deriveState(controller, option, true);
}
