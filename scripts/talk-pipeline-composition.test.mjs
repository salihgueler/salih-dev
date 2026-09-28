import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  API_TALK_RECORD_SCHEMA_VERSION,
  serializeApiTalkRecord,
} from "../src/lib/talks/api-record.js";
import { deckSlidePath } from "../src/lib/talks/deck.js";
import { PDF_TEST_FIXTURES } from "../src/lib/talks/__fixtures__/pdf.js";
import {
  deriveTalkIdentity,
  deriveTalkRecordKey,
} from "../src/lib/talks/identity.js";
import { materializeApiTalks } from "./materialize-api-talks.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const EDITOR_ARN = "arn:aws:iam::123456789012:root";
const CONTENT_BUCKET = "local-pipeline-content";
const PUBLISHER_PROJECT = "local-pipeline-publisher";
const API_PUBLISHED_DECK_ID = "10000000-0000-4000-8000-000000000001";
const API_DRAFT_DECK_ID = "20000000-0000-4000-8000-000000000002";
const UNREFERENCED_DECK_ID = "30000000-0000-4000-8000-000000000003";
const API_PUBLISHED_ETAG = '"api-published-version"';
const STALE_ETAG = '"stale-version"';

const GIT_PUBLISHED = Object.freeze({
  title: "Git Published Talk",
  eventName: "Repository Conference",
  date: "2026-05-10",
  location: "Berlin, Germany",
  eventUrl: "https://events.example/git-published",
  eventTypes: Object.freeze(["Conference"]),
  slides: "/talks/slides/git-published.pdf",
  draft: false,
});

const GIT_DRAFT = Object.freeze({
  title: "Git Draft Talk",
  eventName: "Repository Preview",
  date: "2026-09-01",
  location: "Hamburg, Germany",
  eventUrl: "https://events.example/git-draft",
  eventTypes: Object.freeze(["Meetup"]),
  slides: "/talks/slides/git-draft.pdf",
  draft: true,
});

const API_PUBLISHED = Object.freeze({
  title: "API Published Talk",
  eventName: "API Conference",
  date: "2026-07-20",
  location: "Amsterdam, Netherlands",
  eventUrl: "https://events.example/api-published",
  eventTypes: Object.freeze(["Conference", "Workshop"]),
  slides: deckSlidePath(API_PUBLISHED_DECK_ID),
  sourceCodeUrl: "https://github.com/example/api-published-talk",
  draft: false,
});

const API_DRAFT = Object.freeze({
  title: "API Draft Talk",
  eventName: "API Preview",
  date: "2026-10-15",
  location: "Paris, France",
  eventUrl: "https://events.example/api-draft",
  eventTypes: Object.freeze(["Community"]),
  slides: deckSlidePath(API_DRAFT_DECK_ID),
  draft: true,
});

function makeApiRecord(frontmatter, deckId, bytes, pageCount) {
  const talkIdentity = deriveTalkIdentity(frontmatter.date, frontmatter.title);

  return Object.freeze({
    schemaVersion: API_TALK_RECORD_SCHEMA_VERSION,
    talkIdentity,
    recordKey: deriveTalkRecordKey(talkIdentity),
    deckId,
    deck: Object.freeze({ byteLength: bytes.byteLength, pageCount }),
    createdAt: "2026-02-01T10:22:41.118Z",
    updatedAt: "2026-02-01T10:30:00.000Z",
    frontmatter,
  });
}

function frontmatterDocument(frontmatter) {
  return `${[
    "---",
    `title: ${JSON.stringify(frontmatter.title)}`,
    `eventName: ${JSON.stringify(frontmatter.eventName)}`,
    `date: ${JSON.stringify(frontmatter.date)}`,
    `location: ${JSON.stringify(frontmatter.location)}`,
    `eventUrl: ${JSON.stringify(frontmatter.eventUrl)}`,
    "eventTypes:",
    ...frontmatter.eventTypes.map((value) => `  - ${JSON.stringify(value)}`),
    `slides: ${JSON.stringify(frontmatter.slides)}`,
    `draft: ${frontmatter.draft}`,
    "---",
    "",
  ].join("\n")}`;
}

