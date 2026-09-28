import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as fc from "fast-check";

import { PDF_TEST_FIXTURES } from "./__fixtures__/pdf.js";
import { resolveValidatedTalks, type TalkSourceRecord } from "./gateway.js";
import { deriveTalkIdentity } from "./identity.js";
import { TalkValidationError, type ValidationIssue } from "./model.js";

type TalkSource = "api" | "git";
type ConflictKind = "identity" | "slide";

type ValidTalkData = Readonly<{
  title: string;
  eventName: string;
  date: string;
  location: string;
  eventUrl: string;
  eventTypes: readonly string[];
  slides: string;
  draft: boolean;
}>;

type Scenario = Readonly<{
  identityGitCount: number;
  identityApiCount: number;
  slideGitCount: number;
  slideApiCount: number;
  titleOffset: number;
  draftMask: number;
  fieldVariant: number;
  invalidSource: TalkSource;
  unrelatedSource: TalkSource;
  permutationPriorities: readonly number[];
}>;

type ScenarioRecords = Readonly<{
  records: readonly TalkSourceRecord[];
  identityParticipantIds: readonly string[];
  slideParticipantIds: readonly string[];
  invalidRecordId: string;
  unrelatedRecordId: string;
  identityValue: string;
  slideValue: string;
}>;

const IDENTITY_DATE = "2027-04-19";
const SLIDE_DATE = "2028-05-20";
const UNRELATED_DATE = "2029-06-21";
const SLIDE_FILE_COUNT = 8;
const SHARED_SLIDE_INDEX = 5;
const UNRELATED_SLIDE_INDEX = 6;

const CANONICALLY_EQUAL_TITLES = [
  "  CAFÉ   AGENT  \u{10400}  ",
  "cafe\u0301\tagent\n\u{10428}",
  "\u00a0Café\u2003Agent   \u{10400}\u00a0",
] as const;

const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  identityGitCount: fc.integer({ min: 1, max: 2 }),
  identityApiCount: fc.integer({ min: 1, max: 3 }),
  slideGitCount: fc.integer({ min: 1, max: 2 }),
  slideApiCount: fc.integer({ min: 1, max: 3 }),
  titleOffset: fc.integer({ min: 0, max: CANONICALLY_EQUAL_TITLES.length - 1 }),
  draftMask: fc.integer({ min: 0, max: 0xffff }),
  fieldVariant: fc.integer({ min: 0, max: 10_000 }),
  invalidSource: fc.constantFrom<TalkSource>("api", "git"),
  unrelatedSource: fc.constantFrom<TalkSource>("api", "git"),
  permutationPriorities: fc.array(fc.integer(), {
    minLength: 12,
    maxLength: 12,
  }),
});

function slidePath(index: number): string {
  return `/talks/slides/property-9-${index}.pdf`;
}

function sourceId(source: TalkSource, kind: string, index?: number): string {
  const suffix = index === undefined ? kind : `${kind}-${index}`;
  return source === "api" ? `api/${suffix}` : `git-${suffix}`;
}

function draftFor(mask: number, index: number, revision: number): boolean {
  const original = (mask & (1 << index)) !== 0;
  return revision % 2 === 0 ? original : !original;
}

function talkData(
  title: string,
  date: string,
  slides: string,
  scenario: Scenario,
  participantIndex: number,
  revision: number,
): ValidTalkData {
  const variant = scenario.fieldVariant + revision * 10_001 + participantIndex;

  return Object.freeze({
    title,
    eventName: `Property Nine Event ${variant}`,
    date,
    location: `Room ${variant}, Test City`,
    eventUrl: `https://events.example/property-nine/${variant}`,
    eventTypes: Object.freeze([
      `Generated ${variant}`,
      revision % 2 === 0 ? "Conference" : "Workshop",
    ]),
    slides,
    draft: draftFor(scenario.draftMask, participantIndex, revision),
  });
}

