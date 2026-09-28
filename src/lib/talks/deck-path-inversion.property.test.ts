import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  API_SLIDE_PREFIX,
  approvedDeckKey,
  deckIdFromSlidePath,
  deckSlidePath,
  isDeckId,
  pendingDeckKey,
  type DeckId,
} from "./deck.js";

const FEATURE_SLIDE_PATH_PATTERN =
  /^\/talks\/slides\/api\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/;

const deckIdArbitrary: fc.Arbitrary<DeckId> = fc
  .uuid({ version: 4 })
  .map((value) => {
    assert.ok(isDeckId(value));
    return value;
  });

const structuredInvalidPathArbitrary: fc.Arbitrary<string> = fc
  .tuple(
    deckIdArbitrary,
    fc.constantFrom(
      "approved-key",
      "pending-key",
      "missing-leading-slash",
      "wrong-extension-case",
      "nested-id",
      "query-string",
      "fragment",
      "encoded-extension",
      "trailing-segment",
      "wrong-version",
      "wrong-variant",
    ),
  )
  .map(([deckId, mutation]) => {
    switch (mutation) {
      case "approved-key":
        return approvedDeckKey(deckId);
      case "pending-key":
        return pendingDeckKey(deckId);
      case "missing-leading-slash":
        return deckSlidePath(deckId).slice(1);
      case "wrong-extension-case":
        return `${API_SLIDE_PREFIX}${deckId}.PDF`;
      case "nested-id":
        return `${API_SLIDE_PREFIX}nested/${deckId}.pdf`;
      case "query-string":
        return `${deckSlidePath(deckId)}?download=1`;
      case "fragment":
        return `${deckSlidePath(deckId)}#page=1`;
      case "encoded-extension":
        return `${API_SLIDE_PREFIX}${deckId}%2epdf`;
      case "trailing-segment":
        return `${deckSlidePath(deckId)}/extra`;
      case "wrong-version":
        return `${API_SLIDE_PREFIX}${deckId.slice(0, 14)}1${deckId.slice(15)}.pdf`;
      case "wrong-variant":
        return `${API_SLIDE_PREFIX}${deckId.slice(0, 19)}7${deckId.slice(20)}.pdf`;
    }
  });

const nonFeaturePathArbitrary: fc.Arbitrary<string> = fc.oneof(
  structuredInvalidPathArbitrary,
  fc.string().filter((value) => !FEATURE_SLIDE_PATH_PATTERN.test(value)),
);

// Feature: talk-upload-endpoint, Property 3: Storage key and slide path round trip
// **Validates: Requirements 5.2, 8.3**
test("Property 3: storage keys remain private while derived slide paths invert exactly", () => {
  fc.assert(
    fc.property(deckIdArbitrary, (deckId) => {
      const pendingKey = pendingDeckKey(deckId);
      const approvedKey = approvedDeckKey(deckId);
      const slidePath = deckSlidePath(deckId);

      assert.equal(deckIdFromSlidePath(slidePath), deckId);
      assert.equal(deckIdFromSlidePath(pendingKey), null);
      assert.equal(deckIdFromSlidePath(approvedKey), null);
      assert.equal(
        slidePath,
        `${API_SLIDE_PREFIX}${approvedKey.slice("talks/decks/".length)}`,
      );
    }),
    { numRuns: 100 },
  );
});

// Feature: talk-upload-endpoint, Property 3: Storage key and slide path round trip
// **Validates: Requirements 5.2, 8.3**
test("Property 3: paths not emitted by the feature never recover a deck ID", () => {
  fc.assert(
    fc.property(nonFeaturePathArbitrary, (path) => {
      assert.equal(FEATURE_SLIDE_PATH_PATTERN.test(path), false);
      assert.equal(deckIdFromSlidePath(path), null);
    }),
    { numRuns: 100 },
  );
});
