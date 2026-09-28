import assert from "node:assert/strict";
import test from "node:test";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import fc from "fast-check";

import {
  API_TALK_RECORD_SCHEMA_VERSION,
  type ApiTalkRecord,
} from "./api-record.js";
import {
  DECK_MAX_BYTES,
  deckSlidePath,
  isDeckId,
  type DeckId,
} from "./deck.js";
import { deriveTalkIdentity, deriveTalkRecordKey } from "./identity.js";
import {
  planMaterialization,
  type MaterializationRoots,
} from "./materialize.js";

const RECORD_ROOT_SEGMENTS = ["src", "content", "talks", "api"] as const;
const SLIDE_ROOT_SEGMENTS = ["public", "talks", "slides", "api"] as const;
const CREATED_AT = "2026-01-01T00:00:00.000Z";
const UPDATED_AT = "2026-01-02T00:00:00.000Z";

type MaterializationScenario = Readonly<{
  records: readonly ApiTalkRecord[];
  selectedDeckIds: readonly DeckId[];
  orphanDeckIds: readonly DeckId[];
  unreferencedDeckIds: readonly DeckId[];
  staleNames: readonly string[];
  projectRoot: string;
  spellRootsAdversarially: boolean;
}>;

const deckIdArbitrary = fc
  .uuid({ version: 4 })
  .filter(isDeckId)
  .map((value): DeckId => value);

const pathTokenArbitrary = fc.stringMatching(/^[a-z0-9]{1,12}$/u);
const staleNamesArbitrary = fc.uniqueArray(
  pathTokenArbitrary.map((token) => `stale-${token}`),
  { minLength: 1, maxLength: 6 },
);

function makeRecord(deckId: DeckId, index: number): ApiTalkRecord {
  const date = `2026-01-${String(index + 1).padStart(2, "0")}`;
  const title = `Materialized API talk ${deckId}`;
  const talkIdentity = deriveTalkIdentity(date, title);

  return Object.freeze({
    schemaVersion: API_TALK_RECORD_SCHEMA_VERSION,
    talkIdentity,
    recordKey: deriveTalkRecordKey(talkIdentity),
    deckId,
    deck: Object.freeze({
      byteLength: Math.min(DECK_MAX_BYTES, index + 1),
      pageCount: index + 1,
    }),
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    frontmatter: Object.freeze({
      title,
      eventName: "Property Conference",
      date,
      location: "Test City",
      eventUrl: `https://events.example/talks/${deckId}`,
      eventTypes: Object.freeze(["Conference"]),
      slides: deckSlidePath(deckId),
      draft: index % 2 === 0,
    }),
  });
}

const scenarioArbitrary: fc.Arbitrary<MaterializationScenario> = fc
  .record({
    selectedCount: fc.integer({ min: 1, max: 4 }),
    orphanCount: fc.integer({ min: 1, max: 4 }),
    unreferencedCount: fc.integer({ min: 1, max: 4 }),
    staleNames: staleNamesArbitrary,
    projectParent: fc.constantFrom(
      "materialize-property",
      "materialize property",
      "api-parent",
      "talks..parent",
      "percent%parent",
    ),
    projectToken: pathTokenArbitrary,
    spellRootsAdversarially: fc.boolean(),
  })
  .chain(
    ({
      selectedCount,
      orphanCount,
      unreferencedCount,
      staleNames,
      projectParent,
      projectToken,
      spellRootsAdversarially,
    }) => {
      const referencedCount = selectedCount + orphanCount;
      const totalDeckCount = referencedCount + unreferencedCount;

      return fc
        .uniqueArray(deckIdArbitrary, {
          minLength: totalDeckCount,
          maxLength: totalDeckCount,
        })
        .chain((deckIds) => {
          const selectedDeckIds = deckIds.slice(0, selectedCount);
          const orphanDeckIds = deckIds.slice(selectedCount, referencedCount);
          const unreferencedDeckIds = deckIds.slice(referencedCount);
          const records = [...selectedDeckIds, ...orphanDeckIds].map(
            makeRecord,
          );

          return fc
            .shuffledSubarray(records, {
              minLength: records.length,
              maxLength: records.length,
            })
            .map((shuffledRecords) =>
              Object.freeze({
                records: Object.freeze(shuffledRecords),
                selectedDeckIds: Object.freeze(selectedDeckIds),
                orphanDeckIds: Object.freeze(orphanDeckIds),
                unreferencedDeckIds: Object.freeze(unreferencedDeckIds),
                staleNames: Object.freeze(staleNames),
                projectRoot: resolve("/tmp", projectParent, projectToken),
                spellRootsAdversarially,
              }),
            );
        });
    },
  );

function canonicalRoots(projectRoot: string): MaterializationRoots {
  return Object.freeze({
    recordRoot: resolve(projectRoot, ...RECORD_ROOT_SEGMENTS),
    slideRoot: resolve(projectRoot, ...SLIDE_ROOT_SEGMENTS),
  });
}

function plannerRoots(scenario: MaterializationScenario): MaterializationRoots {
  const canonical = canonicalRoots(scenario.projectRoot);
  if (!scenario.spellRootsAdversarially) return canonical;

  return Object.freeze({
    recordRoot: `${canonical.recordRoot}${sep}nested${sep}..`,
    slideRoot: `${canonical.slideRoot}${sep}.${sep}nested${sep}..`,
  });
}

