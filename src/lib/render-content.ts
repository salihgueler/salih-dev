/**
 * Request-time content resolution for the dynamic routes.
 *
 * Feature: backend-served-content
 *
 * This module reads the mutable content the four dynamic routes need — the site
 * content object for the home page's location and events, and the approved talk
 * records for the Talks archive — from the content bucket at request time, and
 * turns them into the request-scoped overrides the shared config and gateway
 * read through. Deck bytes are never read here: deck presence is decided from a
 * key-only listing of `talks/decks/`, and the decks are served to visitors
 * straight from that prefix through a dedicated CloudFront behavior.
 *
 * It lives under `src/` so the SSR build bundles it into the Astro server with
 * the SAME module instances as `site-content-source.ts` and `gateway-astro.ts`.
 * That shared identity is load-bearing: the override this module sets is only
 * visible to the pages if the setter and the reader are the same module, which
 * they are only when both are bundled together. The render Lambda drives this
 * through Astro middleware (also bundled into the server), never by importing a
 * second copy from outside the bundle.
 *
 * S3 access is read-only, and request-time rendering reads only S3 — never the
 * packaged JSON or `src/content/blog`. A missing `site/content.v1.json` is a
 * hard error (the caller returns a `no-store` 5xx and CloudFront serves the
 * last good page via `stale-if-error`), not a silent fall back to packaged
 * defaults. Missing or empty talk prefixes render the approved empty archive.
 * The prefix-scoped `s3:ListBucket` grant on the render role turns a missing
 * key into a clean not-found rather than an AccessDenied the SDK would surface
 * as a server error.
 */

import path from "node:path";

import {
  GetObjectCommand,
  paginateListObjectsV2,
  S3Client,
} from "@aws-sdk/client-s3";

import { parseSiteContent } from "../config/site-content-schema";
import { type SiteContentScope } from "../config/site-content-source";
import {
  POST_PREFIX,
  POST_SUFFIX,
  requestTimePostsFromObjects,
  type StoredPostObject,
} from "./blog/s3-posts";
import type { RequestTimePost } from "./blog/posts-source";
import {
  API_DECK_PREFIX,
  API_RECORD_PREFIX,
  API_RECORD_SUFFIX,
  apiTalkSourceRecords,
  availableDeckIds,
  planDeckMaterialization,
  type StoredRecordObject,
} from "./talks/s3-source";
import {
  resolveValidatedTalks,
  selectPublishedTalks,
} from "./talks/gateway";
import type { PublishedTalk } from "./talks/model";

const SITE_CONTENT_KEY = "site/content.v1.json";

/** Collection-id prefix the Astro glob loader assigns API-authored records. */
const API_COLLECTION_PREFIX = "api/";

/**
 * `planDeckMaterialization` validates that its roots resolve to the code-owned
 * `src/content/talks/api` and `public/talks/slides/api` directories. The render
 * path uses the plan only to decide which records have a present deck (the
 * `records` vs `skipped` split) and never writes to these roots, so they are
 * fixed code-owned suffixes rather than a temp directory. No filesystem access
 * touches them.
 */
const DECK_PRESENCE_ROOT = "/salih-dev-render";
const DECK_PRESENCE_RECORD_ROOT = `${DECK_PRESENCE_ROOT}/src/content/talks/api`;
const DECK_PRESENCE_SLIDE_ROOT = `${DECK_PRESENCE_ROOT}/public/talks/slides/api`;

/** Lists every key under one prefix using the prefix-scoped ListBucket grant. */
async function listKeys(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  for await (const page of paginateListObjectsV2(
    { client },
    { Bucket: bucket, Prefix: prefix },
  )) {
    for (const object of page.Contents ?? []) {
      if (object.Key !== undefined) keys.push(object.Key);
    }
  }
  return keys;
}

/** Reads one object body as a UTF-8 string. */
async function getText(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const body = await result.Body?.transformToString("utf8");
  if (body === undefined) throw new Error(`Empty body for ${key}`);
  return body;
}

/**
 * Reads and validates the site content object from S3. Request-time rendering
 * reads only S3, never the packaged JSON: a missing object is NOT tolerated —
 * it propagates like any read failure so the caller returns a `no-store` 5xx
 * and CloudFront keeps serving the last good page via `stale-if-error`, rather
 * than silently rendering stale packaged defaults. A present but invalid object
 * is likewise a hard error, because serving a page from content the validator
 * rejects would defeat the schema.
 */
