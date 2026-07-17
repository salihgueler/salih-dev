import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { XMLParser } from "fast-xml-parser";
import { parseFragment, serialize } from "parse5";
import TurndownService from "turndown";

const username = "salihgueler";
const feedUrl = `https://medium.com/feed/@${username}`;
const outputDirectory = path.resolve("src/content/blog");

const metadata = new Map([
  [
    "68a3e4399716",
    {
      category: "Flutter",
      summary:
        "Deploy a Flutter web application from a Git repository with AWS Amplify Hosting and a custom Flutter build configuration.",
    },
  ],
  [
    "18e56d2a110",
    {
      category: "Flutter",
      summary:
        "Add time-based one-time password authentication to a Flutter application with AWS Amplify for a stronger sign-in flow.",
    },
  ],
  [
    "e339160cc1a2",
    {
      category: "Dart",
      summary:
        "Explore how Dart records, pattern matching, and sealed classes work together to model data and control flow more expressively.",
    },
  ],
  [
    "d8122ce1a9d4",
    {
      category: "Flutter",
      summary:
        "Build authentication flows that work across Flutter mobile and web applications using AWS Amplify.",
    },
  ],
  [
    "d53ba213767",
    {
      category: "Flutter",
      summary:
        "Deploy Flutter web applications to AWS Amplify Hosting through an automated GitHub Actions workflow.",
    },
  ],
  [
    "18012bb6fb18",
    {
      category: "Flutter",
      summary:
        "Complete an AWS Amplify SMS authentication flow in Flutter by implementing phone-number sign-in.",
    },
  ],
  [
    "d62858f9ebc7",
    {
      category: "Flutter",
      summary:
        "Implement phone-number sign-up and SMS verification in Flutter with AWS Amplify authentication.",
    },
  ],
  [
    "5197b77317a6",
    {
      category: "Flutter",
      summary:
        "Create a Flutter project, initialize AWS Amplify, and prepare the application for an SMS authentication flow.",
    },
  ],
  [
    "ef748798fdbf",
    {
      category: "Flutter",
      summary:
        "Set up an AWS account and the Amplify CLI as the foundation for SMS authentication in a Flutter application.",
    },
  ],
]);

const feed = await fetchText(feedUrl);
const parser = new XMLParser({
  cdataPropName: "#cdata",
  ignoreAttributes: false,
  processEntities: true,
});
const data = parser.parse(feed);
const items = asArray(data.rss?.channel?.item);
const existingPosts = await readExistingPosts();
let imported = 0;
let merged = 0;

for (const item of items) {
  const title = cleanText(textValue(item.title));
  const sourceUrl = cleanSourceUrl(textValue(item.link));
  const id = mediumId(item, sourceUrl);
  const existing = existingPosts.find(
    (post) => normalizeTitle(post.title) === normalizeTitle(title),
  );

  if (!metadata.has(id) && !existing) {
    throw new Error(
      `Medium article ${id} has no reviewed category and summary metadata.`,
    );
  }

  if (existing && existing.file !== `${slugFromUrl(sourceUrl)}.md`) {
    const changed = await addSource(existing.path, {
      name: "Medium",
      url: sourceUrl,
    });
    if (changed) {
      console.log(`Merged Medium source into ${existing.file}`);
      merged += 1;
    } else {
      console.log(`Skipped duplicate ${title}`);
    }
    continue;
  }

  const details = metadata.get(id);
  if (!details) {
    throw new Error(`Missing metadata for Medium article ${id}.`);
  }

  const markdown = buildMarkdown(item, details, sourceUrl);
  const outputPath = path.join(outputDirectory, `${slugFromUrl(sourceUrl)}.md`);
  await writeFile(outputPath, markdown, "utf8");
  console.log(`Imported ${slugFromUrl(sourceUrl)}`);
  imported += 1;
}

console.log(
  `Imported ${imported} Medium articles and merged ${merged} duplicate source.`,
);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/xml;q=0.9",
      "User-Agent": "salih.dev Medium importer",
    },
  });

  if (!response.ok) {
    throw new Error(`Medium request failed (${response.status}): ${url}`);
  }

  return response.text();
}

