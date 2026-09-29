/**
 * Request-time content resolution for the dynamic routes.
 *
 * Feature: backend-served-content
 *
 * This module reads the mutable content the four dynamic routes need — the site
 * content object for the home page's location and events, and the approved talk
 * records and decks for the Talks archive — from the content bucket at request
 * time, and turns them into the request-scoped overrides the shared config and
 * gateway read through.
 *
 * It lives under `src/` so the SSR build bundles it into the Astro server with
 * the SAME module instances as `site-content-source.ts` and `gateway-astro.ts`.
 * That shared identity is load-bearing: the override this module sets is only
 * visible to the pages if the setter and the reader are the same module, which
 * they are only when both are bundled together. The render Lambda drives this
 * through Astro middleware (also bundled into the server), never by importing a
 * second copy from outside the bundle.
 *
 * S3 access is read-only. Missing objects are tolerated: a missing content
 * object falls back to the packaged default, and missing or empty talk prefixes
 * render the approved empty archive. The prefix-scoped `s3:ListBucket` grant on
 * the render role turns a missing key into a clean not-found rather than an
 * AccessDenied the SDK would surface as a server error.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  GetObjectCommand,
  NoSuchKey,
  paginateListObjectsV2,
  S3Client,
} from "@aws-sdk/client-s3";

import { parseSiteContent } from "../config/site-content-schema";
import {
  defaultSiteContent,
  type SiteContentScope,
} from "../config/site-content-source";
import {
  API_DECK_PREFIX,
  API_DECK_SUFFIX,
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

/** True when a listing/get should treat the object as simply absent. */
function isMissing(error: unknown): boolean {
  if (error instanceof NoSuchKey) return true;
  const name = (error as { name?: string } | null)?.name;
  return name === "NoSuchKey" || name === "NotFound";
}

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

/** Reads one object body as bytes. */
async function getBytes(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const bytes = await result.Body?.transformToByteArray();
  if (bytes === undefined) throw new Error(`Empty body for ${key}`);
  return bytes;
}

/**
 * Reads and validates the site content object, falling back to the packaged
 * default when it is absent so the home page always renders. A present but
 * invalid object is a hard error (the caller returns a 5xx), because serving
 * a page from content the validator rejects would defeat the schema.
 */
export async function resolveSiteContentScope(
  client: S3Client,
  bucket: string,
  today: string,
): Promise<SiteContentScope> {
  try {
    const body = await getText(client, bucket, SITE_CONTENT_KEY);
    return { content: parseSiteContent(JSON.parse(body)), today };
  } catch (error) {
    if (isMissing(error)) {
      // The site content object is absent: fall back to the packaged default
      // (already validated at module load) so the home page still renders.
      return { content: defaultSiteContent(), today };
    }
    throw error;
  }
}

/**
 * Resolves the published talk snapshot from the content bucket by reusing the
 * shared gateway, so the request-time archive matches the static build for the
 * same content. Approved decks are written under a temporary render root's
 * `public/talks/slides/api/` directory (the location the gateway's slide-asset
 * validation expects), and the temporary root is always removed.
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

  const renderRoot = await mkdtemp(path.join(tmpdir(), "salih-render-"));
  try {
    const recordRoot = path.join(renderRoot, "src", "content", "talks", "api");
    const slideRoot = path.join(
      renderRoot,
      "public",
      "talks",
      "slides",
      "api",
    );
    await mkdir(slideRoot, { recursive: true });

    const plan = planDeckMaterialization(parsed, deckIds, {
      recordRoot,
      slideRoot,
    });

    await Promise.all(
      plan.records.map(async (record) => {
        const deckId = record.deckSource.slice(0, -API_DECK_SUFFIX.length);
        const bytes = await getBytes(
          client,
          bucket,
          `${API_DECK_PREFIX}${deckId}${API_DECK_SUFFIX}`,
        );
        await writeFile(record.deckTarget, bytes);
      }),
    );

    const validated = await resolveValidatedTalks(records, {
      projectRoot: renderRoot,
      // The decks were fully validated at publish time; skip the pdfjs parse at
      // render time so the request path pulls no native canvas dependency and
      // does not re-parse every PDF on each render.
      skipPdfParse: true,
    });
    return selectPublishedTalks(validated);
  } finally {
    await rm(renderRoot, { force: true, recursive: true });
  }
}
