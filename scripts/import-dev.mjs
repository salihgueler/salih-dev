import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const reviewedMetadata = new Map([
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

const categoryRules = [
  { tags: ["awsblocks", "aws-blocks"], category: "AWS Blocks" },
  { tags: ["serverless"], category: "Serverless" },
  { tags: ["flutter"], category: "Flutter" },
  { tags: ["dart"], category: "Dart" },
  { tags: ["android", "mobile"], category: "Mobile" },
  {
    tags: ["ai", "genai", "generativeai", "machinelearning"],
    category: "AI Development",
  },
  {
    tags: ["webdev", "javascript", "typescript", "react", "astro"],
    category: "Web Development",
  },
];

const imageExtensions = new Map([
  ["image/avif", "avif"],
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function syncDev(options = {}) {
  const username = options.username ?? process.env.DEV_USERNAME ?? "salihgueler";
  const apiBase =
    options.apiBase ?? process.env.DEV_API_BASE ?? "https://dev.to/api";
  const outputDirectory =
    options.outputDirectory ??
    process.env.DEV_OUTPUT_DIRECTORY ??
    path.resolve("src/content/blog");
  const assetDirectory =
    options.assetDirectory ??
    process.env.DEV_ASSET_DIRECTORY ??
    path.resolve("public/images/blog");
  const manifestPath =
    options.manifestPath ??
    process.env.DEV_MANIFEST_PATH ??
    path.resolve(".cache/dev-sync-manifest.json");
  const siteUrl = options.siteUrl ?? process.env.SITE_URL ?? "https://salih.dev";
  const fetchImpl = options.fetchImpl ?? fetch;

  await Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    mkdir(assetDirectory, { recursive: true }),
    mkdir(path.dirname(manifestPath), { recursive: true }),
  ]);

  const manifest = await readManifest(manifestPath, username);
  const listedArticles = await fetchArticleList(apiBase, username, fetchImpl);
  const publishedIds = new Set(listedArticles.map((article) => String(article.id)));
  let updated = 0;
  let removed = 0;
  let unchanged = 0;

  for (const item of listedArticles) {
    const id = String(item.id);
    const previous = manifest.articles[id];
    const version = articleVersion(item);
    const expectedPost = path.join(outputDirectory, `${item.slug}.md`);
    const expectedBanner = previous?.bannerFile
      ? path.join(assetDirectory, previous.bannerFile)
      : null;
    const localFilesExist =
      (await fileExists(expectedPost)) &&
      (!expectedBanner || (await fileExists(expectedBanner)));

    if (previous?.version === version && localFilesExist) {
      unchanged += 1;
      continue;
    }

    const article = await fetchJson(
      `${apiBase}/articles/${item.id}`,
      fetchImpl,
    );
    const metadata = metadataForArticle(article);
    const banner = await downloadBanner({
      article,
      assetDirectory,
      fetchImpl,
      siteUrl,
    });
    const markdown = buildMarkdown(article, metadata, banner.publicUrl);

    if (previous?.slug && previous.slug !== article.slug) {
      await rm(path.join(outputDirectory, `${previous.slug}.md`), {
        force: true,
      });
    }
    if (
      previous?.bannerFile &&
      previous.bannerFile !== banner.fileName
    ) {
      await rm(path.join(assetDirectory, previous.bannerFile), { force: true });
    }

    await writeAtomic(
      path.join(outputDirectory, `${article.slug}.md`),
      markdown,
    );
    manifest.articles[id] = {
      bannerFile: banner.fileName,
      slug: article.slug,
      sourceUrl: article.url,
      version: articleVersion(article),
    };
    updated += 1;
  }

  for (const [id, article] of Object.entries(manifest.articles)) {
    if (publishedIds.has(id)) continue;

    await Promise.all([
      rm(path.join(outputDirectory, `${article.slug}.md`), { force: true }),
      article.bannerFile
        ? rm(path.join(assetDirectory, article.bannerFile), { force: true })
        : Promise.resolve(),
    ]);
    delete manifest.articles[id];
    removed += 1;
  }

  if (updated > 0 || removed > 0 || !(await fileExists(manifestPath))) {
    await writeAtomic(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  return {
    listed: listedArticles.length,
    updated,
    removed,
    unchanged,
  };
}

async function fetchArticleList(apiBase, username, fetchImpl) {
  const articles = [];
  const perPage = 100;

  for (let page = 1; ; page += 1) {
    const url = new URL(`${apiBase}/articles`);
    url.searchParams.set("username", username);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    const batch = await fetchJson(url.toString(), fetchImpl);

    if (!Array.isArray(batch)) {
      throw new Error("DEV article list response was not an array.");
    }
    articles.push(...batch);
    if (batch.length < perPage) break;
  }

  return articles;
}

async function fetchJson(url, fetchImpl) {
  const response = await requestWithRetry(url, fetchImpl);
  return response.json();
}

async function requestWithRetry(
  url,
  fetchImpl,
  accept = "application/vnd.forem.api-v1+json",
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: accept,
        "User-Agent": "salih.dev DEV sync",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (response.ok) return response;
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`DEV request failed (${response.status}): ${url}`);
    }
    if (attempt === 3) {
      throw new Error(`DEV request failed after retries (${response.status}): ${url}`);
    }

    const retryAfter = Number.parseInt(
      response.headers.get("retry-after") ?? "",
      10,
    );
    const delay = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error(`DEV request failed: ${url}`);
}

async function downloadBanner({
  article,
  assetDirectory,
  fetchImpl,
  siteUrl,
}) {
  const sourceUrl = article.cover_image ?? article.social_image;
  if (!sourceUrl) {
    throw new Error(`Article ${article.id} does not have a banner image.`);
  }

  const response = await requestWithRetry(
    sourceUrl,
    fetchImpl,
    "image/avif,image/webp,image/*,*/*",
  );
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extension = imageExtensions.get(contentType);
  if (!extension) {
    throw new Error(
      `Article ${article.id} returned unsupported banner type ${contentType || "unknown"}.`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) {
    throw new Error(`Article ${article.id} banner exceeds 20 MB.`);
  }

  const fileName = `${article.id}-${article.slug}.${extension}`;
  await removeOtherBannerVersions(assetDirectory, article.id, fileName);
  await writeAtomic(path.join(assetDirectory, fileName), bytes);

  return {
    fileName,
    publicUrl: new URL(`/images/blog/${fileName}`, siteUrl).toString(),
  };
}

async function removeOtherBannerVersions(directory, articleId, keepFile) {
  const files = await readdir(directory);
  await Promise.all(
    files
      .filter(
        (file) => file.startsWith(`${articleId}-`) && file !== keepFile,
      )
      .map((file) => rm(path.join(directory, file), { force: true })),
  );
}

async function readManifest(manifestPath, username) {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    if (
      parsed.version !== 1 ||
      parsed.username !== username ||
      typeof parsed.articles !== "object" ||
      parsed.articles === null
    ) {
      throw new Error("DEV sync manifest has an unsupported format.");
    }
    return parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      version: 1,
      username,
      articles: {},
    };
  }
}

function articleVersion(article) {
  return (
    article.edited_at ??
    article.published_timestamp ??
    article.published_at ??
    String(article.id)
  );
}

export function metadataForArticle(article) {
  const reviewed = reviewedMetadata.get(article.id);
  if (reviewed) return reviewed;

  return {
    category: categoryForTags(article.tags ?? article.tag_list),
    summary: summaryForArticle(article),
  };
}

export function categoryForTags(value) {
  const tags = normalizeTags(value).map((tag) => tag.toLowerCase());
  return (
    categoryRules.find((rule) =>
      rule.tags.some((tag) => tags.includes(tag)),
    )?.category ?? "Software Development"
  );
}

function summaryForArticle(article) {
  const description = String(article.description ?? "").trim();
  if (description) return description;

  const plainText = String(article.body_markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plainText) {
    return `Read ${article.title} by Salih Güler.`;
  }
  return plainText.length <= 240
    ? plainText
    : `${plainText.slice(0, 237).trimEnd()}...`;
}

export function buildMarkdown(article, details, bannerUrl) {
  const body = normalizeBody(article.body_markdown, article.title);
  const tags = normalizeTags(article.tags ?? article.tag_list);
  const updatedDate =
    article.edited_at && article.edited_at !== article.published_at
      ? `updatedDate: ${quote(article.edited_at)}\n`
      : "";

  return `---
title: ${quote(article.title)}
description: ${quote(details.summary)}
pubDate: ${quote(article.published_at)}
${updatedDate}category: ${quote(details.category)}
tags: ${JSON.stringify(tags)}
hero:
  src: ${quote(bannerUrl)}
  alt: ${quote(`Cover image for ${article.title}`)}
  credit: ${quote("DEV Community")}
  creditUrl: ${quote(article.url)}
aiSummary: ${quote(details.summary)}
originalUrl: ${quote(article.url)}
sources: ${JSON.stringify([{ name: "DEV Community", url: article.url }])}
draft: false
---

${body.trim()}
`;
}

function normalizeTags(value) {
  return Array.isArray(value)
    ? value.map(String).map((tag) => tag.trim()).filter(Boolean)
    : String(value ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function normalizeBody(markdown, title) {
  let videoIndex = 0;

  return String(markdown ?? "")
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

async function writeAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, value);
  await rename(temporaryPath, filePath);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function quote(value) {
  return JSON.stringify(value);
}

function escapeDirectiveAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  syncDev()
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