async function readExistingPosts() {
  const files = (await readdir(outputDirectory)).filter((file) =>
    file.endsWith(".md"),
  );

  return Promise.all(
    files.map(async (file) => {
      const filePath = path.join(outputDirectory, file);
      const markdown = await readFile(filePath, "utf8");
      const rawTitle = markdown.match(/^title:\s*(.+)$/m)?.[1];
      if (!rawTitle) {
        throw new Error(`Could not read title from ${file}.`);
      }

      return {
        file,
        path: filePath,
        title: JSON.parse(rawTitle),
      };
    }),
  );
}

function buildMarkdown(item, details, sourceUrl) {
  const title = cleanText(textValue(item.title));
  const publishedAt = new Date(item.pubDate).toISOString();
  const updatedAt = new Date(textValue(item["atom:updated"]) || item.pubDate);
  const bodyHtml = textValue(item["content:encoded"]);
  const { body, hero } = htmlToMarkdown(bodyHtml, title);
  const tags = asArray(item.category)
    .map((tag) => cleanText(textValue(tag)))
    .filter(Boolean);
  const updatedDate =
    updatedAt.getTime() !== new Date(publishedAt).getTime()
      ? `updatedDate: ${quote(updatedAt.toISOString())}\n`
      : "";

  return `---
title: ${quote(title)}
description: ${quote(details.summary)}
pubDate: ${quote(publishedAt)}
${updatedDate}category: ${quote(details.category)}
tags: ${JSON.stringify(tags)}
hero:
  src: ${quote(hero.src)}
  alt: ${quote(hero.alt || `Cover image for ${title}`)}
  credit: ${quote("Medium")}
  creditUrl: ${quote(sourceUrl)}
aiSummary: ${quote(details.summary)}
sources: ${JSON.stringify([{ name: "Medium", url: sourceUrl }])}
draft: false
---

${body}
`;
}

function htmlToMarkdown(html, title) {
  const fragment = parseFragment(
    html.replaceAll("\u00a0", " ").replaceAll("\u200a", " "),
  );
  removeMediumFooter(fragment);
  removeTrackingImages(fragment);
  cleanMediumLinks(fragment);

  const heroImage = findFirst(
    fragment,
    (node) =>
      node.tagName === "img" &&
      !attribute(node, "src")?.includes("medium.com/_/stat"),
  );

  if (!heroImage) {
    throw new Error(`Medium article "${title}" does not have an image.`);
  }

  const hero = {
    src: attribute(heroImage, "src"),
    alt: attribute(heroImage, "alt") || "",
  };
  const heroContainer =
    heroImage.parentNode?.tagName === "figure"
      ? heroImage.parentNode
      : heroImage;
  removeNode(heroContainer);

  const turndown = createTurndown();
  const body = turndown
    .turndown(serialize(fragment))
    .replaceAll("\u00a0", " ")
    .replaceAll("\u200a", " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { body, hero };
}

function createTurndown() {
  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    headingStyle: "atx",
  });

  turndown.addRule("mediumHeadings", {
    filter: ["h2", "h3", "h4"],
    replacement(content, node) {
      const level = node.nodeName === "H4" ? 3 : 2;
      return `\n\n${"#".repeat(level)} ${content.trim()}\n\n`;
    },
  });

  turndown.addRule("preformattedCode", {
    filter: "pre",
    replacement(_content, node) {
      const code = nodeText(node).replace(/\n+$/, "");
      return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
    },
  });

  turndown.addRule("embeddedMedia", {
    filter: "iframe",
    replacement(_content, node) {
      const rawSource = node.getAttribute("src");
      if (!rawSource) return "";

      const source = embeddedSource(rawSource);
      const youtubeId = youtubeVideoId(source);
      if (youtubeId) {
        return `\n\n::youtube{id="${youtubeId}" title="Embedded video"}\n\n`;
      }

      return source ? `\n\n[View embedded media](${source})\n\n` : "";
    },
  });

  return turndown;
}