async function linkProjectDependencies(projectRoot) {
  const sourceRoot = path.join(REPOSITORY_ROOT, "node_modules");
  const targetRoot = path.join(projectRoot, "node_modules");
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  await mkdir(targetRoot, { recursive: true });

  await Promise.all(
    entries
      .filter((entry) => ![".astro", ".vite", ".cache"].includes(entry.name))
      .map((entry) =>
        symlink(
          path.join(sourceRoot, entry.name),
          path.join(targetRoot, entry.name),
          entry.isDirectory() ? "dir" : "file",
        ),
      ),
  );
}

async function createFixtureProject(temporaryRoot) {
  const projectRoot = path.join(temporaryRoot, "project");
  await mkdir(projectRoot, { recursive: true });

  await Promise.all([
    cp(path.join(REPOSITORY_ROOT, "src"), path.join(projectRoot, "src"), {
      recursive: true,
    }),
    cp(path.join(REPOSITORY_ROOT, "public"), path.join(projectRoot, "public"), {
      recursive: true,
    }),
    cp(
      path.join(REPOSITORY_ROOT, "scripts"),
      path.join(projectRoot, "scripts"),
      { recursive: true },
    ),
    ...["astro.config.ts", "package.json", "tsconfig.json"].map((file) =>
      cp(path.join(REPOSITORY_ROOT, file), path.join(projectRoot, file)),
    ),
  ]);
  await linkProjectDependencies(projectRoot);

  const talkSourceRoot = path.join(projectRoot, "src/content/talks");
  const talkSlideRoot = path.join(projectRoot, "public/talks/slides");
  await Promise.all([
    rm(talkSourceRoot, { force: true, recursive: true }),
    rm(path.join(projectRoot, "public/talks"), {
      force: true,
      recursive: true,
    }),
  ]);
  await Promise.all([
    mkdir(talkSourceRoot, { recursive: true }),
    mkdir(talkSlideRoot, { recursive: true }),
  ]);

  const gitPublishedPath = path.join(talkSourceRoot, "git-published.md");
  const gitDraftPath = path.join(talkSourceRoot, "git-draft.md");
  const gitPublishedDeckPath = path.join(talkSlideRoot, "git-published.pdf");
  const gitDraftDeckPath = path.join(talkSlideRoot, "git-draft.pdf");

  await Promise.all([
    writeFile(gitPublishedPath, frontmatterDocument(GIT_PUBLISHED), "utf8"),
    writeFile(gitDraftPath, frontmatterDocument(GIT_DRAFT), "utf8"),
    writeFile(gitPublishedDeckPath, PDF_TEST_FIXTURES.singlePage),
    writeFile(gitDraftDeckPath, PDF_TEST_FIXTURES.multiPage),
  ]);

  return Object.freeze({
    projectRoot,
    gitPaths: Object.freeze([
      gitPublishedPath,
      gitDraftPath,
      gitPublishedDeckPath,
      gitDraftDeckPath,
    ]),
  });
}

async function createLocalStore(temporaryRoot, records) {
  const storeRoot = path.join(temporaryRoot, "store");
  const recordRoot = path.join(storeRoot, "talks/records");
  const deckRoot = path.join(storeRoot, "talks/decks");
  await Promise.all([
    mkdir(recordRoot, { recursive: true }),
    mkdir(deckRoot, { recursive: true }),
  ]);

  await Promise.all([
    ...records.map((record) =>
      writeFile(
        path.join(recordRoot, `${record.recordKey}.json`),
        serializeApiTalkRecord(record),
        "utf8",
      ),
    ),
    writeFile(
      path.join(deckRoot, `${API_PUBLISHED_DECK_ID}.pdf`),
      PDF_TEST_FIXTURES.singlePage,
    ),
    writeFile(
      path.join(deckRoot, `${API_DRAFT_DECK_ID}.pdf`),
      PDF_TEST_FIXTURES.multiPage,
    ),
    writeFile(
      path.join(deckRoot, `${UNREFERENCED_DECK_ID}.pdf`),
      PDF_TEST_FIXTURES.singlePage,
    ),
  ]);

  return Object.freeze({ storeRoot, recordRoot, deckRoot });
}

async function createPublisherSnapshot(temporaryRoot, store, name) {
  const snapshotRoot = path.join(temporaryRoot, name);
  const recordCacheRoot = path.join(snapshotRoot, "records");
  const deckCacheRoot = path.join(snapshotRoot, "decks");
  await Promise.all([
    cp(store.recordRoot, recordCacheRoot, { recursive: true }),
    cp(store.deckRoot, deckCacheRoot, { recursive: true }),
  ]);
  return Object.freeze({ recordCacheRoot, deckCacheRoot });
}

