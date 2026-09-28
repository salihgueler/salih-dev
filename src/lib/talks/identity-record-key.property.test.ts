import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  deriveTalkIdentity,
  deriveTalkRecordKey,
  isTalkRecordKey,
  type TalkIdentity,
  type TalkRecordKey,
} from "./identity.js";

const RECORD_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{16}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const dateArbitrary = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([year, month, day]) =>
      `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
  );

const titleArbitrary = fc
  .array(fc.stringMatching(/^[a-z]{1,12}$/u), {
    minLength: 1,
    maxLength: 6,
  })
  .map((words) => `Author/Text_${words.join(" ")}`);

type IdentityPair = Readonly<{
  left: TalkIdentity;
  right: TalkIdentity;
}>;

const equalIdentityPairArbitrary: fc.Arbitrary<IdentityPair> = fc
  .tuple(dateArbitrary, titleArbitrary)
  .map(([date, title]) => ({
    left: deriveTalkIdentity(date, `  ${title.toUpperCase()}  `),
    right: deriveTalkIdentity(date, title),
  }));

const unequalDatePairArbitrary: fc.Arbitrary<IdentityPair> = fc
  .tuple(dateArbitrary, titleArbitrary)
  .map(([date, title]) => {
    const year = Number.parseInt(date.slice(0, 4), 10);
    const otherYear = year === 2099 ? 2000 : year + 1;
    const otherDate = `${otherYear.toString().padStart(4, "0")}${date.slice(4)}`;

    return {
      left: deriveTalkIdentity(date, title),
      right: deriveTalkIdentity(otherDate, title),
    };
  });

const unequalTitlePairArbitrary: fc.Arbitrary<IdentityPair> = fc
  .tuple(dateArbitrary, titleArbitrary)
  .map(([date, title]) => ({
    left: deriveTalkIdentity(date, `${title} left`),
    right: deriveTalkIdentity(date, `${title} right`),
  }));

function assertSafeRecordKey(
  identity: TalkIdentity,
  recordKey: TalkRecordKey,
): void {
  const separatorIndex = identity.indexOf("|");
  const date = identity.slice(0, separatorIndex);
  const canonicalTitle = identity.slice(separatorIndex + 1);

  assert.match(date, DATE_PATTERN);
  assert.equal(isTalkRecordKey(recordKey), true);
  assert.match(recordKey, RECORD_KEY_PATTERN);
  assert.equal(recordKey.startsWith(`${date}-`), true);
  assert.equal(recordKey.includes(canonicalTitle), false);
  assert.doesNotMatch(recordKey, /[/\\]/u);
  assert.doesNotMatch(recordKey, /\s|\p{Cc}/u);
  assert.doesNotMatch(recordKey, /%[0-9a-f]{2}/iu);
}

// Feature: talk-upload-endpoint, Property 8: Equal identity derives equal record key
// **Validates: Requirements 7.7, 9.4**
test("Property 8: record-key equality is equivalent to canonical identity equality", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        equalIdentityPairArbitrary,
        unequalDatePairArbitrary,
        unequalTitlePairArbitrary,
      ),
      ({ left, right }) => {
        const leftKey = deriveTalkRecordKey(left);
        const rightKey = deriveTalkRecordKey(right);

        assert.equal(leftKey === rightKey, left === right);
        assertSafeRecordKey(left, leftKey);
        assertSafeRecordKey(right, rightKey);
      },
    ),
    { numRuns: 200 },
  );
});
