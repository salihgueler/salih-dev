import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { deriveTalkIdentity } from "../src/lib/talks/identity.ts";

const requiredFiles = [
  "index.html",
  "index.md",
  "about/index.html",
  "about.md",
  "blog/index.html",
  "blog/index.md",
  "talks/index.html",
  "talks/index.md",
  "llms.txt",
  "llms-full.txt",
  "api/catalog.json",
  "api/openapi.json",
  ".well-known/agent-readiness.json",
  ".well-known/mcp/server-card.json",
  ".well-known/skills/index.json",
  ".well-known/webmcp.json",
  "skills/read-salih-dev/SKILL.md",
  "rss.xml",
  "sitemap.xml",
  "robots.txt",
];

for (const relativePath of requiredFiles) {
  await access(path.join("dist", relativePath));
}

const blogDirectory = path.join("dist", "blog");
const blogEntries = await readdir(blogDirectory, { withFileTypes: true });
const postDirectories = blogEntries.filter((entry) => entry.isDirectory());

for (const entry of postDirectories) {
  await Promise.all([
    access(path.join(blogDirectory, entry.name, "index.html")),
    access(path.join(blogDirectory, `${entry.name}.md`)),
  ]);
}

const sourceFiles = await readdir("src/content/blog");
for (const sourceFile of sourceFiles.filter((file) => file.endsWith(".md"))) {
  const markdown = await readFile(
    path.join("src/content/blog", sourceFile),
    "utf8",
  );
  if (!/^originalUrl: "https:\/\/dev\.to\//m.test(markdown)) continue;
  if (!/hero:\n  src: "https:\/\/salih\.dev\/images\/blog\//m.test(markdown)) {
    throw new Error(
      `DEV post ${sourceFile} does not use an AWS-hosted banner URL.`,
    );
  }
}

/* ---------------------------------------------------------------------------
 * Talks archive invariants
 *
 * Feature: talks-section
 *
 * These checks read only author-managed source records and the generated
 * `dist` output, so they verify what visitors and automated clients actually
 * receive rather than trusting the build code that produced it.
 *
 * The source records are the expectation: every non-draft record must appear
 * in both representations, every draft record must appear in neither, and the
 * HTML archive and the Markdown alternate must describe the same ordered
 * public metadata. The empty collection is a supported state, but it still has
 * to produce both retrievable documents with no talk entries; a missing
 * machine-readable document is never acceptable.
 * ------------------------------------------------------------------------ */

const SITE_ORIGIN = "https://salih.dev";
const TALKS_CANONICAL_URL = `${SITE_ORIGIN}/talks/`;
const TALKS_MARKDOWN_HREF = "/talks/index.md";
const TALKS_SLIDE_PREFIX = "/talks/slides/";
const TALKS_DOCUMENT_TITLE = "Talks";
const TALKS_EMPTY_MESSAGE = "No talks are currently published.";
const YOUTUBE_EMBED_HOST = "www.youtube-nocookie.com";
const PDF_SIGNATURE = "%PDF-";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function fail(message) {
  throw new Error(`Talks verification failed: ${message}`);
}

/** Collapses whitespace runs and normalizes so representations compare equal. */
function normalizeText(value) {
  return value.replace(/\s+/gu, " ").trim().normalize("NFC");
}

const HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u00a0"],
]);

function decodeHtml(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return HTML_ENTITIES.get(entity.toLowerCase()) ?? match;
  });
}

/** Renders inner HTML as the text a visitor reads. */
function htmlText(value) {
  return normalizeText(decodeHtml(value.replace(/<[^>]*>/g, " ")));
}

/**
 * Removes script and style contents so markup checks inspect the rendered
 * document rather than the selectors and attribute names that the progressive
 * filter bundle and the stylesheets legitimately mention.
 */
function documentMarkup(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
}

