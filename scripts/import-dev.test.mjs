import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildMarkdown,
  categoryForTags,
  metadataForArticle,
  syncDev,
} from "./import-dev.mjs";

test("maps common DEV tags to site categories", () => {
  assert.equal(categoryForTags(["flutter", "aws"]), "Flutter");
  assert.equal(categoryForTags("webdev, astro"), "Web Development");
  assert.equal(categoryForTags(["unmapped"]), "Software Development");
});

test("uses DEV descriptions for new article summaries", () => {
  const metadata = metadataForArticle({
    id: 999999999,
    description: "A reviewed-quality description from DEV.",
    tags: ["serverless"],
  });

  assert.deepEqual(metadata, {
    category: "Serverless",
    summary: "A reviewed-quality description from DEV.",
  });
});

test("writes AWS-hosted banners and original source metadata", () => {
  const markdown = buildMarkdown(
    {
      id: 999999999,
      title: "Static Astro on AWS",
      body_markdown: "# Body",
      published_at: "2026-07-27T12:00:00Z",
      edited_at: null,
      tags: ["astro", "aws"],
      url: "https://dev.to/salihgueler/static-astro-on-aws",
    },
    {
      category: "Web Development",
      summary: "A static site migration.",
    },
    "https://salih.dev/images/blog/999999999-static-astro-on-aws.webp",
  );

  assert.match(
    markdown,
    /src: "https:\/\/salih\.dev\/images\/blog\/999999999-static-astro-on-aws\.webp"/,
  );
  assert.match(
    markdown,
    /originalUrl: "https:\/\/dev\.to\/salihgueler\/static-astro-on-aws"/,
  );
  assert.match(markdown, /category: "Web Development"/);
});

test("syncs a new article once and reuses its manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "salih-dev-sync-"));
  const calls = [];
  const published = "2026-07-27T12:00:00Z";
  const article = {
    id: 999999999,
    body_markdown: "# Body",
    cover_image: "https://images.example/banner.png",
    description: "A static site migration.",
    edited_at: null,
    published_at: published,
    published_timestamp: published,
    slug: "static-astro-on-aws",
    tags: ["astro", "aws"],
    title: "Static Astro on AWS",
    url: "https://dev.to/salihgueler/static-astro-on-aws",
  };
  const fetchImpl = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value === article.cover_image) {
      return new Response(Buffer.from("test-image"), {
        headers: { "Content-Type": "image/png" },
      });
    }
    if (value.endsWith(`/articles/${article.id}`)) {
      return Response.json(article);
    }
    return Response.json([
      {
        id: article.id,
        edited_at: article.edited_at,
        published_at: article.published_at,
        published_timestamp: article.published_timestamp,
        slug: article.slug,
      },
    ]);
  };
  const options = {
    assetDirectory: path.join(directory, "assets"),
    fetchImpl,
    manifestPath: path.join(directory, "state", "manifest.json"),
    outputDirectory: path.join(directory, "posts"),
  };

  try {
    assert.deepEqual(await syncDev(options), {
      listed: 1,
      updated: 1,
      removed: 0,
      unchanged: 0,
    });
    const markdown = await readFile(
      path.join(options.outputDirectory, `${article.slug}.md`),
      "utf8",
    );
    assert.match(
      markdown,
      /https:\/\/salih\.dev\/images\/blog\/999999999-static-astro-on-aws\.png/,
    );
    await access(
      path.join(
        options.assetDirectory,
        "999999999-static-astro-on-aws.png",
      ),
    );

    calls.length = 0;
    assert.deepEqual(await syncDev(options), {
      listed: 1,
      updated: 0,
      removed: 0,
      unchanged: 1,
    });
    assert.equal(calls.length, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
