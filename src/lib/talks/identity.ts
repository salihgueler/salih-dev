import { createHash } from "node:crypto";

/** Canonical, source-independent identity for one talk. */
export type TalkIdentity = string & Readonly<{ __talkIdentity: true }>;

/** Safe storage key derived deterministically from a canonical talk identity. */
export type TalkRecordKey = string & Readonly<{ __talkRecordKey: true }>;

const IDENTITY_SEPARATOR = "|";
const RECORD_KEY_HASH_LENGTH = 16;
const RECORD_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{16}$/u;

/**
 * Canonicalizes the identity-bearing title independently of locale and source.
 * JavaScript's `toLowerCase` applies Unicode default case conversion without
 * consulting the host locale.
 */
function canonicalizeTitle(title: string): string {
  return title
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

/**
 * Derives one canonical identity from the only identity-bearing talk fields.
 * The separator cannot occur in a validated ISO full date.
 */
export function deriveTalkIdentity(
  date: string,
  title: string,
): TalkIdentity {
  return `${date}${IDENTITY_SEPARATOR}${canonicalizeTitle(title)}` as TalkIdentity;
}

/**
 * Derives a stable, filesystem-safe key without exposing the canonical title.
 * The date prefix remains readable while the identity hash disambiguates talks.
 */
export function deriveTalkRecordKey(
  identity: TalkIdentity,
): TalkRecordKey {
  const date = identity.slice(0, identity.indexOf(IDENTITY_SEPARATOR));
  const digest = createHash("sha256")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, RECORD_KEY_HASH_LENGTH);

  return `${date}-${digest}` as TalkRecordKey;
}

/** Returns whether a value has the exact code-owned talk-record key shape. */
export function isTalkRecordKey(value: string): value is TalkRecordKey {
  return RECORD_KEY_PATTERN.test(value);
}
