import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const username = "salihgueler";
const outputDirectory = path.resolve("src/content/blog");
const apiBase = "https://dev.to/api";

const metadata = new Map([
  [
    3969438,
    {
      category: "AWS Blocks",
      summary:
        "Build a custom AWS Block that wraps Google Maps, supports offline local development, and powers a geography guessing game that deploys unchanged to AWS.",
    },
  ],
  [
    3929764,
    {
      category: "AWS Blocks",
      summary:
        "Create a full-stack World Cup bracket picker with AWS Blocks, combining authentication, structured data, real-time updates, scheduled jobs, and an AI agent.",
    },
  ],
  [
    3500211,
    {
      category: "Serverless",
      summary:
        "Use AI-assisted specification generation to drive test-first development for serverless APIs, from OpenAPI contracts and unit tests through cloud integration testing.",
    },
  ],
  [
    3405099,
    {
      category: "Web Development",
      summary:
        "Compare hydration strategies and show how Jaspr synchronizes server-rendered component state with the client without manual serialization.",
    },
  ],
  [
    3177666,
    {
      category: "AI Development",
      summary:
        "Package React and Next.js best practices as a Kiro Power, then use it to audit AI-generated frontend code.",
    },
  ],
  [
    2815369,
    {
      category: "Mobile",
      summary:
        "Build a real-time multiplayer Android quiz app with Kotlin and AWS AppSync Events API, including infrastructure, events, and game-state synchronization.",
    },
  ],
  [
    2644682,
    {
      category: "Flutter",
      summary:
        "Build an MCP server for the Flutter Flame engine that gives coding assistants contextual documentation, examples, and game-development support.",
    },
  ],
  [
    2485246,
    {
      category: "Dart",
      summary:
        "Use Amazon Q Developer CLI to containerize and deploy Dart backend applications to AWS, covering REST APIs and WebSocket workloads.",
    },
  ],
  [
    2391884,
    {
      category: "Generative AI",
      summary:
        "Build a voice-based AI podcast co-host with Amazon Q CLI, Amazon Nova Sonic, Next.js, and bidirectional streaming through Amazon Bedrock.",
    },
  ],
  [
    1743661,
    {
      category: "Flutter",
      summary:
        "Build a personalized Flutter quiz game using AWS Amplify Gen 2, API Gateway, Lambda, and Amazon Bedrock.",
    },
  ],
]);

const list = await fetchJson(
  `${apiBase}/articles?username=${username}&per_page=1000`,
);
const articles = [];

for (const item of list) {
  articles.push(await fetchJson(`${apiBase}/articles/${item.id}`));
}

await mkdir(outputDirectory, { recursive: true });

for (const article of articles) {
  const details = metadata.get(article.id);
  if (!details) {
    throw new Error(
      `Article ${article.id} has no reviewed category and summary metadata.`,
    );
  }

  const markdown = buildMarkdown(article, details);
  const outputPath = path.join(outputDirectory, `${article.slug}.md`);
  await writeFile(outputPath, markdown, "utf8");
  console.log(`Imported ${article.slug}`);
}

console.log(`Imported ${articles.length} published DEV articles.`);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.forem.api-v1+json",
      "User-Agent": "salih.dev DEV importer",
    },
  });

  if (!response.ok) {
    throw new Error(`DEV request failed (${response.status}): ${url}`);
  }

  return response.json();
}

function buildMarkdown(article, details) {
  const body = normalizeBody(article.body_markdown, article.title);
  const tags = Array.isArray(article.tags)
    ? article.tags
    : String(article.tag_list ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
  const updatedDate =
    article.edited_at && article.edited_at !== article.published_at
      ? `updatedDate: ${quote(article.edited_at)}\n`
      : "";
  const cover = article.cover_image ?? article.social_image;

  if (!cover) {
    throw new Error(`Article ${article.id} does not have a cover image.`);
  }

  return `---
title: ${quote(article.title)}
description: ${quote(details.summary)}
pubDate: ${quote(article.published_at)}
${updatedDate}category: ${quote(details.category)}
tags: ${JSON.stringify(tags)}
hero:
  src: ${quote(cover)}
  alt: ${quote(`Cover image for ${article.title}`)}
  credit: ${quote("DEV Community")}
  creditUrl: ${quote(article.url)}
aiSummary: ${quote(details.summary)}
sources: ${JSON.stringify([{ name: "DEV Community", url: article.url }])}
draft: false
---

${body.trim()}
`;
}

function normalizeBody(markdown, title) {
  let videoIndex = 0;

  return markdown
    .replaceAll("\r\n", "\n")
    .replace(/^```Dockerfile\s*$/gm, "```dockerfile")
    .replace(
      /\{% (?:embed|youtube) (https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})) %\}/g,
      (_, _url, id) => {
        videoIndex += 1;
        return `::youtube{id="${id}" title="${escapeDirectiveAttribute(title)} video ${videoIndex}"}`;
      },
    )
    .replace(/\]\(\s+(https?:\/\/)/g, "]($1")
    .replace("](go_router)", "](https://pub.dev/packages/go_router)")
    .replace(
      "](console.aws.amazon.com/apigateway)",
      "](https://console.aws.amazon.com/apigateway)",
    )
    .replace(
      /\[AWS Account\]\(http:\/\/\?[^)]*\)/g,
      "[AWS Account](https://aws.amazon.com/free/)",
    )
    .replace(
      /\[configured\]\(http:\/\/\?[^)]*\)/g,
      "[configured](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)",
    )
    .replace(
      /\[AWS CDK v2\]\(http:\/\/\?[^)]*\)/g,
      "[AWS CDK v2](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html)",
    );
}

function quote(value) {
  return JSON.stringify(value);
}

function escapeDirectiveAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
