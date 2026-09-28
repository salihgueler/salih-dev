import assert from "node:assert/strict";
import {
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

import {
  API_TALK_RECORD_SCHEMA_VERSION,
  serializeApiTalkRecord,
  toTalkFrontmatterDocument,
} from "../src/lib/talks/api-record.js";
import { deckSlidePath } from "../src/lib/talks/deck.js";
import {
  deriveTalkIdentity,
  deriveTalkRecordKey,
} from "../src/lib/talks/identity.js";
import { materializeApiTalks } from "./materialize-api-talks.mjs";

const SELECTED_DECK_ID = "0f9c8c46-2f1e-4a5b-9d3e-71b0d2c9a4e8";
const ABSENT_DECK_ID = "9c32b220-63a6-4bbd-a9fc-3f76ce552e83";
const UNREFERENCED_DECK_ID = "43cb94ba-6bc0-440e-8206-8cfd0ba10e60";

function makeRecord({ date, deckId, title }) {
  const talkIdentity = deriveTalkIdentity(date, title);

  return Object.freeze({
    schemaVersion: API_TALK_RECORD_SCHEMA_VERSION,
    talkIdentity,
    recordKey: deriveTalkRecordKey(talkIdentity),
    deckId,
    deck: Object.freeze({ byteLength: 128, pageCount: 2 }),
    createdAt: "2026-02-01T10:22:41.118Z",
    updatedAt: "2026-02-01T10:30:00.000Z",
    frontmatter: Object.freeze({
      title,
      eventName: "Materializer Conference",
      date,
      location: "Test City",
      eventUrl: `https://events.example/talks/${deckId}`,
      eventTypes: Object.freeze(["Conference"]),
      slides: deckSlidePath(deckId),
      draft: false,
    }),
  });
}

async function writeStoredRecord(root, record) {
  await writeFile(
    path.join(root, `${record.recordKey}.json`),
    serializeApiTalkRecord(record),
    "utf8",
  );
}

async function snapshotFiles(root) {
  const snapshot = {};

  async function visit(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        snapshot[relativePath] = await readFile(absolutePath);
      }
    }
  }

  await visit(root, "");
  return snapshot;
}

async function createRoots(prefix) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), prefix));
  const projectRoot = path.join(temporaryRoot, "project");
  const recordCacheRoot = path.join(temporaryRoot, "record-cache");
  const deckCacheRoot = path.join(temporaryRoot, "deck-cache");
  const recordRoot = path.join(projectRoot, "src/content/talks/api");
  const slideRoot = path.join(projectRoot, "public/talks/slides/api");

  await Promise.all([
    mkdir(recordCacheRoot, { recursive: true }),
    mkdir(deckCacheRoot, { recursive: true }),
    mkdir(recordRoot, { recursive: true }),
    mkdir(slideRoot, { recursive: true }),
  ]);

  return {
    temporaryRoot,
    projectRoot,
    recordCacheRoot,
    deckCacheRoot,
    recordRoot,
    slideRoot,
  };
}

