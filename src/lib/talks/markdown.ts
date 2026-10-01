/**
 * Talks Markdown serialization.
 *
 * Feature: talks-section
 *
 * This module projects an already-resolved published snapshot into the Markdown
 * alternate of `/talks/`. It is pure: it reads no collection, no file, and no
 * network resource, and it never mutates the talks it is given. The route and
 * the discovery indexes pass the snapshot resolved by the gateway so the
 * human-readable and machine-readable representations always describe the same
 * validated version of every record.
 *
 * Two safety rules shape the output:
 *
 * 1. Author text is emitted as Markdown-safe text. Structural characters are
 *    backslash-escaped and whitespace runs are collapsed, so a title, event
 *    name, location, event-type label, or topical-tag label cannot introduce a
 *    heading, list, emphasis span, code span, link, raw HTML, or extra block.
 * 2. Validated URLs are emitted only as link destinations inside angle
 *    brackets, with the few characters that could terminate a destination
 *    percent-encoded. Author values are never interpreted as Markdown.
 */

import type { HttpsUrl, PublishedTalk } from "./model.js";
import { formatTalkDate, TALKS_EMPTY_MESSAGE } from "./projection.js";

/** Level-one heading of the Talks Markdown document. */
export const TALKS_DOCUMENT_TITLE = "Talks";

/** Short description rendered directly under the document heading. */
export const TALKS_DOCUMENT_DESCRIPTION =
  "Conference and community talks, with slides for every talk and a recording where one is available.";

/**
 * Characters that can change inline structure: escapes, code spans, emphasis,
 * links, raw HTML, entity references, strikethrough, tables, math, and the ATX
 * heading marker.
 */
const MARKDOWN_INLINE_PATTERN = /[\\`*_[\]<>&#~|$]/g;

/** Block markers that only matter when they start a value. */
const LEADING_BLOCK_MARKER_PATTERN = /^([-+=:])/;

/** Ordered-list marker that only matters when it starts a value. */
const LEADING_ORDERED_MARKER_PATTERN = /^(\d{1,9})([.)])/;

/** Characters that must not appear literally inside a link destination. */
const UNSAFE_DESTINATION_PATTERN = /[\s<>\\\u007F]|[\u0000-\u001F]/gu;

/**
 * Renders author text so it carries no Markdown structure.
 *
 * Whitespace runs, including line endings, collapse to a single space so a
 * value cannot start a new block, and every structural character is
 * backslash-escaped so it renders as the literal character the Author wrote.
 */
export function escapeMarkdownText(value: string): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  const escaped = collapsed.replace(
    MARKDOWN_INLINE_PATTERN,
    (character) => `\\${character}`,
  );

  return escaped
    .replace(LEADING_BLOCK_MARKER_PATTERN, (marker) => `\\${marker}`)
    .replace(
      LEADING_ORDERED_MARKER_PATTERN,
      (_match, digits: string, delimiter: string) =>
        `${digits}\\${delimiter}`,
    );
}

/**
 * Formats a validated URL as a Markdown link destination.
 *
 * Validated URLs preserve the Author's exact value, which may still contain a
 * space or an angle bracket. Those characters are percent-encoded and the
 * destination is wrapped in angle brackets so an unencoded parenthesis cannot
 * terminate the link either.
 */
export function markdownLinkDestination(url: HttpsUrl): string {
  const safe = url.replace(UNSAFE_DESTINATION_PATTERN, (character) =>
    encodeURIComponent(character),
  );

  return `<${safe}>`;
}

/** Emits a validated URL as a standalone Markdown autolink. */
function autolink(url: HttpsUrl): string {
  return markdownLinkDestination(url);
}

/**
 * Serializes one published talk as a level-two section.
 *
 * Every field required of the machine-readable representation appears in this
 * one section, so the metadata, the slide deck, and the optional recording can
 * only ever be associated with the talk they belong to. The source video URL is
 * emitted only when the talk itself carries a video, and the source-code link
 * only when the talk itself carries a github.com source URL.
 */
function serializeTalkSection(talk: PublishedTalk): string {
  const eventTypes = talk.eventTypes
    .map((eventType) => escapeMarkdownText(eventType.label))
    .join(", ");

  const topicTags = talk.tags
    .map((tag) => escapeMarkdownText(tag.label))
    .join(", ");

  return [
    `## ${escapeMarkdownText(talk.title)}`,
    "",
    `Event: [${escapeMarkdownText(talk.eventName)}](${markdownLinkDestination(talk.eventUrl)})`,
    `Date: ${formatTalkDate(talk.date)} (${talk.date})`,
    `Location: ${escapeMarkdownText(talk.location)}`,
    `Event types: ${eventTypes}`,
    // Topical tags are a separate classification axis and are emitted on their
    // own line, only when the talk carries at least one, so the machine-readable
    // representation never conflates them with the event types above.
    ...(talk.tags.length === 0 ? [] : [`Tags: ${topicTags}`]),
    `Slides: ${autolink(talk.slidePublicUrl)}`,
    ...(talk.video === null ? [] : [`Video: ${autolink(talk.video.sourceUrl)}`]),
    ...(talk.sourceCodeUrl === null
      ? []
      : [`Source code: ${autolink(talk.sourceCodeUrl)}`]),
  ].join("\n");
}

/**
 * Serializes the published snapshot as the Talks Markdown document: the
 * document heading, its description, and one section per published talk in the
 * snapshot's order.
 *
 * Drafts never reach this function because the snapshot excludes them. When no
 * talk is published the document is still complete and retrievable, and simply
 * states that no talks are published instead of listing entries.
 */
export function serializeTalksMarkdown(
  talks: readonly PublishedTalk[],
): string {
  const sections =
    talks.length === 0
      ? [TALKS_EMPTY_MESSAGE]
      : talks.map((talk) => serializeTalkSection(talk));

  return `${[
    `# ${TALKS_DOCUMENT_TITLE}`,
    TALKS_DOCUMENT_DESCRIPTION,
    ...sections,
  ].join("\n\n")}\n`;
}