function isolatedBuildEnvironment() {
  const environment = { ...process.env };
  delete environment.SITE_CONTENT_PATH;
  delete environment.TALK_RECORD_CACHE_PATH;
  delete environment.TALK_DECK_CACHE_PATH;
  return environment;
}

async function runBuildAndVerifier(projectRoot) {
  const options = {
    cwd: projectRoot,
    env: isolatedBuildEnvironment(),
    maxBuffer: 10 * 1024 * 1024,
  };

  await execFileAsync("npm", ["run", "build"], options);
  await execFileAsync("npm", ["run", "verify:build"], options);
}

function occurrenceCount(value, fragment) {
  return value.split(fragment).length - 1;
}

function htmlTalkTitles(html) {
  return [
    ...html.matchAll(
      /<article\b[^>]*data-talk-card[^>]*>([\s\S]*?)<\/article>/gu,
    ),
  ].map(([, body]) => {
    const match = /<h2\b[^>]*class="talk-title"[^>]*>([^<]+)<\/h2>/u.exec(body);
    assert.notEqual(match, null, "each rendered talk card must have a title");
    return match[1].trim();
  });
}

function markdownTalkTitles(markdown) {
  return [...markdown.matchAll(/^## (.+)$/gmu)].map(([, title]) => title);
}

async function relativeFiles(root) {
  const files = [];

  async function visit(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath, relativePath);
      if (entry.isFile()) files.push(relativePath);
    }
  }

  await visit(root, "");
  return files.sort();
}

function talksSitemapEntry(sitemap) {
  const entries = [
    ...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/gu),
  ].filter(([, location]) => location.startsWith("https://salih.dev/talks"));
  assert.equal(entries.length, 1);
  return entries[0];
}

async function readComposition(projectRoot) {
  const distRoot = path.join(projectRoot, "dist");
  const [html, markdown, llms, llmsFull, rss, sitemap, readiness, slides] =
    await Promise.all([
      readFile(path.join(distRoot, "talks/index.html"), "utf8"),
      readFile(path.join(distRoot, "talks/index.md"), "utf8"),
      readFile(path.join(distRoot, "llms.txt"), "utf8"),
      readFile(path.join(distRoot, "llms-full.txt"), "utf8"),
      readFile(path.join(distRoot, "rss.xml"), "utf8"),
      readFile(path.join(distRoot, "sitemap.xml"), "utf8"),
      readFile(path.join(distRoot, ".well-known/agent-readiness.json"), "utf8"),
      relativeFiles(path.join(distRoot, "talks/slides")),
    ]);

  return Object.freeze({
    html,
    markdown,
    llms,
    llmsFull,
    rss,
    sitemap,
    readiness: JSON.parse(readiness),
    slides,
  });
}

