/**
 * Astro `talks` collection boundary.
 *
 * Feature: talks-section (isolated for backend-served-content)
 *
 * This module is the only place that reads the raw `talks` collection through
 * the `astro:content` virtual module. It is deliberately separated from
 * `gateway.ts` so the pure validation and projection helpers there can be
 * reused from a plain Node runtime (the request-time renderer) without pulling
 * the Astro-only virtual module into that module's type graph.
 *
 * Every talk-derived build output resolves its data here via
 * `getPublishedTalksSnapshot`, so the HTML archive, the Markdown alternate, the
 * sitemap, and the LLM discovery indexes are all derived from the same
 * validated version of the same records. The boundary is read-only: it
 * validates, normalizes, and projects, and never writes or repairs a record.
 *
 * A request-scoped override (see `backend-served-content`) lets the
 * request-time renderer inject the snapshot it resolved from S3 for one
 * request, so the same `.astro` pages that read `getPublishedTalksSnapshot`
 * render live content without reading the baked collection. With no override
 * active — the static build and every other caller — the collection is read
 * exactly as before, so the build output is unchanged.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import {
  resolveValidatedTalks,
  selectPublishedTalks,
  type TalksGatewayOptions,
  type TalkSourceRecord,
} from "./gateway.js";
import type { PublishedTalk, ValidatedTalk } from "./model.js";

/** Reads the raw `talks` collection. The only such read in the codebase. */
async function readTalkCollection(): Promise<readonly TalkSourceRecord[]> {
  const { getCollection } = await import("astro:content");
  const entries = await getCollection("talks");

  return entries.map((entry) =>
    Object.freeze({ id: entry.id, data: entry.data }),
  );
}

/**
 * Every valid talk record, drafts included, after metadata and PDF validation.
 * Throws `TalkValidationError` when any record is invalid.
 */
export async function getValidatedTalks(
  options: TalksGatewayOptions = {},
): Promise<readonly ValidatedTalk[]> {
  return resolveValidatedTalks(await readTalkCollection(), options);
}

/**
 * The published talk snapshot: no drafts, newest first, immutable.
 *
 * Prefer `getPublishedTalksSnapshot()` from generation code so every output
 * shares one resolution of the same validated records.
 */
export async function getPublishedTalks(
  options: TalksGatewayOptions = {},
): Promise<readonly PublishedTalk[]> {
  return selectPublishedTalks(await getValidatedTalks(options));
}

const overrideStorage = new AsyncLocalStorage<
  Promise<readonly PublishedTalk[]>
>();

/**
 * Runs `callback` with a request-scoped published-talks snapshot in effect.
 *
 * The request-time renderer resolves the snapshot from S3 once and runs the
 * dynamic route render inside this scope, so `getPublishedTalksSnapshot()`
 * returns that snapshot instead of reading the baked `astro:content`
 * collection. The scope is unwound when the callback settles; nothing leaks
 * between requests.
 */
export function withPublishedTalksSnapshot<T>(
  snapshot: Promise<readonly PublishedTalk[]>,
  callback: () => T,
): T {
  return overrideStorage.run(snapshot, callback);
}

let publishedSnapshot: Promise<readonly PublishedTalk[]> | null = null;

/**
 * One shared published snapshot for the whole generation pass.
 *
 * The HTML archive, the Markdown alternate, the sitemap, and the LLM discovery
 * indexes await this promise instead of rereading raw records, which is what
 * guarantees the human-readable and machine-readable outputs are derived from
 * the same validated version of every record.
 *
 * When a request-scoped override is active (the request-time renderer), that
 * snapshot is returned and the build-time collection is never read. Otherwise
 * the shared build-time snapshot is used. A failed build-time resolution is not
 * cached, so a retry revalidates rather than replaying a stale error.
 */
export function getPublishedTalksSnapshot(): Promise<readonly PublishedTalk[]> {
  const override = overrideStorage.getStore();
  if (override !== undefined) return override;

  if (publishedSnapshot === null) {
    publishedSnapshot = getPublishedTalks().catch((error: unknown) => {
      publishedSnapshot = null;
      throw error;
    });
  }

  return publishedSnapshot;
}

/** Discards the shared snapshot. Intended for verification and fixtures. */
export function resetPublishedTalksSnapshot(): void {
  publishedSnapshot = null;
}
