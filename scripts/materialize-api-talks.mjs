import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseApiTalkRecord } from "../src/lib/talks/api-record.js";
import { isDeckId } from "../src/lib/talks/deck.js";
import { planMaterialization } from "../src/lib/talks/materialize.js";

const RECORD_CACHE_ENV = "TALK_RECORD_CACHE_PATH";
const DECK_CACHE_ENV = "TALK_DECK_CACHE_PATH";

function requiredCacheRoot(option, environmentName) {
  const value = option ?? process.env[environmentName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${environmentName} must name a local cache directory.`);
  }

  return path.resolve(value);
}

function containsPath(parent, candidate) {
  const relativePath = path.relative(parent, candidate);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function requireDisjointRoots(cacheRoots, outputRoots) {
  for (const cacheRoot of cacheRoots) {
    for (const outputRoot of outputRoots) {
      if (
        containsPath(cacheRoot, outputRoot) ||
        containsPath(outputRoot, cacheRoot)
      ) {
        throw new Error(
          `Cache directory ${cacheRoot} must not overlap generated directory ${outputRoot}.`,
        );
      }
    }
  }

  if (
    containsPath(cacheRoots[0], cacheRoots[1]) ||
    containsPath(cacheRoots[1], cacheRoots[0])
  ) {
    throw new Error("Talk record and deck cache directories must be separate.");
  }

  if (
    containsPath(outputRoots[0], outputRoots[1]) ||
    containsPath(outputRoots[1], outputRoots[0])
  ) {
    throw new Error("Generated record and slide directories must be separate.");
  }
}

function isMissingPathError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function resolvePhysicalPath(candidate) {
  let existingAncestor = path.resolve(candidate);
  const missingSegments = [];

  while (true) {
    try {
      const physicalAncestor = await realpath(existingAncestor);
      return path.resolve(physicalAncestor, ...missingSegments.reverse());
    } catch (error) {
      if (!isMissingPathError(error)) throw error;

      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;

      missingSegments.push(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

async function requirePhysicalRootSafety(projectRoot, cacheRoots, outputRoots) {
  const [physicalProjectRoot, physicalCacheRoots, physicalOutputRoots] =
    await Promise.all([
      realpath(projectRoot),
      Promise.all(cacheRoots.map((cacheRoot) => realpath(cacheRoot))),
      Promise.all(outputRoots.map(resolvePhysicalPath)),
    ]);

  for (let index = 0; index < outputRoots.length; index += 1) {
    if (!containsPath(physicalProjectRoot, physicalOutputRoots[index])) {
      throw new Error(
        `Talk generated directory ${outputRoots[index]} resolves outside project root ${projectRoot}.`,
      );
    }
  }

  requireDisjointRoots(physicalCacheRoots, physicalOutputRoots);
}

async function readStoredRecords(recordCacheRoot) {
  const entries = await readdir(recordCacheRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

  return Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        throw new Error(`Invalid API talk record cache entry: ${entry.name}`);
      }

      const recordPath = path.join(recordCacheRoot, entry.name);
      let value;
      try {
        value = JSON.parse(await readFile(recordPath, "utf8"));
      } catch {
        throw new Error(`Invalid API talk record JSON: ${entry.name}`);
      }

      const record = parseApiTalkRecord(value);
      if (record === null || entry.name !== `${record.recordKey}.json`) {
        throw new Error(`Invalid API talk record: ${entry.name}`);
      }

      return record;
    }),
  );
}

async function readAvailableDeckIds(deckCacheRoot) {
  const entries = await readdir(deckCacheRoot, { withFileTypes: true });
  const availableDeckIds = new Set();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".pdf")) continue;

    const deckId = entry.name.slice(0, -".pdf".length);
    if (isDeckId(deckId)) availableDeckIds.add(deckId);
  }

  return availableDeckIds;
}

/**
 * Materializes the publisher's local API talk caches into reserved source
 * directories. Cache contents are read-only; only the two generated API
 * namespaces are cleared or written.
 */
export async function materializeApiTalks(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const recordCacheRoot = requiredCacheRoot(
    options.recordCacheRoot,
    RECORD_CACHE_ENV,
  );
  const deckCacheRoot = requiredCacheRoot(
    options.deckCacheRoot,
    DECK_CACHE_ENV,
  );
  const recordRoot = path.join(projectRoot, "src/content/talks/api");
  const slideRoot = path.join(projectRoot, "public/talks/slides/api");

  const cacheRoots = [recordCacheRoot, deckCacheRoot];
  const outputRoots = [recordRoot, slideRoot];
  requireDisjointRoots(cacheRoots, outputRoots);
  await requirePhysicalRootSafety(projectRoot, cacheRoots, outputRoots);

  const [records, availableDeckIds] = await Promise.all([
    readStoredRecords(recordCacheRoot),
    readAvailableDeckIds(deckCacheRoot),
  ]);
  const plan = planMaterialization(records, availableDeckIds, {
    recordRoot,
    slideRoot,
  });

  await Promise.all([
    rm(recordRoot, { force: true, recursive: true }),
    rm(slideRoot, { force: true, recursive: true }),
  ]);
  await Promise.all([
    mkdir(recordRoot, { recursive: true }),
    mkdir(slideRoot, { recursive: true }),
  ]);

  await Promise.all(
    plan.records.flatMap((record) => [
      writeFile(record.recordPath, record.document, "utf8"),
      copyFile(path.join(deckCacheRoot, record.deckSource), record.deckTarget),
    ]),
  );

  return Object.freeze({
    materialized: plan.records.length,
    skipped: plan.skipped.length,
  });
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  materializeApiTalks()
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