function assertComposition(
  composition,
  { expectedTitles, expectedLastmod, expectedSlides, absentTalks },
) {
  assert.deepEqual(htmlTalkTitles(composition.html), expectedTitles);
  assert.deepEqual(markdownTalkTitles(composition.markdown), expectedTitles);
  assert.equal(
    occurrenceCount(
      composition.llms,
      `- [Talks](https://salih.dev/talks/): Talk archive with slides and recordings where available (${expectedTitles.length} published)`,
    ),
    1,
  );
  assert.equal(
    occurrenceCount(composition.llms, "- Search indexing: allowed"),
    1,
  );
  assert.equal(composition.readiness.policy.search, true);
  assert.equal(
    occurrenceCount(composition.llmsFull, composition.markdown.trim()),
    1,
  );

  const [, , talksLocationTail] = talksSitemapEntry(composition.sitemap);
  assert.match(
    talksLocationTail,
    new RegExp(`<lastmod>${expectedLastmod}<\\/lastmod>`),
  );
  assert.deepEqual(composition.slides, expectedSlides);
  assert.equal(new Set(composition.slides).size, composition.slides.length);

  // The published API talk carries a github.com source link; it must surface as
  // exactly one visible "Source code" action in the HTML archive and one
  // "Source code:" line in the Markdown alternate when the talk is published,
  // and nowhere once it is removed.
  const apiSourceUrl = API_PUBLISHED.sourceCodeUrl;
  if (expectedTitles.includes(API_PUBLISHED.title)) {
    assert.equal(
      occurrenceCount(composition.html, 'class="talk-source-link"'),
      1,
      "the published API talk must render one Source code action",
    );
    assert.equal(occurrenceCount(composition.html, apiSourceUrl), 1);
    assert.equal(
      occurrenceCount(composition.markdown, `Source code: <${apiSourceUrl}>`),
      1,
    );
    assert.equal(occurrenceCount(composition.llmsFull, apiSourceUrl), 1);
  } else {
    assert.equal(composition.html.includes(apiSourceUrl), false);
    assert.equal(composition.markdown.includes(apiSourceUrl), false);
    assert.equal(composition.html.includes('class="talk-source-link"'), false);
  }

  for (const title of expectedTitles) {
    assert.equal(
      htmlTalkTitles(composition.html).filter((value) => value === title)
        .length,
      1,
    );
    assert.equal(
      markdownTalkTitles(composition.markdown).filter(
        (value) => value === title,
      ).length,
      1,
    );
  }

  for (const talk of absentTalks) {
    for (const [name, document] of [
      ["HTML", composition.html],
      ["Markdown", composition.markdown],
      ["search index", composition.llms],
      ["full discovery corpus", composition.llmsFull],
      ["RSS", composition.rss],
      ["sitemap", composition.sitemap],
    ]) {
      assert.equal(
        document.includes(talk.title) ||
          document.includes(talk.eventUrl) ||
          document.includes(talk.slides),
        false,
        `${name} must exclude ${talk.title}`,
      );
    }
  }

  for (const talk of [GIT_PUBLISHED, API_PUBLISHED, GIT_DRAFT, API_DRAFT]) {
    assert.equal(
      composition.rss.includes(talk.title) ||
        composition.rss.includes(talk.eventUrl) ||
        composition.rss.includes(talk.slides),
      false,
      "the blog-only RSS feed must not acquire talk entries",
    );
  }
}

function removalEvent(recordKey, version, includeIntent = true) {
  return {
    version: "2.0",
    routeKey: `DELETE /v1/talks/records/${recordKey}`,
    rawPath: `/v1/talks/records/${recordKey}`,
    rawQueryString: "",
    headers: {
      "if-match": version,
      ...(includeIntent ? { "x-talk-removal": "confirmed" } : {}),
    },
    requestContext: {
      accountId: "123456789012",
      apiId: "local-integration-api",
      authorizer: {
        iam: {
          accessKey: "ASIATEMPORARY",
          accountId: "123456789012",
          callerId: "local-integration-caller",
          cognitoIdentity: null,
          principalOrgId: "o-local",
          userArn: EDITOR_ARN,
          userId: "local-integration-user",
        },
      },
      domainName: "api.example.test",
      domainPrefix: "api",
      http: {
        method: "DELETE",
        path: `/v1/talks/records/${recordKey}`,
        protocol: "HTTP/1.1",
        sourceIp: "192.0.2.10",
        userAgent: "integration-test",
      },
      requestId: "pipeline-removal-request",
      routeKey: `DELETE /v1/talks/records/${recordKey}`,
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1_767_225_600_000,
    },
    pathParameters: { recordKey },
    isBase64Encoded: false,
  };
}

function responseBody(response) {
  assert.equal(typeof response.body, "string");
  return JSON.parse(response.body);
}

async function fileSnapshot(paths) {
  return Promise.all(paths.map((file) => readFile(file)));
}