test("clears stale API output and writes exactly selected records and decks", async () => {
  const roots = await createRoots("salih-dev-materialize-");
  const selectedRecord = makeRecord({
    date: "2026-06-18",
    deckId: SELECTED_DECK_ID,
    title: "Selected API talk",
  });
  const absentDeckRecord = makeRecord({
    date: "2026-06-19",
    deckId: ABSENT_DECK_ID,
    title: "API talk whose approved deck is absent",
  });
  const selectedDeckBytes = Buffer.from("%PDF-selected-approved-deck");
  const unreferencedDeckBytes = Buffer.from("%PDF-unreferenced-approved-deck");
  const gitRecordPath = path.join(
    roots.projectRoot,
    "src/content/talks/git-authored.md",
  );
  const gitDeckPath = path.join(
    roots.projectRoot,
    "public/talks/slides/git-authored.pdf",
  );

  try {
    await Promise.all([
      writeStoredRecord(roots.recordCacheRoot, selectedRecord),
      writeStoredRecord(roots.recordCacheRoot, absentDeckRecord),
      writeFile(
        path.join(roots.deckCacheRoot, `${SELECTED_DECK_ID}.pdf`),
        selectedDeckBytes,
      ),
      writeFile(
        path.join(roots.deckCacheRoot, `${UNREFERENCED_DECK_ID}.pdf`),
        unreferencedDeckBytes,
      ),
      mkdir(path.join(roots.recordRoot, "stale"), { recursive: true }),
      mkdir(path.join(roots.slideRoot, "stale"), { recursive: true }),
      writeFile(gitRecordPath, "git record must remain unchanged", "utf8"),
      writeFile(gitDeckPath, "git deck must remain unchanged", "utf8"),
    ]);
    await Promise.all([
      writeFile(
        path.join(roots.recordRoot, "stale/record.md"),
        "stale record",
        "utf8",
      ),
      writeFile(
        path.join(roots.slideRoot, "stale/deck.pdf"),
        "stale deck",
        "utf8",
      ),
    ]);

    const recordCacheBefore = await snapshotFiles(roots.recordCacheRoot);
    const deckCacheBefore = await snapshotFiles(roots.deckCacheRoot);

    assert.deepEqual(
      await materializeApiTalks({
        projectRoot: roots.projectRoot,
        recordCacheRoot: roots.recordCacheRoot,
        deckCacheRoot: roots.deckCacheRoot,
      }),
      { materialized: 1, skipped: 1 },
    );

    assert.deepEqual(await snapshotFiles(roots.recordRoot), {
      [`${selectedRecord.recordKey}.md`]: Buffer.from(
        toTalkFrontmatterDocument(selectedRecord),
      ),
    });
    assert.deepEqual(await snapshotFiles(roots.slideRoot), {
      [`${SELECTED_DECK_ID}.pdf`]: selectedDeckBytes,
    });
    assert.deepEqual(
      await snapshotFiles(roots.recordCacheRoot),
      recordCacheBefore,
      "record cache inputs must remain byte-for-byte unchanged",
    );
    assert.deepEqual(
      await snapshotFiles(roots.deckCacheRoot),
      deckCacheBefore,
      "deck cache inputs must remain byte-for-byte unchanged",
    );
    assert.equal(
      await readFile(gitRecordPath, "utf8"),
      "git record must remain unchanged",
    );
    assert.equal(
      await readFile(gitDeckPath, "utf8"),
      "git deck must remain unchanged",
    );
  } finally {
    await rm(roots.temporaryRoot, { force: true, recursive: true });
  }
});

test("rejects malformed stored records before clearing generated output", async () => {
  const roots = await createRoots("salih-dev-materialize-invalid-record-");

  try {
    await Promise.all([
      writeFile(
        path.join(roots.recordCacheRoot, "malformed.json"),
        '{"schemaVersion":1,"recordKey":"../../escape"}',
        "utf8",
      ),
      writeFile(
        path.join(roots.recordRoot, "stale.md"),
        "record output must survive",
        "utf8",
      ),
      writeFile(
        path.join(roots.slideRoot, "stale.pdf"),
        "deck output must survive",
        "utf8",
      ),
    ]);
    const outputsBefore = await Promise.all([
      snapshotFiles(roots.recordRoot),
      snapshotFiles(roots.slideRoot),
    ]);
    const cacheBefore = await snapshotFiles(roots.recordCacheRoot);

    await assert.rejects(
      materializeApiTalks({
        projectRoot: roots.projectRoot,
        recordCacheRoot: roots.recordCacheRoot,
        deckCacheRoot: roots.deckCacheRoot,
      }),
      /Invalid API talk record: malformed\.json/u,
    );

    assert.deepEqual(await snapshotFiles(roots.recordRoot), outputsBefore[0]);
    assert.deepEqual(await snapshotFiles(roots.slideRoot), outputsBefore[1]);
    assert.deepEqual(await snapshotFiles(roots.recordCacheRoot), cacheBefore);
  } finally {
    await rm(roots.temporaryRoot, { force: true, recursive: true });
  }
});

test("rejects an unavailable cache root before clearing generated output", async () => {
  const roots = await createRoots("salih-dev-materialize-invalid-root-");
  const missingRecordCacheRoot = path.join(
    roots.temporaryRoot,
    "missing-record-cache",
  );

  try {
    await Promise.all([
      writeFile(
        path.join(roots.recordRoot, "stale.md"),
        "record output must survive",
        "utf8",
      ),
      writeFile(
        path.join(roots.slideRoot, "stale.pdf"),
        "deck output must survive",
        "utf8",
      ),
    ]);
    const outputsBefore = await Promise.all([
      snapshotFiles(roots.recordRoot),
      snapshotFiles(roots.slideRoot),
    ]);

    await assert.rejects(
      materializeApiTalks({
        projectRoot: roots.projectRoot,
        recordCacheRoot: missingRecordCacheRoot,
        deckCacheRoot: roots.deckCacheRoot,
      }),
      /ENOENT/u,
    );

    assert.deepEqual(await snapshotFiles(roots.recordRoot), outputsBefore[0]);
    assert.deepEqual(await snapshotFiles(roots.slideRoot), outputsBefore[1]);
  } finally {
    await rm(roots.temporaryRoot, { force: true, recursive: true });
  }
});

