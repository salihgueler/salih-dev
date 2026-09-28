import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  API_TALK_RECORD_SCHEMA_VERSION,
  parseApiTalkRecord,
  serializeApiTalkRecord,
  toTalkFrontmatterDocument,
  type ApiTalkRecord,
} from "./api-record.js";
import {
  DECK_MAX_BYTES,
  DECK_MIN_BYTES,
  deckSlidePath,
  isDeckId,
  type DeckId,
} from "./deck.js";
import {
  deriveTalkIdentity,
  deriveTalkRecordKey,
} from "./identity.js";
import type { TalkFrontmatter } from "./model.js";
import { parseTalkUploadRequest } from "./upload-request.js";
import { normalizeTalkCandidate } from "./validation.js";

type GeneratedMetadata = Readonly<{
  title: string;
  eventName: string;
  date: string;
  location: string;
  eventUrl: string;
  eventTypes: readonly string[];
  videoUrl?: string;
  sourceCodeUrl?: string;
  draft: boolean;
}>;

type GeneratedRecordInput = Readonly<{
  deckId: DeckId;
  metadata: GeneratedMetadata;
  byteLength: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
}>;

const DAY_IN_MILLISECONDS = 86_400_000;
const FIRST_DATE_MILLISECONDS = Date.UTC(2000, 0, 1);
const LAST_DATE_OFFSET = 36_524;
const FIRST_TIMESTAMP_MILLISECONDS = Date.UTC(2020, 0, 1);
const LAST_TIMESTAMP_MILLISECONDS = Date.UTC(2035, 11, 31, 23, 59, 59, 999);

const isoDateArbitrary = fc
  .integer({ min: 0, max: LAST_DATE_OFFSET })
  .map((dayOffset) =>
    new Date(FIRST_DATE_MILLISECONDS + dayOffset * DAY_IN_MILLISECONDS)
      .toISOString()
      .slice(0, 10),
  );

const displayAtomArbitrary = fc.constantFrom(
  "Agent",
  "Ready",
  "Café",
  "cafe\u0301",
  "Ångström",
  "A\u030Angstro\u0308m",
  "東京",
  "🚀",
  "Builder's",
  '"Secure"',
  "R&D",
);

function displayTextArbitrary(maxAtoms: number): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.constantFrom("", " ", "  ", "\u00a0"),
      fc.array(displayAtomArbitrary, { minLength: 1, maxLength: maxAtoms }),
      fc.constantFrom("", " ", "  ", "\u00a0"),
    )
    .map(([before, atoms, after]) => `${before}${atoms.join(" ")}${after}`);
}

const eventTypesArbitrary = fc.uniqueArray(displayTextArbitrary(3), {
  minLength: 1,
  maxLength: 10,
  selector: (value) => value.trim().normalize("NFC").toLowerCase(),
});

const urlSegmentArbitrary = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), {
    minLength: 1,
    maxLength: 16,
  })
  .map((characters) => characters.join(""));

const eventUrlArbitrary = fc
  .tuple(urlSegmentArbitrary, urlSegmentArbitrary, fc.boolean())
  .map(([host, path, padded]) => {
    const url = `https://${host}.example/talks/${path}?source=api&view=full`;
    return padded ? ` ${url} ` : url;
  });

const videoIdArbitrary = fc
  .array(
    fc.constantFrom(
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",
    ),
    { minLength: 11, maxLength: 11 },
  )
  .map((characters) => characters.join(""));

const videoUrlArbitrary = fc.option(
  fc.tuple(videoIdArbitrary, fc.boolean()).map(([videoId, shortUrl]) =>
    shortUrl
      ? `https://youtu.be/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`,
  ),
  { nil: undefined },
);

const sourceCodeUrlArbitrary = fc.option(
  fc
    .tuple(urlSegmentArbitrary, urlSegmentArbitrary, fc.boolean())
    .map(
      ([owner, repo, useWww]) =>
        `https://${useWww ? "www." : ""}github.com/${owner}/${repo}`,
    ),
  { nil: undefined },
);

const metadataArbitrary: fc.Arbitrary<GeneratedMetadata> = fc
  .record({
    title: displayTextArbitrary(8),
    eventName: displayTextArbitrary(6),
    date: isoDateArbitrary,
    location: displayTextArbitrary(6),
    eventUrl: eventUrlArbitrary,
    eventTypes: eventTypesArbitrary,
    videoUrl: videoUrlArbitrary,
    sourceCodeUrl: sourceCodeUrlArbitrary,
    draft: fc.boolean(),
  })
  .map(({ videoUrl, sourceCodeUrl, ...required }) => {
    const withVideo =
      videoUrl === undefined ? required : { ...required, videoUrl };
    return sourceCodeUrl === undefined
      ? withVideo
      : { ...withVideo, sourceCodeUrl };
  });

const deckIdArbitrary = fc
  .uuid({ version: 4 })
  .filter(isDeckId)
  .map((value): DeckId => value);

const orderedTimestampsArbitrary = fc
  .tuple(
    fc.integer({
      min: FIRST_TIMESTAMP_MILLISECONDS,
      max: LAST_TIMESTAMP_MILLISECONDS,
    }),
    fc.integer({
      min: FIRST_TIMESTAMP_MILLISECONDS,
      max: LAST_TIMESTAMP_MILLISECONDS,
    }),
  )
  .map(([first, second]) =>
    [
      new Date(Math.min(first, second)).toISOString(),
      new Date(Math.max(first, second)).toISOString(),
    ] as const,
  );

