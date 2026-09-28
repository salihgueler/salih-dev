import assert from "node:assert/strict";
import test from "node:test";

import * as fc from "fast-check";

import { deriveTalkIdentity } from "./identity.js";

type TalkSource = "api" | "git";

type UnrelatedTalkFields = Readonly<{
  source: TalkSource;
  id: string;
  draft: boolean;
  eventName: string;
  location: string;
  slides: string;
}>;

type IdentityCandidate = UnrelatedTalkFields &
  Readonly<{
    date: string;
    title: string;
  }>;

type StringPair = readonly [string, string];

const DAY_IN_MILLISECONDS = 86_400_000;
const FIRST_DATE_MILLISECONDS = Date.UTC(2000, 0, 1);
const LAST_DATE_OFFSET = 36_524;

const isoDateArbitrary = fc
  .integer({ min: 0, max: LAST_DATE_OFFSET })
  .map((dayOffset) =>
    new Date(
      FIRST_DATE_MILLISECONDS + dayOffset * DAY_IN_MILLISECONDS,
    )
      .toISOString()
      .slice(0, 10),
  );

function orientedPair(first: string, second: string): fc.Arbitrary<StringPair> {
  return fc.boolean().map((reverse) =>
    reverse ? ([second, first] as const) : ([first, second] as const),
  );
}

const combiningFormPairArbitrary = orientedPair("CAFÉ", "cafe\u0301");
const astralCasePairArbitrary = orientedPair("\u{10400}\u{10401}", "\u{10428}\u{10429}");
const ordinaryCasePairArbitrary = orientedPair("AGENT READY", "agent ready");
const astralSymbolPairArbitrary = fc.constant(["🚀", "🚀"] as const);
const whitespacePairArbitrary = fc.constantFrom<StringPair>(
  [" ", "   "],
  ["\t", "\t\t"],
  ["\n", "\r\n"],
  ["\u00a0", "\u2003\u2003"],
);

const equivalentTitlePairArbitrary: fc.Arbitrary<StringPair> = fc
  .tuple(
    combiningFormPairArbitrary,
    astralCasePairArbitrary,
    ordinaryCasePairArbitrary,
    astralSymbolPairArbitrary,
    whitespacePairArbitrary,
    whitespacePairArbitrary,
    whitespacePairArbitrary,
    whitespacePairArbitrary,
    whitespacePairArbitrary,
  )
  .map(
    ([combining, astralCase, ordinaryCase, astralSymbol, ...whitespace]) => {
      const left =
        whitespace[0][0] +
        combining[0] +
        whitespace[1][0] +
        astralCase[0] +
        whitespace[2][0] +
        ordinaryCase[0] +
        whitespace[3][0] +
        astralSymbol[0] +
        whitespace[4][0];
      const right =
        whitespace[0][1] +
        combining[1] +
        whitespace[1][1] +
        astralCase[1] +
        whitespace[2][1] +
        ordinaryCase[1] +
        whitespace[3][1] +
        astralSymbol[1] +
        whitespace[4][1];

      return [left, right] as const;
    },
  );

const titleAtomArbitrary = fc.constantFrom(
  "Talk",
  "TALK",
  "Café",
  "cafe\u0301",
  "Ångström",
  "A\u030Angstro\u0308m",
  "\u{10400}\u{10401}",
  "\u{10428}\u{10429}",
  "🚀",
  "Agent Ready",
);

const generalTitleArbitrary = fc.oneof(
  equivalentTitlePairArbitrary.chain(([left, right]) =>
    fc.constantFrom(left, right),
  ),
  fc
    .array(titleAtomArbitrary, { minLength: 1, maxLength: 6 })
    .map((atoms) => atoms.join(" ")),
);

const unrelatedTalkFieldsArbitrary: fc.Arbitrary<UnrelatedTalkFields> = fc.record({
  source: fc.constantFrom<TalkSource>("git", "api"),
  id: fc.string({ minLength: 1, maxLength: 48 }),
  draft: fc.boolean(),
  eventName: fc.string({ maxLength: 64 }),
  location: fc.string({ maxLength: 64 }),
  slides: fc.string({ maxLength: 80 }),
});

const identityCandidateArbitrary: fc.Arbitrary<IdentityCandidate> = fc.record({
  date: isoDateArbitrary,
  title: generalTitleArbitrary,
  source: fc.constantFrom<TalkSource>("git", "api"),
  id: fc.string({ minLength: 1, maxLength: 48 }),
  draft: fc.boolean(),
  eventName: fc.string({ maxLength: 64 }),
  location: fc.string({ maxLength: 64 }),
  slides: fc.string({ maxLength: 80 }),
});

function canonicalizeTitle(title: string): string {
  return title
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function expectedIdentity(date: string, title: string): string {
  return `${date}|${canonicalizeTitle(title)}`;
}

function withIdentityFields(
  fields: UnrelatedTalkFields,
  date: string,
  title: string,
): IdentityCandidate {
  return { ...fields, date, title };
}

// Feature: talk-upload-endpoint, Property 7: Talk identity derivation is canonical and source-independent
// **Validates: Requirements 7.2**
test("Property 7: talk identity derivation is canonical and source-independent", () => {
  fc.assert(
    fc.property(
      identityCandidateArbitrary,
      identityCandidateArbitrary,
      equivalentTitlePairArbitrary,
      isoDateArbitrary,
      unrelatedTalkFieldsArbitrary,
      (first, second, equivalentTitles, date, unrelatedFields) => {
        const firstIdentity = deriveTalkIdentity(first.date, first.title);
        const secondIdentity = deriveTalkIdentity(second.date, second.title);
        const titlesAreCanonicallyEqual =
          canonicalizeTitle(first.title) === canonicalizeTitle(second.title);

        assert.equal(firstIdentity, expectedIdentity(first.date, first.title));
        assert.equal(secondIdentity, expectedIdentity(second.date, second.title));
        assert.equal(
          firstIdentity === secondIdentity,
          first.date === second.date && titlesAreCanonicallyEqual,
        );

        const gitRecord = withIdentityFields(
          { ...unrelatedFields, source: "git" },
          date,
          equivalentTitles[0],
        );
        const apiRecord = withIdentityFields(
          {
            source: "api",
            id: `${unrelatedFields.id}-changed`,
            draft: !unrelatedFields.draft,
            eventName: `${unrelatedFields.eventName}-changed`,
            location: `${unrelatedFields.location}-changed`,
            slides: `${unrelatedFields.slides}-changed`,
          },
          date,
          equivalentTitles[1],
        );
        const gitIdentity = deriveTalkIdentity(gitRecord.date, gitRecord.title);
        const apiIdentity = deriveTalkIdentity(apiRecord.date, apiRecord.title);

        assert.notEqual(gitRecord.title, apiRecord.title);
        assert.deepEqual(
          canonicalizeTitle(gitRecord.title),
          canonicalizeTitle(apiRecord.title),
        );
        assert.equal(gitIdentity, apiIdentity);
        assert.equal(gitIdentity, expectedIdentity(date, gitRecord.title));

        const differentDate = new Date(
          Date.parse(`${date}T00:00:00.000Z`) + DAY_IN_MILLISECONDS,
        )
          .toISOString()
          .slice(0, 10);
        assert.notEqual(
          deriveTalkIdentity(differentDate, apiRecord.title),
          gitIdentity,
        );
      },
    ),
    { numRuns: 250 },
  );
});