function isDirectOwnedChild(root: string, target: string): boolean {
  const fromRoot = relative(resolve(root), target);
  return (
    fromRoot.length > 0 &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot) &&
    !fromRoot.includes(sep)
  );
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

// Feature: talk-upload-endpoint, Property 10: Materialization is confined to the code-owned API namespace
// **Validates: Requirements 3.7, 5.6, 5.7, 7.6, 7.8, 8.3, 9.6, 11.4**
test("Property 10: materialization is confined to the code-owned API namespace", () => {
  fc.assert(
    fc.property(scenarioArbitrary, (scenario) => {
      const canonical = canonicalRoots(scenario.projectRoot);
      const availableDeckIds = new Set<string>([
        ...scenario.selectedDeckIds,
        ...scenario.unreferencedDeckIds,
      ]);
      const plan = planMaterialization(
        scenario.records,
        availableDeckIds,
        plannerRoots(scenario),
      );

      const expectedSelectedRecords = scenario.records.filter((record) =>
        availableDeckIds.has(record.deckId),
      );
      const expectedSkippedRecords = scenario.records.filter(
        (record) => !availableDeckIds.has(record.deckId),
      );

      assert.deepEqual(
        plan.records.map((entry) => basename(entry.recordPath)),
        sorted(
          expectedSelectedRecords.map((record) => `${record.recordKey}.md`),
        ),
        "only records with an available approved deck are selected",
      );
      assert.deepEqual(
        plan.skipped.map(({ recordKey, reason }) => ({ recordKey, reason })),
        sorted(expectedSkippedRecords.map((record) => record.recordKey)).map(
          (recordKey) => ({ recordKey, reason: "deck_absent" as const }),
        ),
        "every orphaned record is reported as skipped",
      );

      assert.equal(plan.records.length, scenario.selectedDeckIds.length);
      assert.equal(plan.skipped.length, scenario.orphanDeckIds.length);

      const plannedDeckSources = plan.records.map((entry) => entry.deckSource);
      const plannedDeckTargets = plan.records.map((entry) => entry.deckTarget);
      assert.equal(new Set(plannedDeckSources).size, plan.records.length);
      assert.equal(new Set(plannedDeckTargets).size, plan.records.length);
      assert.deepEqual(
        sorted(plannedDeckSources),
        sorted(scenario.selectedDeckIds.map((deckId) => `${deckId}.pdf`)),
        "materialized decks map one-to-one to selected records",
      );

      for (const entry of plan.records) {
        assert.equal(
          isDirectOwnedChild(canonical.recordRoot, entry.recordPath),
          true,
        );
        assert.equal(
          isDirectOwnedChild(canonical.slideRoot, entry.deckTarget),
          true,
        );
        assert.equal(entry.deckSource, basename(entry.deckTarget));
      }

      for (const deckId of scenario.unreferencedDeckIds) {
        assert.equal(
          plannedDeckSources.includes(`${deckId}.pdf`),
          false,
          "an unreferenced approved deck must not enter the snapshot",
        );
      }

      const staleGeneratedPaths = scenario.staleNames.flatMap((name) => [
        resolve(canonical.recordRoot, `${name}.md`),
        resolve(canonical.slideRoot, `${name}.pdf`),
      ]);
      const clearThenWriteMutationPaths = new Set<string>([
        ...staleGeneratedPaths,
        ...plan.records.flatMap((entry) => [
          entry.recordPath,
          entry.deckTarget,
        ]),
      ]);

      for (const mutationPath of clearThenWriteMutationPaths) {
        assert.equal(
          isDirectOwnedChild(canonical.recordRoot, mutationPath) ||
            isDirectOwnedChild(canonical.slideRoot, mutationPath),
          true,
          "stale cleanup and planned writes stay inside API-owned roots",
        );
      }

      const gitAuthoredPaths = scenario.staleNames.flatMap((name) => [
        resolve(scenario.projectRoot, "src", "content", "talks", `${name}.md`),
        resolve(
          scenario.projectRoot,
          "public",
          "talks",
          "slides",
          `${name}.pdf`,
        ),
      ]);
      for (const gitAuthoredPath of gitAuthoredPaths) {
        assert.equal(clearThenWriteMutationPaths.has(gitAuthoredPath), false);
      }

      const invalidRecordRoots = [
        resolve(scenario.projectRoot, "src", "content", "talks"),
        resolve(scenario.projectRoot, "src", "content", "talks", "api-copy"),
        resolve(scenario.projectRoot, "public", "talks", "slides", "api"),
      ];
      for (const recordRoot of invalidRecordRoots) {
        assert.throws(
          () =>
            planMaterialization(scenario.records, availableDeckIds, {
              recordRoot,
              slideRoot: canonical.slideRoot,
            }),
          RangeError,
        );
      }

      const invalidSlideRoots = [
        resolve(scenario.projectRoot, "public", "talks", "slides"),
        resolve(scenario.projectRoot, "public", "talks", "slides", "api-copy"),
        resolve(scenario.projectRoot, "src", "content", "talks", "api"),
      ];
      for (const slideRoot of invalidSlideRoots) {
        assert.throws(
          () =>
            planMaterialization(scenario.records, availableDeckIds, {
              recordRoot: canonical.recordRoot,
              slideRoot,
            }),
          RangeError,
        );
      }
    }),
    { numRuns: 200 },
  );
});