const generatedRecordInputArbitrary: fc.Arbitrary<GeneratedRecordInput> = fc
  .tuple(
    deckIdArbitrary,
    metadataArbitrary,
    fc.integer({ min: DECK_MIN_BYTES, max: DECK_MAX_BYTES }),
    fc.integer({ min: 1, max: 10_000 }),
    orderedTimestampsArbitrary,
  )
  .map(([deckId, metadata, byteLength, pageCount, timestamps]) => ({
    deckId,
    metadata,
    byteLength,
    pageCount,
    createdAt: timestamps[0],
    updatedAt: timestamps[1],
  }));

function parseVerifierScalar(raw: string): unknown {
  const value = raw.trim();

  if (value === "true") return true;
  if (value === "false") return false;

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map(parseVerifierScalar);
  }

  const quoted = /^"([\s\S]*)"$/.exec(value) ?? /^'([\s\S]*)'$/.exec(value);
  return quoted === null ? value : quoted[1].replace(/\\(["'])/g, "$1");
}

/** Mirrors the supported scalar/list subset used by verify-static-build.mjs. */
function parseVerifierFrontmatter(source: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  assert.ok(match !== null, "materialized document must have frontmatter");

  const data: Record<string, unknown> = {};
  let listKey: string | null = null;

  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item !== null) {
      assert.ok(listKey !== null, "list item must belong to a field");
      const list = data[listKey];
      assert.ok(Array.isArray(list), "list field must contain an array");
      list.push(parseVerifierScalar(item[1]));
      continue;
    }

    const field = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    assert.ok(field !== null, "frontmatter line must use supported syntax");

    const key = field[1];
    const rawValue = field[2];
    if (rawValue.trim() === "") {
      listKey = key;
      data[key] = [];
      continue;
    }

    listKey = null;
    data[key] = parseVerifierScalar(rawValue);
  }

  return data;
}

function approvedFieldNames(frontmatter: TalkFrontmatter): readonly string[] {
  return Object.keys(frontmatter).sort();
}

// Feature: talk-upload-endpoint, Property 6: Stored record and materialized record round trip
// **Validates: Requirements 6.4**
test("Property 6: stored and materialized records preserve every approved field", () => {
  fc.assert(
    fc.property(generatedRecordInputArbitrary, (input) => {
      const slidePath = deckSlidePath(input.deckId);
      const uploadResult = parseTalkUploadRequest(
        { metadata: input.metadata },
        slidePath,
      );
      assert.equal(uploadResult.ok, true, "generated metadata must be accepted");
      if (!uploadResult.ok) return;

      const frontmatter = uploadResult.request.metadata;
      assert.ok(frontmatter !== null);
      const talkIdentity = deriveTalkIdentity(
        frontmatter.date,
        frontmatter.title,
      );
      const record: ApiTalkRecord = Object.freeze({
        schemaVersion: API_TALK_RECORD_SCHEMA_VERSION,
        talkIdentity,
        recordKey: deriveTalkRecordKey(talkIdentity),
        deckId: input.deckId,
        deck: Object.freeze({
          byteLength: input.byteLength,
          pageCount: input.pageCount,
        }),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        frontmatter,
      });

      const storedValue: unknown = JSON.parse(serializeApiTalkRecord(record));
      const storedRecord = parseApiTalkRecord(storedValue);
      assert.ok(storedRecord !== null);
      assert.deepEqual(storedRecord, record);
      assert.deepEqual(
        approvedFieldNames(storedRecord.frontmatter),
        approvedFieldNames(frontmatter),
      );
      assert.deepEqual(storedRecord.frontmatter, frontmatter);

      const materialized = parseVerifierFrontmatter(
        toTalkFrontmatterDocument(record),
      );
      assert.deepEqual(
        Object.keys(materialized).sort(),
        approvedFieldNames(frontmatter),
      );
      assert.deepEqual(materialized, frontmatter);

      const buildValidation = normalizeTalkCandidate(
        materialized,
        record.recordKey,
      );
      assert.equal(
        buildValidation.ok,
        true,
        "materialized frontmatter must pass production metadata validation",
      );
      if (!buildValidation.ok) return;

      assert.equal(buildValidation.talk.title, frontmatter.title);
      assert.equal(buildValidation.talk.eventName, frontmatter.eventName);
      assert.equal(buildValidation.talk.date, frontmatter.date);
      assert.equal(buildValidation.talk.location, frontmatter.location);
      assert.equal(buildValidation.talk.eventUrl, frontmatter.eventUrl);
      assert.deepEqual(
        buildValidation.talk.eventTypes.map((eventType) => eventType.label),
        frontmatter.eventTypes,
      );
      assert.equal(buildValidation.talk.slidePath, frontmatter.slides);
      assert.equal(
        buildValidation.talk.video?.sourceUrl,
        frontmatter.videoUrl,
      );
      assert.equal(
        buildValidation.talk.sourceCodeUrl ?? undefined,
        frontmatter.sourceCodeUrl,
      );
      assert.equal(buildValidation.talk.draft, frontmatter.draft);
    }),
    { numRuns: 150 },
  );
});
