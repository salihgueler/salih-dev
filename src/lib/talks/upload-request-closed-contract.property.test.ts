import assert from "node:assert/strict";
import test from "node:test";

import * as fc from "fast-check";

import {
  deriveTalkIdentity,
  deriveTalkRecordKey,
  type TalkRecordKey,
} from "./identity.js";
import {
  parseTalkUploadRequest,
  TALK_UPLOAD_METADATA_FIELDS,
  TALK_UPLOAD_REPLACEMENT_FIELDS,
  TALK_UPLOAD_REQUEST_FIELDS,
  type UploadIssue,
  type UploadRequestResult,
} from "./upload-request.js";

type ContractPath = "request" | "metadata" | "replaces";
type UnsupportedMemberIssue = Extract<
  UploadIssue,
  { code: "unsupported_member" }
>;
type ValidMetadata = Readonly<{
  title: string;
  eventName: string;
  date: string;
  location: string;
  eventUrl: string;
  eventTypes: readonly string[];
  videoUrl?: string;
  sourceCodeUrl?: string;
  draft: boolean;
}>;
type ValidReplacement = Readonly<{
  recordKey: TalkRecordKey;
  version: string;
}>;
type ExtraMembers = Readonly<Record<string, unknown>>;

const SLIDE_PATH =
  "/talks/slides/api/123e4567-e89b-42d3-a456-426614174000.pdf";
const DAY_IN_MILLISECONDS = 86_400_000;
const FIRST_DATE_MILLISECONDS = Date.UTC(2000, 0, 1);
const LAST_DATE_OFFSET = 36_524;

const storageShapedMemberNames = [
  "slides",
  "slidePath",
  "storageKey",
  "approvedStorageKey",
  "pendingKey",
  "objectKey",
  "key",
  "Key",
  "filename",
  "fileName",
  "filePath",
  "path",
  "bucket",
  "prefix",
] as const;

const isoDateArbitrary = fc
  .integer({ min: 0, max: LAST_DATE_OFFSET })
  .map((dayOffset) =>
    new Date(FIRST_DATE_MILLISECONDS + dayOffset * DAY_IN_MILLISECONDS)
      .toISOString()
      .slice(0, 10),
  );

const displayWordArbitrary = fc.constantFrom(
  "Agent",
  "Architecture",
  "Building",
  "Café",
  "Cloud",
  "Resilience",
  "Serverless",
  "Systems",
  "Testing",
  "🚀",
);

const displayTextArbitrary = fc
  .array(displayWordArbitrary, { minLength: 1, maxLength: 6 })
  .map((words) => words.join(" "));

const eventTypesArbitrary = fc.uniqueArray(
  fc.constantFrom("Conference", "Meetup", "Workshop", "Webinar"),
  { minLength: 1, maxLength: 4 },
);

const validMetadataArbitrary: fc.Arbitrary<ValidMetadata> = fc
  .record({
    title: displayTextArbitrary,
    eventName: displayTextArbitrary,
    date: isoDateArbitrary,
    location: displayTextArbitrary,
    eventUrl: fc.constant("https://events.example/talk"),
    eventTypes: eventTypesArbitrary,
    videoUrl: fc.option(
      fc.constant("https://www.youtube.com/watch?v=abcdefghijk"),
      { nil: undefined },
    ),
    sourceCodeUrl: fc.option(
      fc.constant("https://github.com/example/talk-demo"),
      { nil: undefined },
    ),
    draft: fc.boolean(),
  })
  .map((metadata) => Object.freeze(metadata));

function extraMemberNameArbitrary(
  allowedMembers: readonly string[],
): fc.Arbitrary<string> {
  const allowed = new Set(allowedMembers);
  const biasedStorageName = fc.constantFrom(...storageShapedMemberNames);
  const arbitraryName = fc.string({ minLength: 0, maxLength: 48 });

  return fc
    .oneof(
      biasedStorageName,
      biasedStorageName,
      biasedStorageName,
      arbitraryName,
    )
    .filter((member) => !allowed.has(member));
}

function extraMembersArbitrary(
  allowedMembers: readonly string[],
): fc.Arbitrary<ExtraMembers> {
  return fc.dictionary(
    extraMemberNameArbitrary(allowedMembers),
    fc.jsonValue(),
    { minKeys: 1, maxKeys: 8 },
  );
}

const requestExtrasArbitrary = extraMembersArbitrary(
  TALK_UPLOAD_REQUEST_FIELDS,
);
const metadataExtrasArbitrary = extraMembersArbitrary(
  TALK_UPLOAD_METADATA_FIELDS,
);
const replacementExtrasArbitrary = extraMembersArbitrary(
  TALK_UPLOAD_REPLACEMENT_FIELDS,
);

function replacementFor(metadata: ValidMetadata): ValidReplacement {
  const identity = deriveTalkIdentity(metadata.date, metadata.title);

  return Object.freeze({
    recordKey: deriveTalkRecordKey(identity),
    version: '"stored-version"',
  });
}

function assertUnsupportedMembers(
  result: UploadRequestResult,
  path: ContractPath,
  extraMembers: ExtraMembers,
): void {
  assert.equal(result.ok, false);
  assert.equal("request" in result, false);

  if (result.ok) {
    assert.fail("a request with unsupported members must not be accepted");
  }

  const actualIssues = result.issues.filter(
    (issue): issue is UnsupportedMemberIssue =>
      issue.code === "unsupported_member" && issue.path === path,
  );
  const actualMembers = actualIssues.map((issue) => issue.member).sort();
  const expectedMembers = Object.keys(extraMembers).sort();

  assert.deepEqual(actualMembers, expectedMembers);
  for (const member of expectedMembers) {
    assert.ok(
      actualIssues.some(
        (issue) =>
          issue.member === member && issue.message.includes(JSON.stringify(member)),
      ),
      `expected ${path} diagnostic to name ${JSON.stringify(member)}`,
    );
  }
}

// Feature: talk-upload-endpoint, Property 4: Unsupported request members are always rejected and named
// **Validates: Requirements 2.6, 5.3, 6.2**
test("Property 4: unsupported request members are always rejected and named", () => {
  fc.assert(
    fc.property(
      validMetadataArbitrary,
      requestExtrasArbitrary,
      metadataExtrasArbitrary,
      replacementExtrasArbitrary,
      (metadata, requestExtras, metadataExtras, replacementExtras) => {
        const replacement = replacementFor(metadata);
        const validRequest = Object.freeze({
          metadata,
          replaces: replacement,
        });
        const baseline = parseTalkUploadRequest(validRequest, SLIDE_PATH);

        assert.equal(baseline.ok, true);

        assertUnsupportedMembers(
          parseTalkUploadRequest(
            { ...validRequest, ...requestExtras },
            SLIDE_PATH,
          ),
          "request",
          requestExtras,
        );
        assertUnsupportedMembers(
          parseTalkUploadRequest(
            {
              ...validRequest,
              metadata: { ...metadata, ...metadataExtras },
            },
            SLIDE_PATH,
          ),
          "metadata",
          metadataExtras,
        );
        assertUnsupportedMembers(
          parseTalkUploadRequest(
            {
              ...validRequest,
              replaces: { ...replacement, ...replacementExtras },
            },
            SLIDE_PATH,
          ),
          "replaces",
          replacementExtras,
        );
      },
    ),
    { numRuns: 250 },
  );
});
