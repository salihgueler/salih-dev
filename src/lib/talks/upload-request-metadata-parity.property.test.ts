import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { deckSlidePath, isDeckId, type DeckId } from "./deck.js";
import {
  type NormalizedTalk,
  type TalkCandidate,
  type TalkCriterion,
  type TalkField,
  type TalkFrontmatter,
} from "./model.js";
import {
  parseTalkUploadRequest,
  TALK_UPLOAD_METADATA_FIELDS,
  type TalkUploadMetadataField,
  type UploadIssue,
} from "./upload-request.js";
import { normalizeTalkCandidate } from "./validation.js";

type MetadataPayload = Readonly<
  Partial<Record<TalkUploadMetadataField, unknown>>
>;

type ValidMetadataPayload = Readonly<{
  title: string;
  eventName: string;
  date: string;
  location: string;
  eventUrl: string;
  eventTypes: readonly string[];
  videoUrl?: string;
  sourceCodeUrl?: string;
  draft?: boolean;
}>;

type Diagnostic = readonly [field: TalkField, criterion: TalkCriterion];

type ApiMetadataIssue = Extract<UploadIssue, { code: "invalid_metadata" }>;

const API_UNSAFE_TEXT_PATTERN = /[\\\p{Cc}\u2028\u2029]/u;
const RECORD_ID = "metadata-parity-property";
const DAY_IN_MILLISECONDS = 86_400_000;
const FIRST_DATE_MILLISECONDS = Date.UTC(2000, 0, 1);
const LAST_DATE_OFFSET = 36_524;

const deckIdArbitrary = fc
  .uuid({ version: 4 })
  .filter(isDeckId)
  .map((value): DeckId => value);

const safeDisplayTextArbitrary = fc
  .array(
    fc.constantFrom(
      "Agent",
      "Ready",
      "Café",
      "東京",
      "İstanbul",
      "🚀",
      "Conference",
      "Community",
    ),
    { minLength: 1, maxLength: 6 },
  )
  .map((parts) => `  ${parts.join(" ")}  `);

const isoDateArbitrary = fc
  .integer({ min: 0, max: LAST_DATE_OFFSET })
  .map((dayOffset) =>
    new Date(FIRST_DATE_MILLISECONDS + dayOffset * DAY_IN_MILLISECONDS)
      .toISOString()
      .slice(0, 10),
  );

const eventUrlArbitrary = fc
  .tuple(fc.integer({ min: 1, max: 999_999 }), fc.boolean())
  .map(
    ([eventId, includeQuery]) =>
      `https://events.example/talks/${eventId}${includeQuery ? "?source=site" : ""}`,
  );

const eventTypesArbitrary = fc.uniqueArray(
  fc.constantFrom(
    "Conference",
    "Meetup",
    "Workshop",
    "Community Event",
    "Webinar",
  ),
  { minLength: 1, maxLength: 5 },
);

const videoUrlArbitrary = fc.oneof(
  fc.constant(undefined),
  fc
    .stringMatching(/^[A-Za-z0-9_-]{11}$/u)
    .map((videoId) => `https://www.youtube.com/watch?v=${videoId}`),
  fc
    .stringMatching(/^[A-Za-z0-9_-]{11}$/u)
    .map((videoId) => `https://youtu.be/${videoId}`),
);

const sourceCodeUrlArbitrary = fc.oneof(
  fc.constant(undefined),
  fc
    .tuple(
      fc.stringMatching(/^[a-z0-9](?:[a-z0-9-]{0,20})$/u),
      fc.stringMatching(/^[a-z0-9](?:[a-z0-9._-]{0,20})$/u),
      fc.boolean(),
    )
    .map(
      ([owner, repo, useWww]) =>
        `https://${useWww ? "www." : ""}github.com/${owner}/${repo}`,
    ),
);

