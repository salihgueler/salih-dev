import { randomUUID } from "node:crypto";

/** Inclusive byte-size bounds for an uploaded PDF slide deck. */
export const DECK_MIN_BYTES = 1;
export const DECK_MAX_BYTES = 26_214_400;

/** The only media type accepted for uploaded slide decks. */
export const DECK_MEDIA_TYPE = "application/pdf";

/** Code-owned object-key prefixes for pending and approved decks. */
export const PENDING_DECK_PREFIX = "talks/pending/";
export const APPROVED_DECK_PREFIX = "talks/decks/";

/** Code-owned public path prefix for API-authored slide decks. */
export const API_SLIDE_PREFIX = "/talks/slides/api/";

/** A canonical, lowercase RFC 4122 version 4 identifier. */
export type DeckId = string & Readonly<{ __deckId: true }>;

const DECK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Creates a unique identifier whose value is controlled entirely by code. */
export function createDeckId(): DeckId {
  return randomUUID() as DeckId;
}

/** Narrows only canonical identifiers that this feature can generate. */
export function isDeckId(value: string): value is DeckId {
  return DECK_ID_PATTERN.test(value);
}

/** Derives the single pending object key to which deck bytes are uploaded. */
export function pendingDeckKey(id: DeckId): string {
  return `${PENDING_DECK_PREFIX}${id}.pdf`;
}

/** Derives the pending object key containing the staged upload request. */
export function pendingRequestKey(id: DeckId): string {
  return `${PENDING_DECK_PREFIX}${id}.upload.json`;
}

/** Derives the approved private object key for a validated deck. */
export function approvedDeckKey(id: DeckId): string {
  return `${APPROVED_DECK_PREFIX}${id}.pdf`;
}

/** Derives the safe public slide path for a validated API-authored deck. */
export function deckSlidePath(id: DeckId): string {
  return `${API_SLIDE_PREFIX}${id}.pdf`;
}

/**
 * Recovers a deck identifier only from the exact public path shape emitted by
 * this module. Paths with alternate prefixes, suffixes, encodings, or IDs are
 * rejected.
 */
export function deckIdFromSlidePath(path: string): DeckId | null {
  if (!path.startsWith(API_SLIDE_PREFIX) || !path.endsWith(".pdf")) {
    return null;
  }

  const candidate = path.slice(API_SLIDE_PREFIX.length, -".pdf".length);
  return isDeckId(candidate) ? candidate : null;
}
