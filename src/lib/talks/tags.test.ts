/**
 * Focused tests for the optional topical `tags` field.
 *
 * Feature: talks-section (topical tags)
 *
 * These cover the behaviours the shared parity and round-trip properties do not
 * pin exactly: backward-compatible absence, normalization and uniqueness,
 * cardinality and shape rejection with the 2.11 diagnostic, persistence through
 * the API record, the separate topical projection axis, and the separate,
 * non-conflating topical filter dimension.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  API_TALK_RECORD_SCHEMA_VERSION,
  parseApiTalkRecord,
  serializeApiTalkRecord,
  toTalkFrontmatterDocument,
  type ApiTalkRecord,
} from "./api-record.js";
import { deckSlidePath, type DeckId } from "./deck.js";
import { deriveTalkIdentity, deriveTalkRecordKey } from "./identity.js";
import type {
  PublishedTalk,
  TalkFrontmatter,
  ValidatedTalk,
} from "./model.js";
import {
  deriveFilterOptions,
  deriveTopicFilterOptions,
  filterTalks,
  projectTalkArchive,
  talkMatchesEventType,
  talkMatchesTopicTag,
  TOPIC_TAG_ID_PREFIX,
  EVENT_TYPE_ID_PREFIX,
} from "./projection.js";
import {
  normalizeTag,
  normalizeTalkCandidate,
  TALK_TAG_MAX_CODE_POINTS,
  TALK_TAG_MAX_COUNT,
} from "./validation.js";
import {
  createFilterController,
  initialFilterState,
  selectFilterOption,
} from "./filter-controller.js";

const DECK_ID = "0f9c8c46-2f1e-4a5b-9d3e-71b0d2c9a4e8" as DeckId;

/** Minimal valid candidate; tags overridden per case. */
function candidate(tags?: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    title: "Building agent-ready static websites",
    eventName: "Developer's Conference",
    date: "2026-06-18",
    location: "Berlin, Germany",
    eventUrl: "https://conference.example/talks/agent-ready",
    eventTypes: ["Conference"],
    slides: deckSlidePath(DECK_ID),
    draft: false,
  };
  if (arguments.length > 0) base.tags = tags;
  return base;
}

/* --------------------------------------------------------------------------
 * Validation and normalization
 * ----------------------------------------------------------------------- */

test("a talk with no tags field is valid and normalizes to an empty list", () => {
  const result = normalizeTalkCandidate(candidate(), "no-tags");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.talk.tags, []);
});

test("an omitted or empty tags list means no topical tags", () => {
  for (const tags of [undefined, []] as const) {
    const result =
      tags === undefined
        ? normalizeTalkCandidate(candidate(), "empty-tags")
        : normalizeTalkCandidate(candidate(tags), "empty-tags");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.talk.tags, []);
  }
});

test("an explicit null tags value is rejected by the strict contract", () => {
  const result = normalizeTalkCandidate(candidate(null), "null-tags");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.issues.some(
      (issue) => issue.field === "tags" && issue.criterion === "2.11",
    ),
  );
});

test("tag labels keep display capitalization and derive a case-folded key", () => {
  const result = normalizeTalkCandidate(
    candidate(["  AWS Amplify  ", "Serverless"]),
    "labels",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.talk.tags.map((tag) => tag.label),
    ["AWS Amplify", "Serverless"],
  );
  assert.deepEqual(
    result.talk.tags.map((tag) => tag.comparisonKey),
    ["aws amplify", "serverless"],
  );
});

test("normalizeTag trims, NFC-normalizes, and case-folds the comparison key", () => {
  const tag = normalizeTag("  Café  ");
  assert.equal(tag.label, "Café".normalize("NFC"));
  assert.equal(tag.comparisonKey, "café".normalize("NFC"));
});

test("tags that collide after normalization are rejected with a 2.11 diagnostic", () => {
  const result = normalizeTalkCandidate(
    candidate(["Serverless", "serverless"]),
    "dupe",
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  const tagIssues = result.issues.filter((issue) => issue.field === "tags");
  assert.equal(tagIssues.length, 1);
  assert.equal(tagIssues[0]?.criterion, "2.11");
  assert.match(tagIssues[0]?.message ?? "", /duplicates/u);
});

test("a non-array tags value is rejected with a 2.11 diagnostic", () => {
  const result = normalizeTalkCandidate(candidate("Serverless"), "shape");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.issues.some(
      (issue) => issue.field === "tags" && issue.criterion === "2.11",
    ),
  );
});