function removeMediumFooter(fragment) {
  const children = fragment.childNodes ?? [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const node = children[index];
    if (
      node.tagName === "p" &&
      nodeText(node).includes("was originally published")
    ) {
      const previous = children[index - 1];
      const start = previous?.tagName === "hr" ? index - 1 : index;
      children.splice(start);
      return;
    }
  }
}

function removeTrackingImages(node) {
  for (const child of [...(node.childNodes ?? [])]) {
    if (
      child.tagName === "img" &&
      (attribute(child, "src")?.includes("medium.com/_/stat") ||
        (attribute(child, "width") === "1" &&
          attribute(child, "height") === "1"))
    ) {
      removeNode(child);
      continue;
    }
    removeTrackingImages(child);
  }
}

function cleanMediumLinks(node) {
  if (node.tagName === "a") {
    const href = attribute(node, "href");
    if (href) {
      try {
        const url = new URL(href);
        if (url.hostname === "medium.com" || url.hostname.endsWith(".medium.com")) {
          url.searchParams.delete("source");
          setAttribute(node, "href", url.toString());
        }
      } catch {
        // Leave relative and malformed source links unchanged.
      }
    }
  }

  for (const child of node.childNodes ?? []) {
    cleanMediumLinks(child);
  }
}

async function addSource(filePath, source) {
  const markdown = await readFile(filePath, "utf8");
  const sourcesMatch = markdown.match(/^sources:\s*(\[.*\])$/m);
  const sources = sourcesMatch ? JSON.parse(sourcesMatch[1]) : [];

  if (sources.some((entry) => entry.url === source.url)) {
    return false;
  }

  sources.push(source);
  const next = sourcesMatch
    ? markdown.replace(/^sources:\s*\[.*\]$/m, `sources: ${JSON.stringify(sources)}`)
    : markdown.replace(
        /^(aiSummary:.*)$/m,
        `$1\nsources: ${JSON.stringify(sources)}`,
      );
  await writeFile(filePath, next, "utf8");
  return true;
}

function findFirst(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.childNodes ?? []) {
    const match = findFirst(child, predicate);
    if (match) return match;
  }
  return null;
}

function removeNode(node) {
  const siblings = node.parentNode?.childNodes;
  const index = siblings?.indexOf(node) ?? -1;
  if (index >= 0) siblings.splice(index, 1);
}

function attribute(node, name) {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

function setAttribute(node, name, value) {
  const existing = node.attrs?.find((entry) => entry.name === name);
  if (existing) {
    existing.value = value;
  } else {
    node.attrs ??= [];
    node.attrs.push({ name, value });
  }
}

function nodeText(node) {
  if (node.nodeName === "#text") return node.value ?? "";
  if (node.tagName === "br") return "\n";
  return (node.childNodes ?? []).map(nodeText).join("");
}

function embeddedSource(rawSource) {
  try {
    const url = new URL(rawSource);
    return url.searchParams.get("url") ?? url.searchParams.get("src") ?? rawSource;
  } catch {
    return rawSource;
  }
}

function youtubeVideoId(value) {
  return value?.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  )?.[1];
}

function mediumId(item, sourceUrl) {
  const guid = textValue(item.guid);
  return (
    guid.match(/\/p\/([a-f0-9]+)$/i)?.[1] ??
    sourceUrl.match(/-([a-f0-9]+)$/i)?.[1] ??
    ""
  );
}

function slugFromUrl(value) {
  return new URL(value).pathname.split("/").filter(Boolean).at(-1);
}

function cleanSourceUrl(value) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function cleanText(value) {
  return value.replaceAll("\u00a0", " ").replaceAll("\u200a", " ").trim();
}

function normalizeTitle(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function textValue(value) {
  if (typeof value === "object" && value !== null) {
    return value["#cdata"] ?? value["#text"] ?? "";
  }
  return value ?? "";
}

function asArray(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function quote(value) {
  return JSON.stringify(value);
}