const validMetadataArbitrary: fc.Arbitrary<ValidMetadataPayload> = fc
  .tuple(
    safeDisplayTextArbitrary,
    safeDisplayTextArbitrary,
    isoDateArbitrary,
    safeDisplayTextArbitrary,
    eventUrlArbitrary,
    eventTypesArbitrary,
    videoUrlArbitrary,
    sourceCodeUrlArbitrary,
    fc.oneof(fc.constant(undefined), fc.boolean()),
  )
  .map(
    ([
      title,
      eventName,
      date,
      location,
      eventUrl,
      eventTypes,
      videoUrl,
      sourceCodeUrl,
      draft,
    ]) => ({
      title,
      eventName,
      date,
      location,
      eventUrl,
      eventTypes,
      ...(videoUrl === undefined ? {} : { videoUrl }),
      ...(sourceCodeUrl === undefined ? {} : { sourceCodeUrl }),
      ...(draft === undefined ? {} : { draft }),
    }),
  );

const unsafeCharacterArbitrary = fc.constantFrom(
  "\\",
  "\u0000",
  "\u0007",
  "\n",
  "\r",
  "\u2028",
  "\u2029",
);

const roundTripUnsafeMetadataArbitrary: fc.Arbitrary<MetadataPayload> = fc
  .tuple(
    validMetadataArbitrary,
    fc.constantFrom<"title" | "eventName" | "location" | "eventTypes">(
      "title",
      "eventName",
      "location",
      "eventTypes",
    ),
    unsafeCharacterArbitrary,
  )
  .map(([metadata, field, unsafeCharacter]) => {
    if (field === "eventTypes") {
      const [firstEventType, ...remainingEventTypes] = metadata.eventTypes;
      assert.ok(firstEventType !== undefined);
      return {
        ...metadata,
        eventTypes: [
          `${firstEventType}${unsafeCharacter}suffix`,
          ...remainingEventTypes,
        ],
      };
    }

    return {
      ...metadata,
      [field]: `${metadata[field]}${unsafeCharacter}suffix`,
    };
  });

const arbitraryFieldValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.jsonValue(),
  fc.constant(undefined),
  fc.string({ maxLength: 2_100 }),
  fc.constantFrom(
    "",
    "   ",
    "2026-02-30",
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com\\unsafe",
    "value\u0000suffix",
    "value\u2028suffix",
  ),
);

const mutatedMetadataArbitrary: fc.Arbitrary<MetadataPayload> = fc
  .tuple(
    validMetadataArbitrary,
    fc.uniqueArray(fc.constantFrom(...TALK_UPLOAD_METADATA_FIELDS), {
      minLength: 1,
      maxLength: 5,
    }),
  )
  .chain(([metadata, fields]) =>
    fc
      .array(arbitraryFieldValue, {
        minLength: fields.length,
        maxLength: fields.length,
      })
      .map((values) => {
        const mutated: Partial<Record<TalkUploadMetadataField, unknown>> = {
          ...metadata,
        };

        fields.forEach((field, index) => {
          mutated[field] = values[index];
        });

        return Object.freeze(mutated);
      }),
  );

const unconstrainedMetadataArbitrary: fc.Arbitrary<MetadataPayload> = fc.record(
  {
    title: arbitraryFieldValue,
    eventName: arbitraryFieldValue,
    date: arbitraryFieldValue,
    location: arbitraryFieldValue,
    eventUrl: arbitraryFieldValue,
    eventTypes: arbitraryFieldValue,
    videoUrl: arbitraryFieldValue,
    sourceCodeUrl: arbitraryFieldValue,
    draft: arbitraryFieldValue,
  },
);

const metadataArbitrary: fc.Arbitrary<MetadataPayload> = fc.oneof(
  validMetadataArbitrary,
  validMetadataArbitrary,
  roundTripUnsafeMetadataArbitrary,
  mutatedMetadataArbitrary,
  unconstrainedMetadataArbitrary,
);

function repositoryCandidate(
  metadata: MetadataPayload,
  slidePath: string,
): TalkCandidate {
  return Object.freeze({
    title: metadata.title,
    eventName: metadata.eventName,
    date: metadata.date,
    location: metadata.location,
    eventUrl: metadata.eventUrl,
    eventTypes: metadata.eventTypes,
    slides: slidePath,
    videoUrl: metadata.videoUrl,
    sourceCodeUrl: metadata.sourceCodeUrl,
    draft: metadata.draft,
  });
}