export async function resolveSiteContentScope(
  client: S3Client,
  bucket: string,
  today: string,
): Promise<SiteContentScope> {
  const body = await getText(client, bucket, SITE_CONTENT_KEY);
  return { content: parseSiteContent(JSON.parse(body)), today };
}

/**
 * Resolves the published talk snapshot from the content bucket by reusing the
 * shared gateway, so the request-time archive matches the static build for the
 * same content. Deck presence is decided from a key-only `ListObjectsV2` of
 * `talks/decks/`: a deck is never downloaded (`s3:GetObject`) or written to
 * disk here, and the deck bytes are served to visitors straight from
 * `talks/decks/` through a dedicated CloudFront behavior. The gateway validates
 * each deck-present record's slide-path shape with `skipAssetRead`, so no
 * filesystem read runs and the request path is free of any deck read.
 */
export async function resolvePublishedTalksFromS3(
  client: S3Client,
  bucket: string,
): Promise<readonly PublishedTalk[]> {
  const [recordKeys, deckKeys] = await Promise.all([
    listKeys(client, bucket, API_RECORD_PREFIX),
    listKeys(client, bucket, API_DECK_PREFIX),
  ]);

  const recordObjects: StoredRecordObject[] = await Promise.all(
    recordKeys
      .filter((key) => key.endsWith(API_RECORD_SUFFIX))
      .map(async (key) => ({ key, body: await getText(client, bucket, key) })),
  );

  const { records, parsed } = apiTalkSourceRecords(recordObjects);
  const deckIds = availableDeckIds(deckKeys);

  if (records.length === 0) {
    return selectPublishedTalks(await resolveValidatedTalks([]));
  }

  // Which records have an approved deck present, decided from the key-only
  // `talks/decks/` listing above — never by downloading a deck. This mirrors the
  // static publisher, whose `materializeApiTalks` writes only the deck-present
  // records into the `talks` collection (a deck-absent record is dropped, not an
  // error). `planDeckMaterialization` reuses that exact plan.
  const plan = planDeckMaterialization(parsed, deckIds, {
    recordRoot: DECK_PRESENCE_RECORD_ROOT,
    slideRoot: DECK_PRESENCE_SLIDE_ROOT,
  });
  const presentRecordKeys = new Set(
    plan.records.map((record) => path.basename(record.recordPath, ".md")),
  );
  const presentRecords = records.filter((record) =>
    presentRecordKeys.has(record.id.slice(API_COLLECTION_PREFIX.length)),
  );

  // Validate the deck-present records without any deck read: the slide path is
  // validated for shape, and the deck's presence is already proven by the S3
  // listing, so `skipAssetRead` skips every filesystem access. The render path
  // therefore performs no `s3:GetObject` on any deck and writes nothing to disk;
  // decks are served to visitors straight from `talks/decks/` through a
  // dedicated CloudFront behavior, not through this renderer.
  const validated = await resolveValidatedTalks(presentRecords, {
    skipAssetRead: true,
  });
  return selectPublishedTalks(validated);
}

/**
 * Resolves the published-posts override from the content bucket's `posts/`
 * prefix at request time. Every `posts/<id>.md` object is read and turned into a
 * validated, request-time-rendered post reusing the shared blog schema and the
 * shared Markdown config, so the request-time blog output matches the static
 * build for the same content. A post whose key or frontmatter is invalid is
 * excluded and its key is logged, so one bad object never drops the rest of the
 * blog. A removed object disappears from the next request's listing because the
 * listing is derived from the live `ListObjectsV2` result.
 */
export async function resolvePublishedPostsFromS3(
  client: S3Client,
  bucket: string,
): Promise<readonly RequestTimePost[]> {
  const keys = await listKeys(client, bucket, POST_PREFIX);
  const objects: StoredPostObject[] = await Promise.all(
    keys
      .filter((key) => key.endsWith(POST_SUFFIX))
      .map(async (key) => ({ key, body: await getText(client, bucket, key) })),
  );

  const { posts, droppedKeys } = await requestTimePostsFromObjects(objects);
  if (droppedKeys.length > 0) {
    // Structured, body-free log so an invalid post is diagnosable without
    // leaking content; the valid posts still render.
    console.warn(
      JSON.stringify({ event: "post_dropped", keys: [...droppedKeys] }),
    );
  }
  return posts;
}
