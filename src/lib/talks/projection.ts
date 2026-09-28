/**
 * Pure talks archive, filter, and date projections.
 *
 * Feature: talks-section
 *
 * Every function in this module is deterministic and side-effect free: it reads
 * no files, makes no network request, touches no URL, cookie, storage, or
 * analytics state, and never mutates its inputs. Publication and ordering are
 * owned by the gateway (`selectPublishedTalks`/`sortPublishedTalks`); this
 * module only projects an already-resolved published snapshot into the values
 * the archive, the filter, and the status regions render.
 *
 * Two rules shape the exported shapes:
 *
 * 1. Event-type identifiers are code-owned (`event-type-0`, `event-type-1`, …)
 *    so author text never reaches a CSS selector, a DOM query, or executable
 *    source. Author labels remain display text only.
 * 2. The defensive zero-match state is a pure derived value. Filtering never
 *    persists a selection anywhere, so no query string, cookie, storage entry,
 *    analytics event, or network request can be introduced by a filter change.
 *
 * The option identifiers, state names, and message copy shared with the client
 * enhancement live in `filter-state.ts` and are re-exported here, so the archive
 * keeps one import surface while the browser bundle stays clear of this module's
 * build-time dependencies (validation, and through it the site configuration,
 * which reads the filesystem).
 */

import {
  allTalksFilterOption,
  eventTypeOptionId,
  formatNoMatchMessage,
  formatResultMessage,
  TALKS_EMPTY_MESSAGE,
  type TalkAllFilterOption,
  type TalkFilterSelection,
  type TalkFilterState,
} from "./filter-state";
import type {
  HttpsUrl,
  GitHubUrl,
  IsoDate,
  NormalizedEventType,
  NormalizedVideo,
  PublishedTalk,
  SlidePath,
  TalkFilterOption,
} from "./model";
import { parseIsoDateParts } from "./validation";

export {
  ALL_TALKS_FILTER_ID,
  ALL_TALKS_FILTER_LABEL,
  allTalksFilterOption,
  EVENT_TYPE_ID_PREFIX,
  eventTypeOptionId,
  formatNoMatchMessage,
  formatResultMessage,
  TALKS_EMPTY_MESSAGE,
  type TalkAllFilterOption,
  type TalkFilterSelection,
  type TalkFilterState,
} from "./filter-state";

/**
 * English month names. The table is code-owned rather than resolved through
 * `Intl` so the formatted date cannot vary with an ICU build, an environment
 * locale, or a host time zone.
 */
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** One event-type tag as rendered inside a single talk entry. */
export type TalkTagView = Readonly<{
  id: string;
  label: string;
  comparisonKey: string;
}>;

/**
 * Public projection of one published talk. Repository-internal values such as
 * the resolved slide file path are intentionally absent so no build-only path
 * can reach a public representation.
 */
export type TalkCardView = Readonly<{
  id: string;
  title: string;
  eventName: string;
  eventUrl: HttpsUrl;
  date: IsoDate;
  displayDate: string;
  location: string;
  tags: readonly TalkTagView[];
  eventTypeIds: readonly string[];
  slidePath: SlidePath;
  slidePublicUrl: HttpsUrl;
  video: NormalizedVideo | null;
  sourceCodeUrl: GitHubUrl | null;
}>;

/** Everything the archive and its filter need from one published snapshot. */
export type TalkArchiveView = Readonly<{
  cards: readonly TalkCardView[];
  allTalksOption: TalkAllFilterOption;
  filterOptions: readonly TalkFilterOption[];
  isEmpty: boolean;
  emptyMessage: string;
}>;

/** Derived, non-persisted result of applying one filter selection. */
export type TalkFilterResult = Readonly<{
  state: TalkFilterState;
  selection: TalkFilterSelection;
  talks: readonly PublishedTalk[];
  matchCount: number;
  totalCount: number;
  message: string;
}>;

/**
 * Formats a validated talk date as the English full month name, the calendar
 * day without a forced leading zero, and a four-digit year.
 */
export function formatTalkDate(date: IsoDate): string {
  const parts = parseIsoDateParts(date);
  if (parts === null) {
    throw new Error(`Cannot format an invalid ISO date: ${date}`);
  }

  const month = MONTH_NAMES[parts.month - 1];
  if (month === undefined) {
    throw new Error(`Cannot format an out-of-range month: ${date}`);
  }

  return `${month} ${parts.day}, ${String(parts.year).padStart(4, "0")}`;
}

/**
 * Derives one stable filter option per distinct event-type comparison key that
 * is assigned to at least one published talk, and no other option.
 *
 * Options keep first-appearance order in the published sequence so identifiers
 * stay stable for a given snapshot, and each display label is the label the
 * Author used on the first talk carrying that key.
 */