function toExpectedFrontmatter(talk: NormalizedTalk): TalkFrontmatter {
  const common = {
    title: talk.title,
    eventName: talk.eventName,
    date: talk.date,
    location: talk.location,
    eventUrl: talk.eventUrl,
    eventTypes: Object.freeze(
      talk.eventTypes.map((eventType) => eventType.label),
    ),
    slides: talk.slidePath,
    draft: talk.draft,
  };

  const withVideo =
    talk.video === null
      ? common
      : { ...common, videoUrl: talk.video.sourceUrl };

  return Object.freeze(
    talk.sourceCodeUrl === null
      ? withVideo
      : { ...withVideo, sourceCodeUrl: talk.sourceCodeUrl },
  );
}

function apiRoundTripIssueCount(metadata: MetadataPayload): number {
  const scalarFields: readonly TalkUploadMetadataField[] = [
    "title",
    "eventName",
    "date",
    "location",
    "eventUrl",
    "videoUrl",
    "sourceCodeUrl",
  ];
  let count = 0;

  for (const field of scalarFields) {
    const value = metadata[field];
    if (typeof value === "string" && API_UNSAFE_TEXT_PATTERN.test(value)) {
      count += 1;
    }
  }

  if (Array.isArray(metadata.eventTypes)) {
    for (const eventType of metadata.eventTypes) {
      if (
        typeof eventType === "string" &&
        API_UNSAFE_TEXT_PATTERN.test(eventType)
      ) {
        count += 1;
      }
    }
  }

  return count;
}

function isApiMetadataIssue(issue: UploadIssue): issue is ApiMetadataIssue {
  return issue.code === "invalid_metadata";
}

function isSharedApiMetadataIssue(
  issue: ApiMetadataIssue,
): issue is ApiMetadataIssue & Readonly<{ criterion: TalkCriterion }> {
  return issue.criterion !== "6.3";
}

function diagnostic(field: TalkField, criterion: TalkCriterion): Diagnostic {
  return [field, criterion];
}

// Feature: talk-upload-endpoint, Property 5: API metadata validation is exactly repository metadata validation
// **Validates: Requirements 6.1, 6.3, 6.5, 11.3**
test("Property 5: API metadata validation matches repository metadata validation", () => {
  fc.assert(
    fc.property(metadataArbitrary, deckIdArbitrary, (metadata, deckId) => {
      const slidePath = deckSlidePath(deckId);
      const repositoryResult = normalizeTalkCandidate(
        repositoryCandidate(metadata, slidePath),
        RECORD_ID,
      );
      const apiResult = parseTalkUploadRequest({ metadata }, slidePath);
      const roundTripIssueCount = apiRoundTripIssueCount(metadata);
      const apiIssues = apiResult.ok ? [] : apiResult.issues;

      assert.equal(apiIssues.every(isApiMetadataIssue), true);

      const metadataIssues = apiIssues.filter(isApiMetadataIssue);
      const apiRoundTripIssues = metadataIssues.filter(
        (issue) => issue.criterion === "6.3",
      );
      const apiSharedDiagnostics = metadataIssues
        .filter(isSharedApiMetadataIssue)
        .map((issue) => diagnostic(issue.field, issue.criterion));
      const repositoryDiagnostics = repositoryResult.ok
        ? []
        : repositoryResult.issues.map((issue) =>
            diagnostic(issue.field, issue.criterion),
          );

      assert.equal(apiRoundTripIssues.length, roundTripIssueCount);
      assert.deepEqual(apiSharedDiagnostics, repositoryDiagnostics);
      assert.equal(
        apiResult.ok,
        repositoryResult.ok && roundTripIssueCount === 0,
      );

      if (apiResult.ok && repositoryResult.ok) {
        assert.deepEqual(
          apiResult.request.metadata,
          toExpectedFrontmatter(repositoryResult.talk),
        );

        if (metadata.draft === undefined) {
          assert.equal(apiResult.request.metadata?.draft, false);
          assert.equal(repositoryResult.talk.draft, false);
        }
      }
    }),
    { numRuns: 250 },
  );
});