function participants(
  kind: ConflictKind,
  gitCount: number,
  apiCount: number,
  scenario: Scenario,
  revision: number,
): readonly TalkSourceRecord[] {
  const sources: TalkSource[] = [
    ...Array.from({ length: gitCount }, () => "git" as const),
    ...Array.from({ length: apiCount }, () => "api" as const),
  ];

  return sources.map((source, index) => {
    const id = sourceId(source, kind, index);
    const title =
      kind === "identity"
        ? CANONICALLY_EQUAL_TITLES[
            (scenario.titleOffset + index) % CANONICALLY_EQUAL_TITLES.length
          ]
        : `Distinct ${source} slide participant ${index} 🚀`;
    const date = kind === "identity" ? IDENTITY_DATE : SLIDE_DATE;
    const slides =
      kind === "identity" ? slidePath(index) : slidePath(SHARED_SLIDE_INDEX);

    return Object.freeze({
      id,
      data: talkData(title, date, slides, scenario, index, revision),
    });
  });
}

function buildScenarioRecords(
  scenario: Scenario,
  revision: number,
): ScenarioRecords {
  const identityRecords = participants(
    "identity",
    scenario.identityGitCount,
    scenario.identityApiCount,
    scenario,
    revision,
  );
  const slideRecords = participants(
    "slide",
    scenario.slideGitCount,
    scenario.slideApiCount,
    scenario,
    revision,
  );
  const invalidRecordId = sourceId(scenario.invalidSource, "invalid");
  const invalidData = {
    ...talkData(
      CANONICALLY_EQUAL_TITLES[scenario.titleOffset],
      IDENTITY_DATE,
      slidePath(SHARED_SLIDE_INDEX),
      scenario,
      10,
      revision,
    ),
    eventUrl: "http://events.example/not-https",
  } satisfies ValidTalkData;
  const unrelatedRecordId = sourceId(scenario.unrelatedSource, "unrelated");
  const unrelatedRecord = Object.freeze({
    id: unrelatedRecordId,
    data: talkData(
      `Unrelated valid talk ${scenario.fieldVariant}`,
      UNRELATED_DATE,
      slidePath(UNRELATED_SLIDE_INDEX),
      scenario,
      11,
      revision,
    ),
  });
  const records = Object.freeze([
    ...identityRecords,
    ...slideRecords,
    Object.freeze({ id: invalidRecordId, data: Object.freeze(invalidData) }),
    unrelatedRecord,
  ]);

  return Object.freeze({
    records,
    identityParticipantIds: Object.freeze(
      identityRecords.map((record) => record.id),
    ),
    slideParticipantIds: Object.freeze(slideRecords.map((record) => record.id)),
    invalidRecordId,
    unrelatedRecordId,
    identityValue: deriveTalkIdentity(
      IDENTITY_DATE,
      CANONICALLY_EQUAL_TITLES[scenario.titleOffset],
    ),
    slideValue: slidePath(SHARED_SLIDE_INDEX),
  });
}

function permuteRecords(
  records: readonly TalkSourceRecord[],
  priorities: readonly number[],
): readonly TalkSourceRecord[] {
  return records
    .map((record, index) => ({
      record,
      priority: priorities[index] ?? 0,
      index,
    }))
    .sort((left, right) =>
      left.priority === right.priority
        ? right.index - left.index
        : left.priority - right.priority,
    )
    .map(({ record }) => record);
}

function sourceDescription(id: string): string {
  return id.startsWith("api/")
    ? `API-authored record "${id}"`
    : `repository-authored record "${id}"`;
}

function expectedRemediation(ids: readonly string[]): string {
  const apiIds = [...ids]
    .filter((id) => id.startsWith("api/"))
    .sort((left, right) => left.localeCompare(right, "en"));
  const noun = apiIds.length === 1 ? "record" : "records";
  const names = apiIds.map((id) => `"${id}"`).join(", ");
  return `repository-authored records are authoritative; remove API-authored ${noun} ${names}`;
}

function expectedConflictMessage(
  kind: ConflictKind,
  value: string,
  ids: readonly string[],
): string {
  const orderedIds = [...ids].sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1,
  );
  const subject = kind === "identity" ? "talk identity" : "slide path";
  const sources = orderedIds.map(sourceDescription).join(", ");
  return `${subject} "${value}" is shared by ${sources}; ${expectedRemediation(orderedIds)}`;
}