/** Removes the serializer's backslash escapes so author text compares equal. */
function unescapeMarkdown(value) {
  return normalizeText(value.replace(/\\([\\`*_[\]<>&#~|$\-+=:.)])/g, "$1"));
}

/**
 * Percent-encodes the characters the Markdown serializer must encode inside a
 * link destination, so a source URL and its Markdown destination compare equal.
 */
function normalizeUrl(value) {
  return value
    .trim()
    .replace(/[\s<>\\\u007F]|[\u0000-\u001F]/gu, (character) =>
      encodeURIComponent(character),
    );
}

/** The required human-readable form of a validated ISO calendar date. */
function expectedDisplayDate(isoDate) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (parts === null) fail(`talk date ${isoDate} is not an ISO calendar date.`);

  const month = MONTH_NAMES[Number.parseInt(parts[2], 10) - 1];
  if (month === undefined) fail(`talk date ${isoDate} has no calendar month.`);

  return `${month} ${Number.parseInt(parts[3], 10)}, ${parts[1]}`;
}

function countOccurrences(haystack, needle) {
  if (needle === "") return 0;

  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }

  return count;
}

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match === null ? null : decodeHtml(match[1]);
}

/* ---------------------------------------------------------------------------
 * Author-managed source records
 * ------------------------------------------------------------------------ */

/** Reads the supported frontmatter subset: scalars and single-level lists. */
function parseFrontmatter(source, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (match === null) fail(`${file} has no frontmatter block.`);

  const data = {};
  let listKey = null;

  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item !== null) {
      if (listKey === null) fail(`${file} has a list item outside a field.`);
      data[listKey].push(parseScalar(item[1]));
      continue;
    }

    const field = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (field === null) fail(`${file} has an unsupported frontmatter line.`);

    const [, key, rawValue] = field;
    if (rawValue.trim() === "") {
      listKey = key;
      data[key] = [];
      continue;
    }

    listKey = null;
    data[key] = parseScalar(rawValue);
  }

  return data;
}

function parseScalar(raw) {
  const value = raw.trim();

  if (value === "true") return true;
  if (value === "false") return false;

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map(parseScalar);
  }

  const quoted = /^"([\s\S]*)"$/.exec(value) ?? /^'([\s\S]*)'$/.exec(value);
  return quoted === null ? value : quoted[1].replace(/\\(["'])/g, "$1");
}

function requireString(data, field, file) {
  const value = data[field];
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${file} has no single ${field} text value.`);
  }
  return value;
}

/** The public projection of one source record, as it must appear in `dist`. */
function toSourceTalk(data, file) {
  const eventTypes = data.eventTypes;
  if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
    fail(`${file} has no eventTypes list.`);
  }

  const videoUrl = data.videoUrl;
  if (videoUrl !== undefined && typeof videoUrl !== "string") {
    fail(`${file} has a non-text videoUrl value.`);
  }

  const sourceCodeUrl = data.sourceCodeUrl;
  if (sourceCodeUrl !== undefined && typeof sourceCodeUrl !== "string") {
    fail(`${file} has a non-text sourceCodeUrl value.`);
  }

  return {
    file,
    title: normalizeText(requireString(data, "title", file)),
    eventName: normalizeText(requireString(data, "eventName", file)),
    date: requireString(data, "date", file).trim(),
    location: normalizeText(requireString(data, "location", file)),
    eventUrl: requireString(data, "eventUrl", file).trim(),
    eventTypes: eventTypes.map((eventType, index) => {
      if (typeof eventType !== "string" || eventType.trim() === "") {
        fail(`${file} has a non-text eventTypes value at position ${index}.`);
      }
      return normalizeText(eventType);
    }),
    slides: requireString(data, "slides", file).trim(),
    videoUrl: videoUrl === undefined ? null : videoUrl.trim(),
    sourceCodeUrl: sourceCodeUrl === undefined ? null : sourceCodeUrl.trim(),
    draft: data.draft === true,
  };
}

const TALKS_SOURCE_DIRECTORY = path.join("src", "content", "talks");
const TALKS_API_SOURCE_DIRECTORY = path.join(TALKS_SOURCE_DIRECTORY, "api");
const TALKS_API_SLIDE_PREFIX = `${TALKS_SLIDE_PREFIX}api/`;

function isInsideDirectory(directory, candidate) {
  const relative = path.relative(
    path.resolve(directory),
    path.resolve(candidate),
  );
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Enforces source-independent identity and exact Git/API namespace ownership. */
function verifySourceTalkInvariants(talks) {
  const filesByIdentity = new Map();

  for (const talk of talks) {
    const identity = deriveTalkIdentity(talk.date, talk.title);
    const files = filesByIdentity.get(identity) ?? [];
    files.push(talk.file);
    filesByIdentity.set(identity, files);

    const isApiSource = isInsideDirectory(
      TALKS_API_SOURCE_DIRECTORY,
      talk.file,
    );
    const usesApiSlide = talk.slides.startsWith(TALKS_API_SLIDE_PREFIX);

    if (isApiSource && !usesApiSlide) {
      fail(
        `${talk.file} is API-authored but references ${talk.slides} outside the reserved ${TALKS_API_SLIDE_PREFIX} namespace.`,
      );
    }
    if (!isApiSource && usesApiSlide) {
      fail(
        `${talk.file} is repository-authored but references reserved API slide ${talk.slides}.`,
      );
    }
  }

  const conflicts = [...filesByIdentity.entries()]
    .filter(([, files]) => files.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([identity, files]) =>
        `${JSON.stringify(identity)} in ${files.toSorted().join(", ")}`,
    );

  if (conflicts.length > 0) {
    fail(
      `Talk_Identity values must be globally unique across all source records: ${conflicts.join("; ")}.`,
    );
  }
}

async function readSourceTalks() {
  const entries = await readdir(TALKS_SOURCE_DIRECTORY, {
    recursive: true,
    withFileTypes: true,
  });

  const talks = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    const file = path.join(
      entry.parentPath ?? TALKS_SOURCE_DIRECTORY,
      entry.name,
    );
    const source = await readFile(file, "utf8");
    talks.push(toSourceTalk(parseFrontmatter(source, file), file));
  }

  verifySourceTalkInvariants(talks);
  return talks;
}

/* ---------------------------------------------------------------------------
 * Generated representations
 * ------------------------------------------------------------------------ */

/** Extracts the public metadata of every talk entry rendered in the archive. */
function readHtmlTalks(html) {
  const cards = [];
  const cardPattern =
    /<article\b([^>]*\bdata-talk-card(?=[\s>])[^>]*)>([\s\S]*?)<\/article>/g;

  for (const [, openTag, body] of html.matchAll(cardPattern)) {
    const id = attribute(openTag, "data-talk-id");
    if (id === null || id === "") fail("a talk entry has no data-talk-id.");

    const title = /<h2\b[^>]*class="talk-title"[^>]*>([\s\S]*?)<\/h2>/.exec(
      body,
    );
    if (title === null) fail(`talk entry ${id} has no title heading.`);
    if (countOccurrences(body, "<h2") !== 1) {
      fail(`talk entry ${id} does not render exactly one title heading.`);
    }

    const event =
      /<a\b[^>]*class="talk-event-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(
        body,
      );
    if (event === null) fail(`talk entry ${id} has no event link.`);

    const date = /<time\b[^>]*datetime="([^"]*)"[^>]*>([\s\S]*?)<\/time>/.exec(
      body,
    );
    if (date === null) fail(`talk entry ${id} has no talk date.`);

    const location =
      /<dt\b[^>]*>Location<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/.exec(body);
    if (location === null) fail(`talk entry ${id} has no location.`);

    const tags = [
      ...body.matchAll(/<li\b[^>]*class="talk-tag"[^>]*>([\s\S]*?)<\/li>/g),
    ].map(([, label]) => htmlText(label));
    if (tags.length === 0) fail(`talk entry ${id} has no event-type tag.`);

    const slideTags = [
      ...body.matchAll(/<a\b[^>]*class="talk-slides-link"[^>]*>/g),
    ];
    if (slideTags.length !== 1) {
      fail(`talk entry ${id} does not render exactly one slide-deck link.`);
    }

    const slidePath = attribute(slideTags[0][0], "href");
    const slidesLabel = attribute(slideTags[0][0], "aria-label");
    if (slidePath === null || slidesLabel === null) {
      fail(`talk entry ${id} has an incomplete slide-deck link.`);
    }

    const sourceTags = [
      ...body.matchAll(/<a\b[^>]*class="talk-source-link"[^>]*>/g),
    ];
    if (sourceTags.length > 1) {
      fail(`talk entry ${id} renders more than one source-code link.`);
    }
    let sourceCodeUrl = null;
    let sourceCodeLabel = null;
    if (sourceTags.length === 1) {
      sourceCodeUrl = attribute(sourceTags[0][0], "href");
      sourceCodeLabel = attribute(sourceTags[0][0], "aria-label");
      if (sourceCodeUrl === null || sourceCodeLabel === null) {
        fail(`talk entry ${id} has an incomplete source-code link.`);
      }
    }

    const players = [
      ...body.matchAll(/<div\b[^>]*\bdata-talk-video(?=[\s>])[^>]*>/g),
    ];
    if (players.length > 1) {
      fail(`talk entry ${id} renders more than one video region.`);
    }

    let video = null;
    if (players.length === 1) {
      const embedUrl = attribute(players[0][0], "data-talk-video-embed-url");
      const fallback =
        /<p\b[^>]*class="talk-video-fallback"[^>]*>\s*<a\b[^>]*href="([^"]*)"[^>]*>/.exec(
          body,
        );
      if (embedUrl === null || fallback === null) {
        fail(`talk entry ${id} has an incomplete video region.`);
      }
      video = { embedUrl, sourceUrl: decodeHtml(fallback[1]) };
    }

    cards.push({
      id,
      title: htmlText(title[1]),
      eventName: htmlText(event[2]),
      eventUrl: event[1],
      date: date[1],
      displayDate: htmlText(date[2]),
      location: htmlText(location[1]),
      eventTypes: tags,
      slidePath,
      slidesLabel,
      sourceCodeUrl,
      sourceCodeLabel,
      video,
    });
  }

  return cards;
}

