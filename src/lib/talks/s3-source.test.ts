/**
 * Tests for the request-time talk source adapter.
 *
 * Feature: backend-served-content
 *
 * These are pure unit tests over injected stored objects: no S3, no filesystem,
 * no network. They live inside the asset boundary (`src/**`) so the publisher's
 * root test can run them without importing anything under `infra/`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeApiTalkRecord,
  type ApiTalkRecord,
} from "./api-record.js";
import { deckSlidePath } from "./deck.js";
import { deriveTalkIdentity, deriveTalkRecordKey } from "./identity.js";
import { parseApiTalkRecord } from "./api-record.js";
import {
  apiTalkSourceRecords,
  availableDeckIds,
  parseStoredRecord,
  type StoredRecordObject,
} from "./s3-source.js";

const DECK_A = "11111111-1111-4111-8111-111111111111";
const DECK_B = "22222222-2222-4222-8222-222222222222";

function storedRecord(
  deckId: string,
  title: string,
  date: string,
  draft: boolean,
): StoredRecordObject {
  const identity = deriveTalkIdentity(date, title);
  const recordKey = deriveTalkRecordKey(identity);
  const candidate = {
    schemaVersion: 1,
    talkIdentity: identity,
    recordKey,
    deckId,
    deck: { byteLength: 1024, pageCount: 3 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    frontmatter: {
      title,
      eventName: "Example Conference",
      date,
      location: "Berlin, Germany",
      eventUrl: "https://conference.example/talk",
      eventTypes: ["Conference"],
      tags: ["Serverless"],
      slides: deckSlidePath(deckId as never),
      draft,
    },
  };
  const record = parseApiTalkRecord(candidate);
  assert.ok(record !== null, `record for ${title} must be valid`);
  return {
    key: `talks/records/${recordKey}.json`,
    body: serializeApiTalkRecord(record as ApiTalkRecord),
  };
}

test("parseStoredRecord derives the api/ collection id from the record key", () => {
  const object = storedRecord(DECK_A, "A talk", "2026-06-18", false);
  const result = parseStoredRecord(object);
  assert.ok(result !== null);
  assert.equal(result.id, `api/${result.record.recordKey}`);
  assert.equal(result.record.deckId, DECK_A);
});

test("parseStoredRecord rejects a key/record mismatch", () => {
  const object = storedRecord(DECK_A, "A talk", "2026-06-18", false);
  const tampered: StoredRecordObject = {
    key: "talks/records/2026-06-18-ffffffffffffffff.json",
    body: object.body,
  };
  assert.equal(parseStoredRecord(tampered), null);
});

test("parseStoredRecord rejects a non-record key or bad JSON", () => {
  assert.equal(
    parseStoredRecord({ key: "talks/records/x.json", body: "not json" }),
    null,
  );
  assert.equal(
    parseStoredRecord({ key: "talks/pending/x.json", body: "{}" }),
    null,
  );
});

test("apiTalkSourceRecords maps records to gateway inputs in stable order", () => {
  const objects = [
    storedRecord(DECK_B, "Zeta talk", "2026-04-02", false),
    storedRecord(DECK_A, "Alpha talk", "2026-06-18", false),
  ];
  const { records, parsed, droppedKeys } = apiTalkSourceRecords(objects);

  assert.equal(droppedKeys.length, 0);
  assert.equal(records.length, 2);
  assert.equal(parsed.length, 2);
  // Stable, code-unit id order regardless of input order.
  assert.deepEqual(
    [...records].map((record) => record.id),
    [...records].map((record) => record.id).sort(),
  );
  // The gateway data is the record's canonical frontmatter.
  for (const record of records) {
    assert.equal(typeof record.data, "object");
    assert.ok(record.id.startsWith("api/"));
  }
});

test("apiTalkSourceRecords reports dropped keys instead of failing closed", () => {
  const good = storedRecord(DECK_A, "Good talk", "2026-06-18", false);
  const { records, droppedKeys } = apiTalkSourceRecords([
    good,
    { key: "talks/records/broken.json", body: "{" },
  ]);
  assert.equal(records.length, 1);
  assert.deepEqual(droppedKeys, ["talks/records/broken.json"]);
});

test("availableDeckIds accepts only well-formed deck keys", () => {
  const ids = availableDeckIds([
    `talks/decks/${DECK_A}.pdf`,
    `talks/decks/${DECK_B}.pdf`,
    "talks/decks/not-a-deck-id.pdf",
    "talks/decks/README.md",
    "talks/records/x.json",
  ]);
  assert.equal(ids.size, 2);
  assert.ok(ids.has(DECK_A));
  assert.ok(ids.has(DECK_B));
});