export function deriveFilterOptions(
  talks: readonly PublishedTalk[],
): TalkFilterOption[] {
  const options: TalkFilterOption[] = [];
  const seen = new Set<string>();

  for (const talk of talks) {
    for (const eventType of talk.eventTypes) {
      if (seen.has(eventType.comparisonKey)) continue;

      seen.add(eventType.comparisonKey);
      options.push(
        Object.freeze({
          id: eventTypeOptionId(options.length),
          label: eventType.label,
          comparisonKey: eventType.comparisonKey,
        }),
      );
    }
  }

  return options;
}

/** Indexes derived options by comparison key for card projection. */
function indexOptionIds(
  options: readonly TalkFilterOption[],
): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();

  for (const option of options) {
    if (!ids.has(option.comparisonKey))
      ids.set(option.comparisonKey, option.id);
  }

  return ids;
}

function projectTag(
  eventType: NormalizedEventType,
  optionIds: ReadonlyMap<string, string>,
): TalkTagView {
  const id = optionIds.get(eventType.comparisonKey);
  if (id === undefined) {
    throw new Error(
      `Event type "${eventType.label}" has no derived filter option; project cards from the same published snapshot used to derive options`,
    );
  }

  return Object.freeze({
    id,
    label: eventType.label,
    comparisonKey: eventType.comparisonKey,
  });
}

/**
 * Projects one published talk to its card view.
 *
 * The tag projection is lossless: it contains exactly the event-type labels
 * assigned to this talk, each exactly once, in source order, and no label from
 * another talk.
 */
export function projectTalkCard(
  talk: PublishedTalk,
  optionIds: ReadonlyMap<string, string>,
): TalkCardView {
  const tags = talk.eventTypes.map((eventType) =>
    projectTag(eventType, optionIds),
  );

  return Object.freeze({
    id: talk.id,
    title: talk.title,
    eventName: talk.eventName,
    eventUrl: talk.eventUrl,
    date: talk.date,
    displayDate: formatTalkDate(talk.date),
    location: talk.location,
    tags: Object.freeze(tags),
    eventTypeIds: Object.freeze(tags.map((tag) => tag.id)),
    slidePath: talk.slidePath,
    slidePublicUrl: talk.slidePublicUrl,
    video: talk.video,
    sourceCodeUrl: talk.sourceCodeUrl,
  });
}

/**
 * Projects the published snapshot into the archive view: one card per published
 * talk in the snapshot's order, the "All talks" option, the distinct event-type
 * options, and the empty-archive state.
 */
export function projectTalkArchive(
  talks: readonly PublishedTalk[],
): TalkArchiveView {
  const filterOptions = deriveFilterOptions(talks);
  const optionIds = indexOptionIds(filterOptions);

  return Object.freeze({
    cards: Object.freeze(talks.map((talk) => projectTalkCard(talk, optionIds))),
    allTalksOption: allTalksFilterOption,
    filterOptions: Object.freeze(filterOptions),
    isEmpty: talks.length === 0,
    emptyMessage: TALKS_EMPTY_MESSAGE,
  });
}

/** True when the talk is assigned the given event-type comparison key. */
export function talkMatchesEventType(
  talk: PublishedTalk,
  comparisonKey: string,
): boolean {
  return talk.eventTypes.some(
    (eventType) => eventType.comparisonKey === comparisonKey,
  );
}

/**
 * Returns every published talk assigned `selectedComparisonKey` exactly once and
 * no other talk. A `null` key is the "All talks" selection and is the identity
 * projection: the original sequence, in order, with nothing added or removed.
 */
export function filterTalks(
  talks: readonly PublishedTalk[],
  selectedComparisonKey: string | null,
): PublishedTalk[] {
  if (selectedComparisonKey === null) return [...talks];

  return talks.filter((talk) =>
    talkMatchesEventType(talk, selectedComparisonKey),
  );
}

/**
 * Applies one selection and describes the resulting state, including the
 * defensive zero-match case.
 *
 * Filter options are derived from published talks, so a selected option
 * normally has at least one match. The zero-match state is still represented so
 * a later DOM or data change degrades into an explicit, announced message
 * rather than an archive that silently appears empty. The result is a plain
 * derived value: nothing here reads or writes a URL, cookie, storage entry,
 * analytics event, or network resource.
 */
export function describeFilterResult(
  talks: readonly PublishedTalk[],
  selection: TalkFilterSelection,
): TalkFilterResult {
  const matches = filterTalks(talks, selection.comparisonKey);

  const state: TalkFilterState =
    talks.length === 0
      ? "empty"
      : matches.length === 0
        ? "no-matches"
        : selection.comparisonKey === null
          ? "all"
          : "filtered";

  const message =
    state === "empty"
      ? TALKS_EMPTY_MESSAGE
      : state === "no-matches"
        ? formatNoMatchMessage(selection.label)
        : formatResultMessage(selection, matches.length, talks.length);

  return Object.freeze({
    state,
    selection,
    talks: Object.freeze(matches),
    matchCount: matches.length,
    totalCount: talks.length,
    message,
  });
}