/** Extracts one section per talk from the Markdown alternate. */
function readMarkdownTalks(markdown) {
  const [preamble, ...sections] = markdown.split(/^## /m);

  if (!preamble.startsWith(`# ${TALKS_DOCUMENT_TITLE}\n`)) {
    fail("the Talks Markdown document has no level-one Talks heading.");
  }

  return sections.map((section) => {
    const lines = section.split(/\r?\n/);
    const title = unescapeMarkdown(lines[0]);

    const field = (name) => {
      const matches = lines.filter((line) => line.startsWith(`${name}: `));
      if (matches.length > 1) {
        fail(`Markdown section "${title}" repeats the ${name} field.`);
      }
      return matches.length === 0 ? null : matches[0].slice(name.length + 2);
    };

    const requiredField = (name) => {
      const value = field(name);
      if (value === null) {
        fail(`Markdown section "${title}" has no ${name} field.`);
      }
      return value;
    };

    const event = /^\[([\s\S]*)\]\(<([\s\S]*)>\)$/.exec(requiredField("Event"));
    if (event === null) {
      fail(`Markdown section "${title}" has no event link.`);
    }

    const date = /^([\s\S]+) \((\d{4}-\d{2}-\d{2})\)$/.exec(
      requiredField("Date"),
    );
    if (date === null) {
      fail(`Markdown section "${title}" has no formatted date.`);
    }

    const slides = /^<([\s\S]*)>$/.exec(requiredField("Slides"));
    if (slides === null) {
      fail(`Markdown section "${title}" has no slide-deck link.`);
    }

    const rawVideo = field("Video");
    const video = rawVideo === null ? null : /^<([\s\S]*)>$/.exec(rawVideo);
    if (rawVideo !== null && video === null) {
      fail(`Markdown section "${title}" has a malformed video link.`);
    }

    const rawSourceCode = field("Source code");
    const sourceCode =
      rawSourceCode === null ? null : /^<([\s\S]*)>$/.exec(rawSourceCode);
    if (rawSourceCode !== null && sourceCode === null) {
      fail(`Markdown section "${title}" has a malformed source-code link.`);
    }

    return {
      title,
      eventName: unescapeMarkdown(event[1]),
      eventUrl: event[2],
      displayDate: unescapeMarkdown(date[1]),
      date: date[2],
      location: unescapeMarkdown(requiredField("Location")),
      eventTypes: unescapeMarkdown(requiredField("Event types")),
      slideUrl: slides[1],
      videoUrl: video === null ? null : video[1],
      sourceCodeUrl: sourceCode === null ? null : sourceCode[1],
    };
  });
}

/* ---------------------------------------------------------------------------
 * Checks
 * ------------------------------------------------------------------------ */

/** Document-level contract of the canonical Talks page. */
function verifyTalksDocument(html) {
  if (countOccurrences(html, `<title>${TALKS_DOCUMENT_TITLE}</title>`) !== 1) {
    fail(`the Talks page does not set the document title to exactly "Talks".`);
  }

  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  if (headings.length !== 1) {
    fail("the Talks page does not render exactly one level-one heading.");
  }
  if (htmlText(headings[0][1]) !== TALKS_DOCUMENT_TITLE) {
    fail(`the Talks level-one heading is not exactly "Talks".`);
  }

  const canonical = [
    ...html.matchAll(/<link\b[^>]*rel="canonical"[^>]*>/g),
  ].map((match) => attribute(match[0], "href"));
  if (canonical.length !== 1 || canonical[0] !== TALKS_CANONICAL_URL) {
    fail(
      `the Talks page must declare exactly one canonical URL, ${TALKS_CANONICAL_URL}.`,
    );
  }

  const alternates = [...html.matchAll(/<link\b[^>]*rel="alternate"[^>]*>/g)]
    .filter((match) => attribute(match[0], "type") === "text/markdown")
    .map((match) => attribute(match[0], "href"));
  if (alternates.length !== 1 || alternates[0] !== TALKS_MARKDOWN_HREF) {
    fail(
      `the Talks page must advertise exactly one Markdown alternate, ${TALKS_MARKDOWN_HREF}.`,
    );
  }
}

/** The approved output when the published collection contains no talks. */
function verifyEmptyTalksOutput(markup, markdown, markdownSections) {
  const empty = [
    ...markup.matchAll(
      /<p\b[^>]*\bdata-talks-empty(?=[\s>])[^>]*>([\s\S]*?)<\/p>/g,
    ),
  ];
  if (empty.length !== 1 || htmlText(empty[0][1]) !== TALKS_EMPTY_MESSAGE) {
    fail(
      `an empty archive must present exactly one "${TALKS_EMPTY_MESSAGE}" message.`,
    );
  }
  if (/data-talks-result(?=[\s>])/.test(markup)) {
    fail("an empty archive must present no talk result summary.");
  }
  if (/data-talks-filter(?=[\s>])/.test(markup)) {
    fail("an empty archive must present no unusable filter controls.");
  }

  if (markdownSections.length !== 0) {
    fail(
      "the Talks Markdown document must contain no entry when none is published.",
    );
  }
  if (!markdown.includes(TALKS_EMPTY_MESSAGE)) {
    fail(
      `the Talks Markdown document must state "${TALKS_EMPTY_MESSAGE}" when none is published.`,
    );
  }
}

/** Every published record appears in both representations, and no draft does. */
function verifyTalksPublication(sourceTalks, cards) {
  const published = sourceTalks.filter((talk) => !talk.draft);

  const fingerprint = (talk) =>
    JSON.stringify([
      talk.title,
      talk.eventName,
      talk.eventUrl,
      talk.date,
      talk.location,
      talk.eventTypes,
      talk.slides,
      talk.videoUrl,
      talk.sourceCodeUrl,
    ]);

  const expected = published.map(fingerprint).sort();
  const actual = cards
    .map((card) =>
      fingerprint({
        title: card.title,
        eventName: card.eventName,
        eventUrl: card.eventUrl,
        date: card.date,
        location: card.location,
        eventTypes: card.eventTypes,
        slides: card.slidePath,
        videoUrl: card.video === null ? null : card.video.sourceUrl,
        sourceCodeUrl: card.sourceCodeUrl,
      }),
    )
    .sort();

  if (expected.length !== actual.length) {
    fail(
      `the archive renders ${actual.length} talk entries but ${expected.length} records are published.`,
    );
  }

  for (const [index, value] of expected.entries()) {
    if (actual[index] !== value) {
      fail(
        `the archive does not present the published records exactly once each: ${value}`,
      );
    }
  }

  const ids = new Set(cards.map((card) => card.id));
  if (ids.size !== cards.length) {
    fail("the archive renders a duplicated talk entry identifier.");
  }

  return published;
}

/** No draft record contributes text, link, or asset to any public output. */
function verifyDraftExclusion(sourceTalks, documents) {
  for (const talk of sourceTalks.filter((talk) => talk.draft)) {
    const values = [talk.title, talk.eventUrl, talk.slides];
    if (talk.videoUrl !== null) values.push(talk.videoUrl);
    if (talk.sourceCodeUrl !== null) values.push(talk.sourceCodeUrl);

    for (const [name, content] of documents) {
      for (const value of values) {
        if (content.includes(value)) {
          fail(`draft record ${talk.file} leaked "${value}" into ${name}.`);
        }
      }
    }
  }
}

/** Newest-first ordering, exact display form, and per-entry occurrence rules. */
function verifyTalksArchive(cards) {
  let previous = null;

  for (const card of cards) {
    if (previous !== null && card.date > previous) {
      fail(
        "talk entries are not ordered from the latest date to the earliest.",
      );
    }
    previous = card.date;

    if (card.displayDate !== expectedDisplayDate(card.date)) {
      fail(
        `talk entry ${card.id} displays "${card.displayDate}" instead of "${expectedDisplayDate(card.date)}".`,
      );
    }

    if (new Set(card.eventTypes).size !== card.eventTypes.length) {
      fail(`talk entry ${card.id} repeats an event-type tag.`);
    }

    if (
      !card.slidesLabel.includes("PDF slides") ||
      !card.slidesLabel.includes(card.title)
    ) {
      fail(
        `talk entry ${card.id} has a slide-deck label without both the talk title and "PDF slides".`,
      );
    }

    if (!card.slidePath.startsWith(TALKS_SLIDE_PREFIX)) {
      fail(
        `talk entry ${card.id} links slides outside ${TALKS_SLIDE_PREFIX}: ${card.slidePath}`,
      );
    }

    if (card.video !== null) {
      const embed = new URL(card.video.embedUrl);
      if (
        embed.protocol !== "https:" ||
        embed.hostname !== YOUTUBE_EMBED_HOST
      ) {
        fail(
          `talk entry ${card.id} embeds video from ${embed.host} instead of ${YOUTUBE_EMBED_HOST}.`,
        );
      }
    }

    if (card.sourceCodeUrl !== null) {
      if (
        !card.sourceCodeLabel.includes("Source code") ||
        !card.sourceCodeLabel.includes(card.title)
      ) {
        fail(
          `talk entry ${card.id} has a source-code label without both the talk title and "Source code".`,
        );
      }

      let source;
      try {
        source = new URL(card.sourceCodeUrl);
      } catch {
        fail(`talk entry ${card.id} has a malformed source-code URL.`);
      }
      if (source.protocol !== "https:" || source.hostname !== "github.com") {
        fail(
          `talk entry ${card.id} links source code from ${source.host} instead of github.com.`,
        );
      }
    }
  }
}

/** Both representations describe the same ordered public metadata. */
function verifyRepresentationEquivalence(cards, sections) {
  if (cards.length !== sections.length) {
    fail(
      `the archive renders ${cards.length} talk entries but the Markdown document has ${sections.length} sections.`,
    );
  }

  for (const [index, card] of cards.entries()) {
    const section = sections[index];
    const label = `Markdown section ${index + 1} ("${section.title}")`;

    const equivalent = [
      ["title", card.title, section.title],
      ["event name", card.eventName, section.eventName],
      [
        "event URL",
        normalizeUrl(card.eventUrl),
        normalizeUrl(section.eventUrl),
      ],
      ["date", card.date, section.date],
      ["displayed date", card.displayDate, section.displayDate],
      ["location", card.location, section.location],
      ["event types", card.eventTypes.join(", "), section.eventTypes],
      [
        "slide URL",
        normalizeUrl(`${SITE_ORIGIN}${card.slidePath}`),
        normalizeUrl(section.slideUrl),
      ],
    ];

    for (const [field, expected, actual] of equivalent) {
      if (expected !== actual) {
        fail(
          `${label} has ${field} "${actual}" but the archive has "${expected}".`,
        );
      }
    }

    const htmlVideo =
      card.video === null ? null : normalizeUrl(card.video.sourceUrl);
    const markdownVideo =
      section.videoUrl === null ? null : normalizeUrl(section.videoUrl);

    if (htmlVideo !== markdownVideo) {
      fail(
        `${label} ${markdownVideo === null ? "omits" : `links video ${markdownVideo} for`} a talk the archive ${htmlVideo === null ? "renders without a video" : `presents with ${htmlVideo}`}.`,
      );
    }

    const htmlSource =
      card.sourceCodeUrl === null ? null : normalizeUrl(card.sourceCodeUrl);
    const markdownSource =
      section.sourceCodeUrl === null
        ? null
        : normalizeUrl(section.sourceCodeUrl);

    if (htmlSource !== markdownSource) {
      fail(
        `${label} ${markdownSource === null ? "omits" : `links source code ${markdownSource} for`} a talk the archive ${htmlSource === null ? "renders without source code" : `presents with ${htmlSource}`}.`,
      );
    }

    if (!section.slideUrl.startsWith(`${SITE_ORIGIN}${TALKS_SLIDE_PREFIX}`)) {
      fail(
        `${label} hosts slides outside ${SITE_ORIGIN}${TALKS_SLIDE_PREFIX}: ${section.slideUrl}`,
      );
    }
  }
}

/**
 * Published slides are non-empty PDF files under `dist`, one per talk.
 *
 * The mapping is one-to-one in both directions: every published entry links its
 * own deck, and every published file belongs to a talk record. A record the
 * Author is still holding back keeps its staged asset, which Astro copies with
 * the rest of `public/`, so a draft's deck is an accounted-for file rather than
 * an orphan; nothing links it from a public representation.
 */
async function verifyTalkSlides(cards, sourceTalks) {
  const slideDirectory = path.join("dist", "talks", "slides");
  const referenced = new Set();
  const staged = new Set(
    sourceTalks.filter((talk) => talk.draft).map((talk) => talk.slides),
  );

  for (const card of cards) {
    if (referenced.has(card.slidePath)) {
      fail(`slide deck ${card.slidePath} is referenced by more than one talk.`);
    }
    referenced.add(card.slidePath);

    const filePath = path.join("dist", ...card.slidePath.split("/"));
    const relative = path.relative(slideDirectory, filePath);
    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      fail(`slide deck ${card.slidePath} resolves outside ${slideDirectory}.`);
    }

    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      fail(`slide deck ${card.slidePath} is missing from the build output.`);
    }
    if (!stats.isFile() || stats.size === 0) {
      fail(`slide deck ${card.slidePath} is not a non-empty file.`);
    }

    const header = await readFile(filePath);
    if (
      !header
        .subarray(0, PDF_SIGNATURE.length)
        .toString("latin1")
        .startsWith(PDF_SIGNATURE)
    ) {
      fail(`slide deck ${card.slidePath} is not served as a PDF document.`);
    }
  }

  let built = [];
  try {
    built = await readdir(slideDirectory, {
      recursive: true,
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (referenced.size > 0) {
      fail(
        `${slideDirectory} is missing although talks reference slide decks.`,
      );
    }
    return referenced;
  }

  for (const entry of built) {
    if (!entry.isFile()) continue;

    const filePath = path.join(entry.parentPath ?? slideDirectory, entry.name);
    const publicPath = `/${path.relative("dist", filePath).split(path.sep).join("/")}`;
    if (!referenced.has(publicPath) && !staged.has(publicPath)) {
      fail(`${publicPath} is published but no talk record references it.`);
    }
  }

  return referenced;
}

/** Discovery documents carry the canonical Talks representation exactly once. */
function verifyTalksDiscovery(sitemap, llms, llmsFull, talksMarkdown) {
  const locations = [...sitemap.matchAll(/<loc>([\s\S]*?)<\/loc>/g)]
    .map(([, value]) => decodeHtml(value))
    .filter((value) => value.startsWith(`${SITE_ORIGIN}/talks`));

  if (locations.length !== 1 || locations[0] !== TALKS_CANONICAL_URL) {
    fail(
      `sitemap.xml must list ${TALKS_CANONICAL_URL} exactly once and no other Talks URL.`,
    );
  }

  const advertised = [
    ...llms.matchAll(/https:\/\/salih\.dev\/talks[^\s)\]]*/g),
  ].map(([value]) => value);
  if (advertised.length !== 1 || advertised[0] !== TALKS_CANONICAL_URL) {
    fail(
      `llms.txt must reference ${TALKS_CANONICAL_URL} exactly once and no non-canonical Talks URL.`,
    );
  }
  if (!llms.includes(`- [Talks](${TALKS_CANONICAL_URL})`)) {
    fail("llms.txt must list Talks as a core page link.");
  }

  const document = talksMarkdown.trim();
  if (countOccurrences(llmsFull, document) !== 1) {
    fail(
      "llms-full.txt must contain the Talks Markdown document exactly once.",
    );
  }
  if (countOccurrences(llmsFull, `# ${TALKS_DOCUMENT_TITLE}\n`) !== 1) {
    fail("llms-full.txt must contain exactly one Talks document heading.");
  }
}

