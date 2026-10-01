/**
 * Tests for request-time content resolution.
 *
 * Feature: backend-served-content
 *
 * These stub the S3 client so no network or filesystem access happens. They
 * prove the two request-time invariants this feature turns on:
 *
 * 1. The render path performs NO `GetObject` on any `talks/decks/` key — deck
 *    presence is decided from the key-only `ListObjectsV2`, and the decks are
 *    served to visitors straight from the content bucket through CloudFront.
 * 2. A missing `site/content.v1.json` is a hard error (the middleware turns it
 *    into a `no-store` 5xx), never a silent fall back to packaged defaults.
 *
 * They live under `src/` so the publisher's root test runs them without
 * importing anything from `infra/`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from "@aws-sdk/client-s3";

import { serializeApiTalkRecord, parseApiTalkRecord } from "./talks/api-record.js";
import { deckSlidePath } from "./talks/deck.js";
import { deriveTalkIdentity, deriveTalkRecordKey } from "./talks/identity.js";
import {
  resolvePublishedPostsFromS3,
  resolvePublishedTalksFromS3,
  resolveSiteContentScope,
} from "./render-content.js";

const DECK_A = "11111111-1111-4111-8111-111111111111";
const DECK_B = "22222222-2222-4222-8222-222222222222";
const BUCKET = "content-bucket";

/** One stored API talk record JSON body under `talks/records/<recordKey>.json`. */
function storedRecord(
  deckId: string,
  title: string,
  date: string,
): { key: string; body: string } {
  const identity = deriveTalkIdentity(date, title);
  const recordKey = deriveTalkRecordKey(identity);
  const record = parseApiTalkRecord({
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
      draft: false,
    },
  });
  assert.ok(record !== null, `record for ${title} must be valid`);
  return {
    key: `talks/records/${recordKey}.json`,
    body: serializeApiTalkRecord(record),
  };
}

type Store = { objects: Map<string, string>; sentGets: string[] };

/**
 * A minimal S3 stub that serves `ListObjectsV2` from the store keys and
 * `GetObject` from the store bodies, recording every `GetObject` key so a test
 * can prove which objects were read.
 */
function stubClient(objects: Map<string, string>): {
  client: S3Client;
  store: Store;
} {
  const store: Store = { objects, sentGets: [] };
  // A real S3Client instance (the paginator validates `instanceof S3Client`)
  // with its network `send` replaced by an in-memory store, so no AWS call and
  // no credentials are needed.
  const client = new S3Client({ region: "us-east-1" });
  const send = (command: unknown): Promise<unknown> => {
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? "";
      const contents = [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ Key: key }));
      return Promise.resolve({ Contents: contents, IsTruncated: false });
    }
    if (command instanceof GetObjectCommand) {
      const key = command.input.Key ?? "";
      store.sentGets.push(key);
      const body = objects.get(key);
      if (body === undefined) {
        return Promise.reject(
          new NoSuchKey({ message: "missing", $metadata: {} }),
        );
      }
      return Promise.resolve({
        Body: { transformToString: () => Promise.resolve(body) },
      });
    }
    return Promise.reject(new Error("unexpected command"));
  };
  (client as unknown as { send: typeof send }).send = send;
  return { client, store };
}

test("renders published talks from S3 without ever downloading a deck", async () => {
  const record = storedRecord(DECK_A, "A talk", "2026-06-18");
  const objects = new Map<string, string>([
    [record.key, record.body],
    [`talks/decks/${DECK_A}.pdf`, "unused: never read"],
  ]);
  const { client, store } = stubClient(objects);

  const published = await resolvePublishedTalksFromS3(client, BUCKET);

  assert.equal(published.length, 1);
  // The only GetObject calls were for talk records — never a deck object.
  assert.ok(store.sentGets.length > 0);
  for (const key of store.sentGets) {
    assert.ok(
      !key.startsWith("talks/decks/"),
      `render must not GetObject a deck, but read ${key}`,
    );
  }
  assert.ok(store.sentGets.includes(record.key));
});

test("drops a record whose deck is absent instead of erroring", async () => {
  const present = storedRecord(DECK_A, "Present talk", "2026-06-18");
  const absent = storedRecord(DECK_B, "Absent-deck talk", "2026-04-02");
  const objects = new Map<string, string>([
    [present.key, present.body],
    [absent.key, absent.body],
    // Only DECK_A's deck is present; DECK_B's is absent.
    [`talks/decks/${DECK_A}.pdf`, "unused"],
  ]);
  const { client } = stubClient(objects);

  const published = await resolvePublishedTalksFromS3(client, BUCKET);

  assert.equal(published.length, 1);
  assert.equal(published[0].title, "Present talk");
});

test("renders the empty archive when no records exist", async () => {
  const { client } = stubClient(new Map());
  const published = await resolvePublishedTalksFromS3(client, BUCKET);
  assert.equal(published.length, 0);
});

test("a missing site content object is a hard error, not a fallback", async () => {
  const { client } = stubClient(new Map());
  await assert.rejects(
    () => resolveSiteContentScope(client, BUCKET, "2026-06-18"),
    (error: unknown) => error instanceof NoSuchKey,
  );
});

test("resolves the site content scope when the object is present", async () => {
  const content = {
    schemaVersion: 1,
    location: {
      city: "Berlin",
      country: "Germany",
      updatedOn: "2026-09-15",
      coordinates: { x: 53, y: 32 },
    },
    events: [],
  };
  const { client } = stubClient(
    new Map([["site/content.v1.json", JSON.stringify(content)]]),
  );
  const scope = await resolveSiteContentScope(client, BUCKET, "2026-06-18");
  assert.equal(scope.today, "2026-06-18");
  assert.equal(scope.content.location.city, "Berlin");
});

/** One stored blog post object under `posts/<id>.md`. */
function storedPost(id: string, title: string, pubDate: string): [string, string] {
  const body = [
    "---",
    `title: ${title}`,
    "description: A description.",
    `pubDate: ${pubDate}`,
    "category: Testing",
    "tags:",
    "  - alpha",
    "hero:",
    "  src: https://salih.dev/images/blog/x.webp",
    "  alt: Alt",
    "  credit: Someone",
    "  creditUrl: https://example.com/",
    "aiSummary: A summary.",
    "---",
    "",
    "Some **markdown**.",
    "",
  ].join("\n");
  return [`posts/${id}.md`, body];
}

test("reads blog posts from S3 on each request: added, removed and invalid", async () => {
  const objects = new Map<string, string>([
    storedPost("first-post", "First", "2026-06-18"),
    storedPost("second-post", "Second", "2026-07-01"),
    ["posts/broken.md", "---\ntitle: Missing fields\n---\n\nBody\n"],
  ]);
  const { client, store } = stubClient(objects);

  const posts = await resolvePublishedPostsFromS3(client, BUCKET);
  // The invalid post is dropped; the valid ones render from S3 with their
  // bodies compiled at request time.
  assert.deepEqual(
    posts.map((post) => post.id),
    ["first-post", "second-post"],
  );
  assert.ok(posts[0].renderedHtml.includes("<strong>markdown</strong>"));
  assert.ok(store.sentGets.every((key) => key.startsWith("posts/")));

  // Removing an object removes the post on the next request; nothing is cached
  // from the repo or a previous request.
  objects.delete("posts/first-post.md");
  const next = await resolvePublishedPostsFromS3(client, BUCKET);
  assert.deepEqual(
    next.map((post) => post.id),
    ["second-post"],
  );
});
