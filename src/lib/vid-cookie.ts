/**
 * Visitor id (`vid`) cookie handling for the AppConfig rollout.
 *
 * Feature: render-rollout-flag (Parts 1 and 2 of the AppConfig rollout)
 *
 * The flag targets individual visitors, so the render Lambda needs a stable id
 * per visitor. It reads a first-party `vid` cookie and, when the request has
 * none, mints a random UUID and sets it on the response as
 * `Secure`, `HttpOnly`, `SameSite=Lax`. CloudFront forwards only this cookie to
 * the render origin.
 *
 * The id is random (not derived from the IP) so it identifies no one and
 * survives a changing IP, and stable so a visitor sees one version for the whole
 * rollout rather than a different one per page. A visitor who clears cookies
 * gets a new id and a fresh bucket, which is acceptable for a rollout.
 *
 * This module is pure over injected inputs (the request's Cookie header and a
 * UUID factory), so it is unit-testable without a request or `crypto`.
 */

import { randomUUID } from "node:crypto";

/** The cookie name the flag context and CloudFront forwarding both key on. */
export const VID_COOKIE_NAME = "vid";

/** One year, in seconds, for the cookie's Max-Age. */
const VID_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** A UUID v4 in canonical lowercase form, the only shape a stored `vid` takes. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Extracts a valid `vid` from a `Cookie` request header, or `null` when the
 * header is absent or carries no well-formed `vid`. A value that is not a
 * canonical UUID v4 is ignored (treated as absent), so a tampered or truncated
 * cookie mints a fresh id rather than becoming an evaluation context of its own.
 */
export function readVid(cookieHeader: string | null | undefined): string | null {
  if (cookieHeader === null || cookieHeader === undefined || cookieHeader === "") {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== VID_COOKIE_NAME) continue;
    const value = trimmed.slice(eq + 1).trim();
    if (UUID_V4.test(value)) return value;
  }
  return null;
}

/** The `Set-Cookie` value that persists a freshly minted `vid`. */
export function vidSetCookie(vid: string): string {
  return (
    `${VID_COOKIE_NAME}=${vid}; Max-Age=${VID_MAX_AGE_SECONDS}; Path=/; ` +
    "Secure; HttpOnly; SameSite=Lax"
  );
}

/** Outcome of resolving the visitor id for a request. */
export type ResolvedVid = Readonly<{
  /** The visitor id to use as the flag evaluation context. */
  vid: string;
  /** The `Set-Cookie` value to add to the response, or `null` if none needed. */
  setCookie: string | null;
}>;

/**
 * Resolves the visitor id for a request: the existing cookie's `vid`, or a
 * freshly minted UUID with the `Set-Cookie` value to persist it.
 *
 * @param cookieHeader the request's `Cookie` header value.
 * @param uuid a UUID factory, overridable in tests; defaults to `crypto`.
 */
export function resolveVid(
  cookieHeader: string | null | undefined,
  uuid: () => string = randomUUID,
): ResolvedVid {
  const existing = readVid(cookieHeader);
  if (existing !== null) {
    return { vid: existing, setCookie: null };
  }
  const minted = uuid();
  return { vid: minted, setCookie: vidSetCookie(minted) };
}
