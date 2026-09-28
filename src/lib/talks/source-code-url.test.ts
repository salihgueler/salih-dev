/**
 * Source-code link validation.
 *
 * Feature: talks-section (sourceCodeUrl extension)
 *
 * Covers the pure GitHub URL validator and its integration into candidate
 * normalization: a valid github.com link is accepted and preserved, the field
 * is optional and backward-compatible when absent, and every credential-bearing,
 * deceptive-host, look-alike-host, non-HTTPS, or pathless value is rejected with
 * the criterion 2.10 diagnostic.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { deckSlidePath, type DeckId } from "./deck.js";
import type { TalkCandidate } from "./model.js";
import { normalizeTalkCandidate, parseGitHubHttpsUrl } from "./validation.js";

const DECK_ID = "0f9c8c46-2f1e-4a5b-9d3e-71b0d2c9a4e8" as DeckId;

function baseCandidate(
  overrides: Readonly<Record<string, unknown>> = {},
): TalkCandidate {
  return Object.freeze({
    title: "Building agent-ready static websites",
    eventName: "Developer's Conference",
    date: "2026-06-18",
    location: "Berlin, Germany",
    eventUrl: "https://conference.example/talks/agent-ready",
    eventTypes: Object.freeze(["Conference"]),
    slides: deckSlidePath(DECK_ID),
    ...overrides,
  });
}

test("accepts credential-free absolute https github.com links", () => {
  const links = [
    "https://github.com/example/talk-demo",
    "https://github.com/example/talk-demo/tree/main/src",
    "https://github.com/org/repo/blob/main/README.md?plain=1#L10",
    "https://github.com/example/repo.git",
  ];

  for (const link of links) {
    assert.equal(parseGitHubHttpsUrl(link), link, `expected ${link} to parse`);
  }
});

test("normalizes the www.github.com alias to the canonical host", () => {
  assert.equal(
    parseGitHubHttpsUrl("https://www.github.com/example/talk-demo"),
    "https://github.com/example/talk-demo",
  );
  assert.equal(
    parseGitHubHttpsUrl("https://www.github.com/example/repo/tree/main"),
    "https://github.com/example/repo/tree/main",
  );
});

test("rejects deceptive, look-alike, and subdomain hosts", () => {
  const rejected = [
    "https://github.com.evil.example/example/repo",
    "https://notgithub.com/example/repo",
    "https://gist.github.com/example/abc123",
    "https://raw.github.com/example/repo/main/file",
    "https://github.io/example/repo",
    "https://evilgithub.com/example/repo",
  ];

  for (const link of rejected) {
    assert.equal(parseGitHubHttpsUrl(link), null, `expected ${link} rejected`);
  }
});

test("rejects unsupported protocols, credentials, and pathless links", () => {
  const rejected = [
    "http://github.com/example/repo",
    "ftp://github.com/example/repo",
    "https://user:token@github.com/example/repo",
    "https://github.com",
    "https://github.com/",
    "https://github.com//",
    "https://www.github.com/",
    "javascript:alert(1)//github.com/example/repo",
    "  ",
  ];

  for (const link of rejected) {
    assert.equal(parseGitHubHttpsUrl(link), null, `expected ${link} rejected`);
  }
});

test("normalizes a talk without a source-code link (backward compatible)", () => {
  const result = normalizeTalkCandidate(baseCandidate(), "no-source");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.talk.sourceCodeUrl, null);
});

test("normalizes a talk with a valid source-code link", () => {
  const result = normalizeTalkCandidate(
    baseCandidate({ sourceCodeUrl: "https://www.github.com/example/demo" }),
    "with-source",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.talk.sourceCodeUrl, "https://github.com/example/demo");
});

test("rejects an invalid source-code link with a 2.10 diagnostic", () => {
  const rejected: readonly unknown[] = [
    "https://gitlab.com/example/demo",
    "https://github.com.evil.example/example/demo",
    "http://github.com/example/demo",
    "https://github.com",
    "https://user:token@github.com/example/demo",
    42,
    null,
  ];

  for (const value of rejected) {
    const result = normalizeTalkCandidate(
      baseCandidate({ sourceCodeUrl: value }),
      "bad-source",
    );
    assert.equal(result.ok, false, `expected ${String(value)} rejected`);
    if (result.ok) continue;
    const sourceIssues = result.issues.filter(
      (issue) => issue.field === "sourceCodeUrl",
    );
    assert.equal(sourceIssues.length, 1);
    assert.equal(sourceIssues[0].criterion, "2.10");
  }
});