async function captureAggregateFailure(
  records: readonly TalkSourceRecord[],
  projectRoot: string,
): Promise<TalkValidationError> {
  try {
    const snapshot = await resolveValidatedTalks(records, { projectRoot });
    assert.fail(
      `conflicting input returned a partial snapshot with ${snapshot.length} records`,
    );
  } catch (error: unknown) {
    assert.ok(error instanceof TalkValidationError);
    return error;
  }
}

function conflictIssues(
  error: TalkValidationError,
): readonly ValidationIssue[] {
  return error.issues.filter((issue) => issue.criterion === "7.4");
}

function assertConflictParticipants(
  issue: ValidationIssue,
  participantIds: readonly string[],
  excludedIds: readonly string[],
): void {
  for (const participantId of participantIds) {
    assert.match(issue.message, new RegExp(`"${participantId}"`, "u"));
  }

  for (const excludedId of excludedIds) {
    assert.doesNotMatch(issue.message, new RegExp(`"${excludedId}"`, "u"));
  }

  const remediation = issue.message.split("; ").at(-1) ?? "";
  for (const gitId of participantIds.filter((id) => !id.startsWith("api/"))) {
    assert.doesNotMatch(remediation, new RegExp(`"${gitId}"`, "u"));
  }
}

async function createFixtureProject(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "talk-gateway-p9-"));
  const slideDirectory = path.join(projectRoot, "public", "talks", "slides");
  await mkdir(slideDirectory, { recursive: true });

  await Promise.all(
    Array.from({ length: SLIDE_FILE_COUNT }, (_, index) =>
      writeFile(
        path.join(slideDirectory, `property-9-${index}.pdf`),
        PDF_TEST_FIXTURES.singlePage,
      ),
    ),
  );

  return projectRoot;
}

// Feature: talk-upload-endpoint, Property 9: The snapshot is complete, unique, and reports every conflict with its sources
// **Validates: Requirements 7.1, 7.3, 7.4, 7.5**
test("Property 9: conflict-aware snapshots fail completely with deterministic source diagnostics", async () => {
  const projectRoot = await createFixtureProject();

  try {
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async (scenario) => {
        const original = buildScenarioRecords(scenario, 0);
        const changed = buildScenarioRecords(scenario, 1);
        const permutedChangedRecords = permuteRecords(
          changed.records,
          scenario.permutationPriorities,
        );

        const originalError = await captureAggregateFailure(
          original.records,
          projectRoot,
        );
        const changedError = await captureAggregateFailure(
          permutedChangedRecords,
          projectRoot,
        );

        assert.equal(changedError.message, originalError.message);
        assert.deepEqual(changedError.issues, originalError.issues);
        assert.equal(originalError.issues.length, 3);

        const conflicts = conflictIssues(originalError);
        assert.equal(conflicts.length, 2);

        const identityIssue = conflicts.find(
          (issue) => issue.field === "record",
        );
        const slideIssue = conflicts.find((issue) => issue.field === "slides");
        assert.ok(identityIssue !== undefined);
        assert.ok(slideIssue !== undefined);

        assert.equal(
          identityIssue.message,
          expectedConflictMessage(
            "identity",
            original.identityValue,
            original.identityParticipantIds,
          ),
        );
        assert.equal(
          slideIssue.message,
          expectedConflictMessage(
            "slide",
            original.slideValue,
            original.slideParticipantIds,
          ),
        );

        const excludedIds = [
          original.invalidRecordId,
          original.unrelatedRecordId,
        ];
        assertConflictParticipants(
          identityIssue,
          original.identityParticipantIds,
          excludedIds,
        );
        assertConflictParticipants(
          slideIssue,
          original.slideParticipantIds,
          excludedIds,
        );

        const invalidIssues = originalError.issues.filter(
          (issue) => issue.recordId === original.invalidRecordId,
        );
        assert.equal(invalidIssues.length, 1);
        assert.equal(invalidIssues[0]?.field, "eventUrl");
        assert.equal(
          originalError.issues.some(
            (issue) => issue.recordId === original.unrelatedRecordId,
          ),
          false,
        );
      }),
      { numRuns: 120 },
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
