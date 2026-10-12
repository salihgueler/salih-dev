/**
 * Pure queries over the WebMCP site index.
 *
 * Feature: webmcp
 *
 * The browser tools call these functions with the fetched index and return
 * their results to the agent verbatim, so every rule an agent sees (matching,
 * ordering, limits, upcoming-vs-past) lives here and is unit-tested in Node.
 * Nothing in this module touches the DOM, the network, or the clock: "today"
 * is always passed in.
 */

import type {
  IndexedEvent,
  IndexedPost,
  IndexedTalk,
  SiteIndex,
} from "./site-index";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export type ContentType = "post" | "talk" | "event";

export type SearchHit = Readonly<{
  type: ContentType;
  title: string;
  url: string;
  date: string;
  snippet: string;
}>;

export type EventTiming = "upcoming" | "past";

export type EventResult = IndexedEvent & Readonly<{ timing: EventTiming }>;

/** Lowercases, strips diacritics, and collapses punctuation to single spaces. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Clamps a caller-supplied limit to 1..MAX_LIMIT, defaulting when absent. */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function terms(query: string | undefined): string[] {
  if (query === undefined) return [];
  return normalize(query).split(" ").filter((term) => term.length > 0);
}

type WeightedField = readonly [text: string, weight: number];

/**
 * Scores one record. Every query term must appear in at least one field (AND
 * semantics), otherwise the score is 0. A term found in a heavier field (the
 * title) counts more than one found in the body text.
 */
function score(queryTerms: readonly string[], fields: readonly WeightedField[]): number {
  if (queryTerms.length === 0) return 1;

  const normalized = fields.map(([text, weight]) => [` ${normalize(text)} `, weight] as const);
  let total = 0;

  for (const term of queryTerms) {
    let best = 0;
    for (const [text, weight] of normalized) {
      if (text.includes(` ${term} `)) best = Math.max(best, weight * 2);
      else if (text.includes(term)) best = Math.max(best, weight);
    }
    if (best === 0) return 0;
    total += best;
  }

  return total;
}

