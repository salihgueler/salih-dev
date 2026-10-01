/**
 * Unit tests for the vid cookie helper.
 *
 * Feature: render-rollout-flag.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  readVid,
  resolveVid,
  vidSetCookie,
  VID_COOKIE_NAME,
} from "./vid-cookie.ts";

const SAMPLE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("readVid extracts a valid vid from the Cookie header", () => {
  assert.equal(readVid(`${VID_COOKIE_NAME}=${SAMPLE}`), SAMPLE);
  assert.equal(readVid(`other=1; ${VID_COOKIE_NAME}=${SAMPLE}; more=2`), SAMPLE);
});

test("readVid returns null for a missing or empty header", () => {
  assert.equal(readVid(null), null);
  assert.equal(readVid(undefined), null);
  assert.equal(readVid(""), null);
});

test("readVid ignores a non-UUID vid (tampered or truncated)", () => {
  assert.equal(readVid(`${VID_COOKIE_NAME}=not-a-uuid`), null);
  assert.equal(readVid(`${VID_COOKIE_NAME}=${SAMPLE.slice(0, 10)}`), null);
});

test("vidSetCookie sets Secure, HttpOnly, SameSite=Lax, Path=/ and Max-Age", () => {
  const value = vidSetCookie(SAMPLE);
  assert.match(value, new RegExp(`^${VID_COOKIE_NAME}=${SAMPLE};`));
  assert.match(value, /Secure/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Lax/);
  assert.match(value, /Path=\//);
  assert.match(value, /Max-Age=\d+/);
});

test("resolveVid returns the existing vid and no Set-Cookie when present", () => {
  const resolved = resolveVid(`${VID_COOKIE_NAME}=${SAMPLE}`);
  assert.equal(resolved.vid, SAMPLE);
  assert.equal(resolved.setCookie, null);
});

test("resolveVid mints a fresh vid and a Set-Cookie when absent", () => {
  const resolved = resolveVid(null, () => SAMPLE);
  assert.equal(resolved.vid, SAMPLE);
  assert.ok(resolved.setCookie !== null);
  assert.match(resolved.setCookie ?? "", /Secure; HttpOnly; SameSite=Lax/);
});

test("resolveVid mints a fresh vid when the cookie is malformed", () => {
  const resolved = resolveVid(`${VID_COOKIE_NAME}=garbage`, () => SAMPLE);
  assert.equal(resolved.vid, SAMPLE);
  assert.ok(resolved.setCookie !== null);
});