test("a non-string tag entry is rejected with a 2.11 diagnostic naming the index", () => {
  const result = normalizeTalkCandidate(candidate(["ok", 42]), "entry");
  assert.equal(result.ok, false);
  if (result.ok) return;
  const tagIssues = result.issues.filter((issue) => issue.field === "tags");
  assert.equal(tagIssues[0]?.criterion, "2.11");
  assert.match(tagIssues[0]?.message ?? "", /tags\[1\]/u);
});

test("an over-length tag label is rejected", () => {
  const tooLong = "a".repeat(TALK_TAG_MAX_CODE_POINTS + 1);
  const result = normalizeTalkCandidate(candidate([tooLong]), "length");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.field === "tags"));
});

test("an empty-after-trim tag label is rejected", () => {
  const result = normalizeTalkCandidate(candidate(["   "]), "blank");
  assert.equal(result.ok, false);
});

test("more than the maximum number of tags is rejected", () => {
  const many = Array.from(
    { length: TALK_TAG_MAX_COUNT + 1 },
    (_unused, index) => `tag-${index}`,
  );
  const result = normalizeTalkCandidate(candidate(many), "count");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.issues.some(
      (issue) => issue.field === "tags" && issue.criterion === "2.11",
    ),
  );
});

test("tags are distinct from eventTypes even when a label coincides", () => {
  const result = normalizeTalkCandidate(
    { ...candidate(["Conference"]), eventTypes: ["Conference"] },
    "coincide",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.talk.eventTypes.map((eventType) => eventType.label),
    ["Conference"],
  );
  assert.deepEqual(
    result.talk.tags.map((tag) => tag.label),
    ["Conference"],
  );
});

/* --------------------------------------------------------------------------
 * Persistence through the API record
 * ----------------------------------------------------------------------- */

function apiRecord(frontmatterTags?: readonly string[]): ApiTalkRecord {
  const base: TalkFrontmatter = {
    title: "Building agent-ready static websites",
    eventName: "Developer's Conference",
    date: "2026-06-18",
    location: "Berlin, Germany",
    eventUrl: "https://conference.example/talks/agent-ready",
    eventTypes: Object.freeze(["Conference"]),
    slides: deckSlidePath(DECK_ID),
    draft: false,
  };
  const frontmatter: TalkFrontmatter = Object.freeze(
    frontmatterTags === undefined
      ? base
      : { ...base, tags: Object.freeze([...frontmatterTags]) },
  );
  const talkIdentity = deriveTalkIdentity(frontmatter.date, frontmatter.title);
  return Object.freeze({
    schemaVersion: API_TALK_RECORD_SCHEMA_VERSION,
    talkIdentity,
    recordKey: deriveTalkRecordKey(talkIdentity),
    deckId: DECK_ID,
    deck: Object.freeze({ byteLength: 1_842_577, pageCount: 24 }),
    createdAt: "2026-02-01T10:22:41.118Z",
    updatedAt: "2026-02-01T10:30:00.000Z",
    frontmatter,
  });
}

test("an API record round-trips its topical tags in canonical order", () => {
  const record = apiRecord(["Serverless", "Developer Experience"]);
  const stored: unknown = JSON.parse(serializeApiTalkRecord(record));
  const parsed = parseApiTalkRecord(stored);
  assert.ok(parsed !== null);
  assert.deepEqual(parsed.frontmatter.tags, [
    "Serverless",
    "Developer Experience",
  ]);
});

test("an API record without tags omits the field from both representations", () => {
  const record = apiRecord();
  const stored = JSON.parse(serializeApiTalkRecord(record)) as {
    frontmatter: Record<string, unknown>;
  };
  assert.equal(Object.hasOwn(stored.frontmatter, "tags"), false);
  assert.doesNotMatch(toTalkFrontmatterDocument(record), /^tags:/mu);
});

test("an API record with an empty tags list is rejected as non-canonical", () => {
  // The canonical record omits empty tags, so a stored empty list is not the
  // normalized form and must not silently parse.
  const record = apiRecord([]);
  assert.equal(parseApiTalkRecord(record), null);
});

test("the frontmatter document lists tags on their own block after eventTypes", () => {
  const document = toTalkFrontmatterDocument(
    apiRecord(["Serverless", "GraphQL"]),
  );
  assert.match(
    document,
    /eventTypes:\n {2}- "Conference"\ntags:\n {2}- "Serverless"\n {2}- "GraphQL"\nslides:/u,
  );
});

/* --------------------------------------------------------------------------
 * Projection and filtering (separate topical axis)
 * ----------------------------------------------------------------------- */

