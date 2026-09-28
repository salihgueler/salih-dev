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
import {
  deriveTalkIdentity,
  deriveTalkRecordKey,
} from "./identity.js";
import type { TalkFrontmatter } from "./model.js";

const DECK_ID = "0f9c8c46-2f1e-4a5b-9d3e-71b0d2c9a4e8" as DeckId;

function validRecord(includeVideo = true, includeSourceCode = true): ApiTalkRecord {
  const required = {
    title: 'Building "agent-ready" static websites',
    eventName: "Developer's Conference",
    date: "2026-06-18",
    location: "Berlin, Germany",
    eventUrl: "https://conference.example/talks/agent-ready?track=web&day=2",
    eventTypes: Object.freeze(["Conference", "Developer's Meetup"]),
    slides: deckSlidePath(DECK_ID),
    draft: false,
  };
  const withVideo = includeVideo
    ? {
        ...required,
        videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      }
    : required;
  const frontmatter: TalkFrontmatter = Object.freeze(
    includeSourceCode
      ? {
          ...withVideo,
          sourceCodeUrl: "https://github.com/example/agent-ready-talk",
        }
      : withVideo,
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

test("parses a complete, normalized, self-consistent API talk record", () => {
  const source = validRecord();
  const parsed = parseApiTalkRecord(source);

  assert.deepEqual(parsed, source);
  assert.ok(parsed !== null);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.deck));
  assert.ok(Object.isFrozen(parsed.frontmatter));
  assert.ok(Object.isFrozen(parsed.frontmatter.eventTypes));
});

test("serializes stored JSON deterministically with canonical field order", () => {
  const record = validRecord();
  const reordered: ApiTalkRecord = {
    frontmatter: record.frontmatter,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    deck: record.deck,
    deckId: record.deckId,
    recordKey: record.recordKey,
    talkIdentity: record.talkIdentity,
    schemaVersion: record.schemaVersion,
  };

  const expected = serializeApiTalkRecord(record);
  assert.equal(serializeApiTalkRecord(reordered), expected);
  assert.ok(expected.endsWith("\n"));
  assert.deepEqual(Object.keys(JSON.parse(expected) as object), [
    "schemaVersion",
    "talkIdentity",
    "recordKey",
    "deckId",
    "deck",
    "createdAt",
    "updatedAt",
    "frontmatter",
  ]);
});

test("emits verifier-compatible frontmatter-only Markdown", () => {
  assert.equal(
    toTalkFrontmatterDocument(validRecord()),
    `---
title: "Building \\"agent-ready\\" static websites"
eventName: "Developer's Conference"
date: "2026-06-18"
location: "Berlin, Germany"
eventUrl: "https://conference.example/talks/agent-ready?track=web&day=2"
eventTypes:
  - "Conference"
  - "Developer's Meetup"
slides: "/talks/slides/api/0f9c8c46-2f1e-4a5b-9d3e-71b0d2c9a4e8.pdf"
videoUrl: "https://www.youtube.com/watch?v=abcdefghijk"
sourceCodeUrl: "https://github.com/example/agent-ready-talk"
draft: false
---
`,
  );
});

test("omits absent optional video and source-code URLs from both representations", () => {
  const record = validRecord(false, false);
  const stored = JSON.parse(serializeApiTalkRecord(record)) as {
    frontmatter: Record<string, unknown>;
  };
  const document = toTalkFrontmatterDocument(record);

  assert.equal(Object.hasOwn(stored.frontmatter, "videoUrl"), false);
  assert.equal(Object.hasOwn(stored.frontmatter, "sourceCodeUrl"), false);
  assert.doesNotMatch(document, /^videoUrl:/mu);
  assert.doesNotMatch(document, /^sourceCodeUrl:/mu);
  assert.equal(parseApiTalkRecord(stored)?.frontmatter.videoUrl, undefined);
  assert.equal(
    parseApiTalkRecord(stored)?.frontmatter.sourceCodeUrl,
    undefined,
  );
});

test("round-trips a source-code URL without a video", () => {
  const record = validRecord(false, true);
  const stored = JSON.parse(serializeApiTalkRecord(record)) as {
    frontmatter: Record<string, unknown>;
  };
  const document = toTalkFrontmatterDocument(record);

  assert.equal(
    stored.frontmatter.sourceCodeUrl,
    "https://github.com/example/agent-ready-talk",
  );
  assert.equal(Object.hasOwn(stored.frontmatter, "videoUrl"), false);
  assert.match(
    document,
    /^sourceCodeUrl: "https:\/\/github\.com\/example\/agent-ready-talk"$/mu,
  );
  assert.equal(
    parseApiTalkRecord(stored)?.frontmatter.sourceCodeUrl,
    "https://github.com/example/agent-ready-talk",
  );
});

test("rejects a stored record whose sourceCodeUrl is not a github.com URL", () => {
  const record = validRecord();
  assert.equal(
    parseApiTalkRecord({
      ...record,
      frontmatter: {
        ...record.frontmatter,
        sourceCodeUrl: "https://gitlab.com/example/agent-ready-talk",
      },
    }),
    null,
  );
  assert.equal(
    parseApiTalkRecord({
      ...record,
      frontmatter: {
        ...record.frontmatter,
        sourceCodeUrl: "https://github.com.evil.example/example/repo",
      },
    }),
    null,
  );
});

test("rejects unknown fields at every stored contract level", () => {
  const record = validRecord();

  assert.equal(parseApiTalkRecord({ ...record, storageKey: "caller-key" }), null);
  assert.equal(
    parseApiTalkRecord({
      ...record,
      deck: { ...record.deck, mediaType: "application/pdf" },
    }),
    null,
  );
  assert.equal(
    parseApiTalkRecord({
      ...record,
      frontmatter: { ...record.frontmatter, body: "not approved" },
    }),
    null,
  );
});

test("rejects malformed or inconsistent derived and validated values", () => {
  const record = validRecord();
  const cases: readonly unknown[] = [
    { ...record, schemaVersion: 2 },
    { ...record, talkIdentity: "2026-06-18|different talk" },
    { ...record, recordKey: "2026-06-18-0000000000000000" },
    { ...record, deckId: "not-a-deck-id" },
    { ...record, deck: { ...record.deck, byteLength: 0 } },
    { ...record, deck: { ...record.deck, byteLength: 26_214_401 } },
    { ...record, deck: { ...record.deck, pageCount: 0 } },
    { ...record, createdAt: "2026-02-01" },
    { ...record, updatedAt: "2026-01-31T10:30:00.000Z" },
    {
      ...record,
      frontmatter: { ...record.frontmatter, title: ` ${record.frontmatter.title}` },
    },
    {
      ...record,
      frontmatter: {
        ...record.frontmatter,
        slides: "/talks/slides/api/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf",
      },
    },
    {
      ...record,
      frontmatter: {
        ...record.frontmatter,
        eventName: "Unsafe\\value",
      },
    },
  ];

  for (const candidate of cases) {
    assert.equal(parseApiTalkRecord(candidate), null);
  }
});

test("serializers fail closed when a typed value is corrupted at runtime", () => {
  const record = validRecord();
  const invalid = {
    ...record,
    deck: { ...record.deck, pageCount: 0 },
  } as ApiTalkRecord;

  assert.throws(
    () => serializeApiTalkRecord(invalid),
    /Cannot serialize an invalid API talk record/,
  );
  assert.throws(
    () => toTalkFrontmatterDocument(invalid),
    /Cannot serialize an invalid API talk record/,
  );
});