test("rejects generated roots that physically escape the project before mutation", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "salih-dev-materialize-escaping-root-"),
  );
  const projectRoot = path.join(temporaryRoot, "project");
  const externalTalkRoot = path.join(temporaryRoot, "external-talks");
  const recordCacheRoot = path.join(temporaryRoot, "record-cache");
  const deckCacheRoot = path.join(temporaryRoot, "deck-cache");
  const externalRecordRoot = path.join(externalTalkRoot, "api");
  const slideRoot = path.join(projectRoot, "public/talks/slides/api");
  const selectedRecord = makeRecord({
    date: "2026-06-20",
    deckId: SELECTED_DECK_ID,
    title: "Escaping root test",
  });

  try {
    await Promise.all([
      mkdir(path.join(projectRoot, "src/content"), { recursive: true }),
      mkdir(externalRecordRoot, { recursive: true }),
      mkdir(recordCacheRoot, { recursive: true }),
      mkdir(deckCacheRoot, { recursive: true }),
      mkdir(slideRoot, { recursive: true }),
    ]);
    await symlink(
      externalTalkRoot,
      path.join(projectRoot, "src/content/talks"),
      "dir",
    );
    await Promise.all([
      writeStoredRecord(recordCacheRoot, selectedRecord),
      writeFile(
        path.join(deckCacheRoot, `${SELECTED_DECK_ID}.pdf`),
        "%PDF-selected",
        "utf8",
      ),
      writeFile(
        path.join(externalRecordRoot, "stale.md"),
        "external output must survive",
        "utf8",
      ),
      writeFile(
        path.join(slideRoot, "stale.pdf"),
        "deck output must survive",
        "utf8",
      ),
    ]);
    const externalBefore = await snapshotFiles(externalRecordRoot);
    const slidesBefore = await snapshotFiles(slideRoot);

    await assert.rejects(
      materializeApiTalks({
        projectRoot,
        recordCacheRoot,
        deckCacheRoot,
      }),
      /generated directory .* resolves outside project root/u,
    );

    assert.deepEqual(await snapshotFiles(externalRecordRoot), externalBefore);
    assert.deepEqual(await snapshotFiles(slideRoot), slidesBefore);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("rejects physically overlapping cache and generated roots before mutation", async () => {
  const roots = await createRoots("salih-dev-materialize-overlap-");
  const recordCacheAlias = path.join(roots.temporaryRoot, "record-cache-alias");
  const selectedRecord = makeRecord({
    date: "2026-06-21",
    deckId: SELECTED_DECK_ID,
    title: "Overlapping root test",
  });

  try {
    await symlink(roots.recordRoot, recordCacheAlias, "dir");
    await Promise.all([
      writeStoredRecord(roots.recordRoot, selectedRecord),
      writeFile(
        path.join(roots.deckCacheRoot, `${SELECTED_DECK_ID}.pdf`),
        "%PDF-selected",
        "utf8",
      ),
      writeFile(
        path.join(roots.slideRoot, "stale.pdf"),
        "deck output must survive",
        "utf8",
      ),
    ]);
    const recordRootBefore = await snapshotFiles(roots.recordRoot);
    const slideRootBefore = await snapshotFiles(roots.slideRoot);

    await assert.rejects(
      materializeApiTalks({
        projectRoot: roots.projectRoot,
        recordCacheRoot: recordCacheAlias,
        deckCacheRoot: roots.deckCacheRoot,
      }),
      /must not overlap generated directory/u,
    );

    assert.deepEqual(await snapshotFiles(roots.recordRoot), recordRootBefore);
    assert.deepEqual(await snapshotFiles(roots.slideRoot), slideRootBefore);
  } finally {
    await rm(roots.temporaryRoot, { force: true, recursive: true });
  }
});