function publishedTalk(
  id: string,
  eventTypeLabels: readonly string[],
  tagLabels: readonly string[],
): PublishedTalk {
  const result = normalizeTalkCandidate(
    {
      ...candidate(tagLabels),
      title: `Talk ${id}`,
      eventTypes: [...eventTypeLabels],
    },
    id,
  );
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("fixture must be valid");
  const validated: ValidatedTalk = Object.freeze({
    ...result.talk,
    slideFilePath: `/repo/public${result.talk.slidePath}`,
  });
  return validated as PublishedTalk;
}

test("topical filter options are derived on a separate axis from event types", () => {
  const talks = [
    publishedTalk("a", ["Conference"], ["Serverless"]),
    publishedTalk("b", ["Meetup"], ["Serverless", "Flutter"]),
  ];

  const eventOptions = deriveFilterOptions(talks);
  const topicOptions = deriveTopicFilterOptions(talks);

  assert.deepEqual(
    eventOptions.map((option) => option.label),
    ["Conference", "Meetup"],
  );
  assert.deepEqual(
    topicOptions.map((option) => option.label),
    ["Serverless", "Flutter"],
  );
  assert.ok(
    eventOptions.every((option) => option.id.startsWith(EVENT_TYPE_ID_PREFIX)),
  );
  assert.ok(
    topicOptions.every((option) => option.id.startsWith(TOPIC_TAG_ID_PREFIX)),
  );
});

test("the archive card carries topical tags on a distinct field and namespace", () => {
  const talks = [publishedTalk("a", ["Conference"], ["Serverless"])];
  const archive = projectTalkArchive(talks);
  const card = archive.cards[0];
  assert.ok(card !== undefined);

  assert.deepEqual(
    card.tags.map((tag) => tag.label),
    ["Conference"],
  );
  assert.deepEqual(
    card.topicTags.map((tag) => tag.label),
    ["Serverless"],
  );
  assert.ok(card.eventTypeIds.every((id) => id.startsWith(EVENT_TYPE_ID_PREFIX)));
  assert.ok(card.topicTagIds.every((id) => id.startsWith(TOPIC_TAG_ID_PREFIX)));
  assert.deepEqual(
    archive.topicFilterOptions.map((option) => option.label),
    ["Serverless"],
  );
});

test("topical matching and event-type matching never conflate", () => {
  // A label shared across both axes must match only on the axis it was queried.
  const talk = publishedTalk("shared", ["Workshop"], ["Workshop"]);
  assert.equal(talkMatchesEventType(talk, "workshop"), true);
  assert.equal(talkMatchesTopicTag(talk, "workshop"), true);

  const eventOnly = publishedTalk("event", ["Workshop"], ["Serverless"]);
  assert.equal(talkMatchesTopicTag(eventOnly, "workshop"), false);
  assert.equal(talkMatchesEventType(eventOnly, "serverless"), false);
});

test("filterTalks over the identity selection returns every talk unchanged", () => {
  const talks = [
    publishedTalk("a", ["Conference"], ["Serverless"]),
    publishedTalk("b", ["Meetup"], []),
  ];
  assert.deepEqual(filterTalks(talks, null), talks);
});

/* --------------------------------------------------------------------------
 * Client filter controller: both axes, one-hot, non-conflating
 * ----------------------------------------------------------------------- */

test("the client controller filters on the topical axis without touching event types", () => {
  const controller = createFilterController(
    [
      { id: "all-talks", label: "All talks" },
      { id: `${EVENT_TYPE_ID_PREFIX}0`, label: "Conference" },
      { id: `${TOPIC_TAG_ID_PREFIX}0`, label: "Serverless" },
    ],
    [
      {
        id: "a",
        eventTypeIds: [`${EVENT_TYPE_ID_PREFIX}0`],
        topicTagIds: [`${TOPIC_TAG_ID_PREFIX}0`],
      },
      {
        id: "b",
        eventTypeIds: [`${EVENT_TYPE_ID_PREFIX}0`],
        topicTagIds: [],
      },
    ],
  );

  const initial = initialFilterState(controller);
  assert.deepEqual([...initial.visibleEntryIds], ["a", "b"]);

  const byTopic = selectFilterOption(
    controller,
    initial,
    `${TOPIC_TAG_ID_PREFIX}0`,
  );
  assert.deepEqual([...byTopic.visibleEntryIds], ["a"]);

  const byEvent = selectFilterOption(
    controller,
    byTopic,
    `${EVENT_TYPE_ID_PREFIX}0`,
  );
  assert.deepEqual([...byEvent.visibleEntryIds], ["a", "b"]);
});