function sameLabel(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function postFields(post: IndexedPost): WeightedField[] {
  return [
    [post.title, 5],
    [post.tags.join(" "), 4],
    [post.category, 3],
    [post.description, 2],
    [post.summary, 1],
  ];
}

function talkFields(talk: IndexedTalk): WeightedField[] {
  return [
    [talk.title, 5],
    [talk.topics.join(" "), 4],
    [talk.eventName, 3],
    [talk.eventTypes.join(" "), 2],
    [talk.location, 1],
  ];
}

function eventFields(event: IndexedEvent): WeightedField[] {
  return [
    [event.name, 5],
    [`${event.city} ${event.country}`, 3],
    [event.role ?? "", 1],
  ];
}

/** Ranks records by score (descending), keeping input order for ties. */
function rank<T>(records: readonly T[], scoreOf: (record: T) => number): T[] {
  return records
    .map((record, index) => ({ record, index, value: scoreOf(record) }))
    .filter(({ value }) => value > 0)
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .map(({ record }) => record);
}

/**
 * Classifies an event against `today` (UTC `YYYY-MM-DD`), with the same rule
 * the home page uses: an explicit status wins, otherwise an event is past once
 * its last day is before today.
 */
export function eventTiming(event: IndexedEvent, today: string): EventTiming {
  if (event.status !== null) return event.status;
  return event.endsOn < today ? "past" : "upcoming";
}

export type SearchOptions = Readonly<{
  query: string;
  types?: readonly ContentType[] | undefined;
  limit?: number | undefined;
}>;

/** Free-text search across posts, talks, and events. */
export function searchSite(index: SiteIndex, options: SearchOptions): SearchHit[] {
  const queryTerms = terms(options.query);
  if (queryTerms.length === 0) return [];

  const wanted = new Set<ContentType>(
    options.types && options.types.length > 0 ? options.types : ["post", "talk", "event"],
  );
  const hits: { hit: SearchHit; value: number; order: number }[] = [];
  let order = 0;

  if (wanted.has("post")) {
    for (const post of index.posts) {
      const value = score(queryTerms, postFields(post));
      if (value > 0) {
        hits.push({
          value,
          order: order++,
          hit: {
            type: "post",
            title: post.title,
            url: post.url,
            date: post.publishedOn,
            snippet: post.description,
          },
        });
      }
    }
  }

  if (wanted.has("talk")) {
    for (const talk of index.talks) {
      const value = score(queryTerms, talkFields(talk));
      if (value > 0) {
        hits.push({
          value,
          order: order++,
          hit: {
            type: "talk",
            title: talk.title,
            url: talk.slidesUrl,
            date: talk.date,
            snippet: `${talk.eventName}, ${talk.location}`,
          },
        });
      }
    }
  }

  if (wanted.has("event")) {
    for (const event of index.events) {
      const value = score(queryTerms, eventFields(event));
      if (value > 0) {
        hits.push({
          value,
          order: order++,
          hit: {
            type: "event",
            title: event.name,
            url: event.url,
            date: event.startsOn,
            snippet: `${event.city}, ${event.country}`,
          },
        });
      }
    }
  }

  return hits
    .sort((left, right) => right.value - left.value || left.order - right.order)
    .slice(0, clampLimit(options.limit))
    .map(({ hit }) => hit);
}

export type PostFilter = Readonly<{
  query?: string | undefined;
  category?: string | undefined;
  tag?: string | undefined;
  limit?: number | undefined;
}>;

/** Posts newest first, optionally narrowed by category, tag, and text. */
export function listPosts(index: SiteIndex, filter: PostFilter): IndexedPost[] {
  const { category, tag } = filter;
  const narrowed = index.posts.filter(
    (post) =>
      (category === undefined || sameLabel(post.category, category)) &&
      (tag === undefined || post.tags.some((value) => sameLabel(value, tag))),
  );
  const queryTerms = terms(filter.query);
  const ordered =
    queryTerms.length === 0 ? narrowed : rank(narrowed, (post) => score(queryTerms, postFields(post)));

  return ordered.slice(0, clampLimit(filter.limit));
}

/** One post by slug or by its canonical URL, or null. */
export function findPost(index: SiteIndex, slugOrUrl: string): IndexedPost | null {
  const slug = slugFrom(slugOrUrl);
  return index.posts.find((post) => post.slug === slug) ?? null;
}

function slugFrom(value: string): string {
  const trimmed = value.trim();
  const match = /\/blog\/([^/?#]+?)(?:\.md|\/)?(?:[?#].*)?$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

export type TalkFilter = Readonly<{
  query?: string | undefined;
  topic?: string | undefined;
  eventType?: string | undefined;
  year?: number | undefined;
  hasRecording?: boolean | undefined;
  limit?: number | undefined;
}>;

/** Talks newest first, optionally narrowed by topic, event type, year, and text. */
export function listTalks(index: SiteIndex, filter: TalkFilter): IndexedTalk[] {
  const { topic, eventType, year, hasRecording } = filter;
  const narrowed = index.talks.filter(
    (talk) =>
      (topic === undefined || talk.topics.some((value) => sameLabel(value, topic))) &&
      (eventType === undefined ||
        talk.eventTypes.some((value) => sameLabel(value, eventType))) &&
      (year === undefined || talk.date.startsWith(`${year}-`)) &&
      (hasRecording === undefined || (talk.videoUrl !== null) === hasRecording),
  );
  const queryTerms = terms(filter.query);
  const ordered =
    queryTerms.length === 0 ? narrowed : rank(narrowed, (talk) => score(queryTerms, talkFields(talk)));

  return ordered.slice(0, clampLimit(filter.limit));
}

export type EventFilter = Readonly<{
  when?: EventTiming | "all" | undefined;
  query?: string | undefined;
  limit?: number | undefined;
}>;

/**
 * Events with their timing. Upcoming events come soonest first; past events
 * most recent first; "all" lists upcoming before past.
 */
export function listEvents(
  index: SiteIndex,
  filter: EventFilter,
  today: string,
): EventResult[] {
  const when = filter.when ?? "upcoming";
  const queryTerms = terms(filter.query);
  const classified = index.events
    .map((event): EventResult => ({ ...event, timing: eventTiming(event, today) }))
    .filter((event) => when === "all" || event.timing === when)
    .filter((event) => score(queryTerms, eventFields(event)) > 0);

  const upcoming = classified
    .filter((event) => event.timing === "upcoming")
    .sort((left, right) => left.startsOn.localeCompare(right.startsOn));
  const past = classified
    .filter((event) => event.timing === "past")
    .sort((left, right) => right.endsOn.localeCompare(left.endsOn));

  return [...upcoming, ...past].slice(0, clampLimit(filter.limit));
}

/** Distinct labels in first-appearance order, compared by normalized form. */
function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalize(value);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export type SiteOverview = Readonly<{
  name: string;
  url: string;
  currentLocation: SiteIndex["site"]["currentLocation"];
  counts: Readonly<{ posts: number; talks: number; upcomingEvents: number; pastEvents: number }>;
  nextEvent: EventResult | null;
  latestPost: Pick<IndexedPost, "title" | "url" | "publishedOn"> | null;
  filters: Readonly<{
    postCategories: string[];
    postTags: string[];
    talkTopics: string[];
    talkEventTypes: string[];
  }>;
}>;

/** What the site holds and which filter values the other tools accept. */
export function siteOverview(index: SiteIndex, today: string): SiteOverview {
  const events = listEvents(index, { when: "all", limit: MAX_LIMIT }, today);
  const latest = index.posts[0];

  return {
    name: index.site.name,
    url: index.site.url,
    currentLocation: index.site.currentLocation,
    counts: {
      posts: index.posts.length,
      talks: index.talks.length,
      upcomingEvents: index.events.filter((event) => eventTiming(event, today) === "upcoming").length,
      pastEvents: index.events.filter((event) => eventTiming(event, today) === "past").length,
    },
    nextEvent: events.find((event) => event.timing === "upcoming") ?? null,
    latestPost: latest
      ? { title: latest.title, url: latest.url, publishedOn: latest.publishedOn }
      : null,
    filters: {
      postCategories: distinct(index.posts.map((post) => post.category)),
      postTags: distinct(index.posts.flatMap((post) => post.tags)),
      talkTopics: distinct(index.talks.flatMap((talk) => talk.topics)),
      talkEventTypes: distinct(index.talks.flatMap((talk) => talk.eventTypes)),
    },
  };
}

export const SPEAKER_KIT_TALKS = 5;
export const SPEAKER_KIT_EVENTS = 5;

export type SpeakerKitTalk = Pick<
  IndexedTalk,
  "title" | "eventName" | "date" | "location" | "slidesUrl" | "videoUrl" | "sourceCodeUrl"
>;

export type SpeakerKit = Readonly<{
  name: string;
  role: string;
  bio: string;
  longBio: readonly string[];
  focusAreas: readonly string[];
  currentLocation: SiteIndex["site"]["currentLocation"];
  speaking: Readonly<{
    talkCount: number;
    recordedTalkCount: number;
    topics: readonly Readonly<{ topic: string; talks: number }>[];
    eventTypes: readonly string[];
  }>;
  recentTalks: readonly SpeakerKitTalk[];
  upcomingEvents: readonly EventResult[];
  aboutUrl: string;
  contactUrl: string;
  profiles: SiteIndex["speaker"]["profiles"];
  howToInvite: string;
}>;

/**
 * Everything an event organizer asks for before inviting Salih: the bio, the
 * topics he has spoken on (most talks first), recent talks with slides and
 * recordings, where he is already booked, and how to get in touch.
 */
export function speakerKit(index: SiteIndex, today: string): SpeakerKit {
  const topicCounts = new Map<string, { topic: string; talks: number; order: number }>();
  for (const talk of index.talks) {
    for (const topic of talk.topics) {
      const key = normalize(topic);
      if (key.length === 0) continue;
      const entry = topicCounts.get(key);
      if (entry) entry.talks += 1;
      else topicCounts.set(key, { topic, talks: 1, order: topicCounts.size });
    }
  }

  return {
    name: index.site.name,
    role: index.speaker.role,
    bio: index.speaker.bio,
    longBio: index.speaker.longBio,
    focusAreas: index.speaker.focusAreas,
    currentLocation: index.site.currentLocation,
    speaking: {
      talkCount: index.talks.length,
      recordedTalkCount: index.talks.filter((talk) => talk.videoUrl !== null).length,
      topics: [...topicCounts.values()]
        .sort((left, right) => right.talks - left.talks || left.order - right.order)
        .map(({ topic, talks }) => ({ topic, talks })),
      eventTypes: distinct(index.talks.flatMap((talk) => talk.eventTypes)),
    },
    recentTalks: index.talks.slice(0, SPEAKER_KIT_TALKS).map((talk) => ({
      title: talk.title,
      eventName: talk.eventName,
      date: talk.date,
      location: talk.location,
      slidesUrl: talk.slidesUrl,
      videoUrl: talk.videoUrl,
      sourceCodeUrl: talk.sourceCodeUrl,
    })),
    upcomingEvents: listEvents(
      index,
      { when: "upcoming", limit: SPEAKER_KIT_EVENTS },
      today,
    ),
    aboutUrl: index.speaker.aboutUrl,
    contactUrl: index.speaker.contactUrl,
    profiles: index.speaker.profiles,
    howToInvite:
      "The site lists no email address. Send speaking invitations through one of the profiles on the contact page.",
  };
}