const sourceTalks = await readSourceTalks();
const talksHtml = await readFile(
  path.join("dist", "talks", "index.html"),
  "utf8",
);
const talksMarkdown = await readFile(
  path.join("dist", "talks", "index.md"),
  "utf8",
);

if (talksMarkdown.trim() === "") {
  fail("the Talks Markdown document is empty and cannot be retrieved.");
}

// Markup checks read the rendered document; the leak check below still reads
// the whole file, including scripts and styles.
const talksMarkup = documentMarkup(talksHtml);

verifyTalksDocument(talksMarkup);

const talkCards = readHtmlTalks(talksMarkup);
const talkSections = readMarkdownTalks(talksMarkdown);
const publishedTalks = verifyTalksPublication(sourceTalks, talkCards);

if (publishedTalks.length === 0) {
  verifyEmptyTalksOutput(talksMarkup, talksMarkdown, talkSections);
}

verifyTalksArchive(talkCards);
verifyRepresentationEquivalence(talkCards, talkSections);

const slideDecks = await verifyTalkSlides(talkCards, sourceTalks);

const sitemap = await readFile(path.join("dist", "sitemap.xml"), "utf8");
const llms = await readFile(path.join("dist", "llms.txt"), "utf8");
const llmsFull = await readFile(path.join("dist", "llms-full.txt"), "utf8");

verifyTalksDiscovery(sitemap, llms, llmsFull, talksMarkdown);
verifyDraftExclusion(sourceTalks, [
  ["dist/talks/index.html", talksHtml],
  ["dist/talks/index.md", talksMarkdown],
  ["dist/sitemap.xml", sitemap],
  ["dist/llms.txt", llms],
  ["dist/llms-full.txt", llmsFull],
]);

console.log(
  `Verified ${requiredFiles.length} discovery files and ${postDirectories.length} post representation pairs.`,
);
console.log(
  `Verified the Talks archive: ${publishedTalks.length} published talks, ${slideDecks.size} slide decks, and both canonical representations.`,
);