// Validates: Requirements 7.1, 7.6, 8.1-8.6, 9.5-9.8, 11.5
test("publisher composes mixed talk sources and removes one API record from a fresh snapshot", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "salih-dev-talk-pipeline-"),
  );
  context.after(() => rm(temporaryRoot, { force: true, recursive: true }));

  const apiPublishedRecord = makeApiRecord(
    API_PUBLISHED,
    API_PUBLISHED_DECK_ID,
    PDF_TEST_FIXTURES.singlePage,
    1,
  );
  const apiDraftRecord = makeApiRecord(
    API_DRAFT,
    API_DRAFT_DECK_ID,
    PDF_TEST_FIXTURES.multiPage,
    2,
  );
  const fixture = await createFixtureProject(temporaryRoot);
  const store = await createLocalStore(temporaryRoot, [
    apiPublishedRecord,
    apiDraftRecord,
  ]);
  const gitBefore = await fileSnapshot(fixture.gitPaths);

  const firstSnapshot = await createPublisherSnapshot(
    temporaryRoot,
    store,
    "publisher-snapshot-1",
  );
  assert.deepEqual(
    await materializeApiTalks({
      projectRoot: fixture.projectRoot,
      ...firstSnapshot,
    }),
    { materialized: 2, skipped: 0 },
  );
  await runBuildAndVerifier(fixture.projectRoot);

  const beforeRemoval = await readComposition(fixture.projectRoot);
  assertComposition(beforeRemoval, {
    expectedTitles: [API_PUBLISHED.title, GIT_PUBLISHED.title],
    expectedLastmod: API_PUBLISHED.date,
    expectedSlides: [
      `api/${API_PUBLISHED_DECK_ID}.pdf`,
      `api/${API_DRAFT_DECK_ID}.pdf`,
      "git-draft.pdf",
      "git-published.pdf",
    ],
    absentTalks: [GIT_DRAFT, API_DRAFT],
  });
  assert.equal(
    beforeRemoval.slides.includes(`api/${UNREFERENCED_DECK_ID}.pdf`),
    false,
  );

  const requireFromInfra = createRequire(
    path.join(REPOSITORY_ROOT, "infra/package.json"),
  );
  const { CodeBuildClient } = requireFromInfra("@aws-sdk/client-codebuild");
  const { S3Client, S3ServiceException } =
    requireFromInfra("@aws-sdk/client-s3");
  const originalS3Send = S3Client.prototype.send;
  const originalCodeBuildSend = CodeBuildClient.prototype.send;
  const originalEnvironment = {
    CONTENT_ALLOWED_CALLER_ARNS: process.env.CONTENT_ALLOWED_CALLER_ARNS,
    CONTENT_BUCKET_NAME: process.env.CONTENT_BUCKET_NAME,
    PUBLISHER_PROJECT_NAME: process.env.PUBLISHER_PROJECT_NAME,
    REPOSITORY_TALK_RECORD_KEYS: process.env.REPOSITORY_TALK_RECORD_KEYS,
  };
  const originalConsoleLog = console.log;
  const sequence = [];
  let buildCalls = 0;

  process.env.CONTENT_ALLOWED_CALLER_ARNS = EDITOR_ARN;
  process.env.CONTENT_BUCKET_NAME = CONTENT_BUCKET;
  process.env.PUBLISHER_PROJECT_NAME = PUBLISHER_PROJECT;
  process.env.REPOSITORY_TALK_RECORD_KEYS = deriveTalkRecordKey(
    deriveTalkIdentity(GIT_PUBLISHED.date, GIT_PUBLISHED.title),
  );
  console.log = () => {};

  const preconditionError = () =>
    new S3ServiceException({
      name: "PreconditionFailed",
      $fault: "client",
      $metadata: { httpStatusCode: 412 },
    });

  S3Client.prototype.send = async (command) => {
    const commandName = command.constructor.name;
    const key = command.input.Key;
    sequence.push(`${commandName}:${key ?? ""}`);

    if (commandName === "GetObjectCommand") {
      if (command.input.IfMatch !== API_PUBLISHED_ETAG) {
        throw preconditionError();
      }
      return {
        Body: {
          transformToString: async () =>
            readFile(
              path.join(
                store.recordRoot,
                `${apiPublishedRecord.recordKey}.json`,
              ),
              "utf8",
            ),
        },
        ETag: API_PUBLISHED_ETAG,
      };
    }

    if (commandName === "DeleteObjectCommand") {
      if (key === `talks/records/${apiPublishedRecord.recordKey}.json`) {
        if (command.input.IfMatch !== API_PUBLISHED_ETAG) {
          throw preconditionError();
        }
        await rm(
          path.join(store.recordRoot, `${apiPublishedRecord.recordKey}.json`),
        );
        return {};
      }
      if (key === `talks/decks/${API_PUBLISHED_DECK_ID}.pdf`) {
        await rm(path.join(store.deckRoot, `${API_PUBLISHED_DECK_ID}.pdf`));
        return {};
      }
    }

    throw new Error(`Unexpected local S3 command: ${commandName}`);
  };
  CodeBuildClient.prototype.send = async (command) => {
    assert.equal(command.constructor.name, "StartBuildCommand");
    assert.equal(command.input.projectName, PUBLISHER_PROJECT);
    buildCalls += 1;
    sequence.push("StartBuildCommand");
    return { build: { id: "local-removal-build" } };
  };

  try {
    const { handler: recordsHandler } =
      await import("../infra/functions/talk-records.ts");

    sequence.length = 0;
    const missingIntent = await recordsHandler(
      removalEvent(apiPublishedRecord.recordKey, API_PUBLISHED_ETAG, false),
    );
    assert.equal(missingIntent.statusCode, 428);
    assert.deepEqual(sequence, []);

    const repositoryRecordKey = process.env.REPOSITORY_TALK_RECORD_KEYS;
    sequence.length = 0;
    const repositoryRemoval = await recordsHandler(
      removalEvent(repositoryRecordKey, API_PUBLISHED_ETAG),
    );
    assert.equal(repositoryRemoval.statusCode, 409);
    assert.equal(
      responseBody(repositoryRemoval).error,
      "repository_authored_talk",
    );
    assert.deepEqual(sequence, []);

    sequence.length = 0;
    const staleRemoval = await recordsHandler(
      removalEvent(apiPublishedRecord.recordKey, STALE_ETAG),
    );
    assert.equal(staleRemoval.statusCode, 412);
    assert.equal(responseBody(staleRemoval).error, "record_changed");
    assert.deepEqual(sequence, [
      `GetObjectCommand:talks/records/${apiPublishedRecord.recordKey}.json`,
    ]);
    assert.equal(
      await readFile(
        path.join(store.recordRoot, `${apiPublishedRecord.recordKey}.json`),
        "utf8",
      ),
      serializeApiTalkRecord(apiPublishedRecord),
    );

    sequence.length = 0;
    const acceptedRemoval = await recordsHandler(
      removalEvent(apiPublishedRecord.recordKey, API_PUBLISHED_ETAG),
    );
    assert.equal(acceptedRemoval.statusCode, 202);
    assert.deepEqual(responseBody(acceptedRemoval), {
      buildId: "local-removal-build",
      deckId: API_PUBLISHED_DECK_ID,
      recordKey: apiPublishedRecord.recordKey,
      status: "publishing",
    });
    assert.deepEqual(sequence, [
      `GetObjectCommand:talks/records/${apiPublishedRecord.recordKey}.json`,
      `DeleteObjectCommand:talks/records/${apiPublishedRecord.recordKey}.json`,
      `DeleteObjectCommand:talks/decks/${API_PUBLISHED_DECK_ID}.pdf`,
      "StartBuildCommand",
    ]);
    assert.equal(buildCalls, 1);
  } finally {
    S3Client.prototype.send = originalS3Send;
    CodeBuildClient.prototype.send = originalCodeBuildSend;
    console.log = originalConsoleLog;
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  const secondSnapshot = await createPublisherSnapshot(
    temporaryRoot,
    store,
    "publisher-snapshot-2",
  );
  assert.deepEqual(
    await materializeApiTalks({
      projectRoot: fixture.projectRoot,
      ...secondSnapshot,
    }),
    { materialized: 1, skipped: 0 },
  );
  await runBuildAndVerifier(fixture.projectRoot);

  const afterRemoval = await readComposition(fixture.projectRoot);
  assertComposition(afterRemoval, {
    expectedTitles: [GIT_PUBLISHED.title],
    expectedLastmod: GIT_PUBLISHED.date,
    expectedSlides: [
      `api/${API_DRAFT_DECK_ID}.pdf`,
      "git-draft.pdf",
      "git-published.pdf",
    ],
    absentTalks: [API_PUBLISHED, GIT_DRAFT, API_DRAFT],
  });
  assert.equal(afterRemoval.rss, beforeRemoval.rss);
  assert.equal(
    afterRemoval.slides.includes(`api/${API_PUBLISHED_DECK_ID}.pdf`),
    false,
  );
  assert.equal(
    afterRemoval.slides.includes(`api/${UNREFERENCED_DECK_ID}.pdf`),
    false,
  );
  assert.deepEqual(await fileSnapshot(fixture.gitPaths), gitBefore);
  assert.deepEqual(await relativeFiles(store.recordRoot), [
    `${apiDraftRecord.recordKey}.json`,
  ]);
  assert.deepEqual(await relativeFiles(store.deckRoot), [
    `${API_DRAFT_DECK_ID}.pdf`,
    `${UNREFERENCED_DECK_ID}.pdf`,
  ]);
});
