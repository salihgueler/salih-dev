import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import fc from "fast-check";

import { resolveSlideAsset } from "./asset.js";
import {
  API_SLIDE_PREFIX,
  APPROVED_DECK_PREFIX,
  PENDING_DECK_PREFIX,
  approvedDeckKey,
  deckSlidePath,
  isDeckId,
  pendingDeckKey,
  type DeckId,
} from "./deck.js";
import { validateSlidePath } from "./validation.js";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const PERCENT_ENCODED_PATTERN = /%[0-9a-f]{2}/iu;

const deckIdArbitrary = fc
  .uuid({ version: 4 })
  .filter(isDeckId)
  .map((value): DeckId => value);

const distinctDeckIdsArbitrary = fc.uniqueArray(deckIdArbitrary, {
  minLength: 2,
  maxLength: 32,
  selector: (deckId) => deckId,
});

const adversarialPathTextArbitrary = fc.constantFrom(
  "/../outside.pdf",
  "/./outside.pdf",
  "//outside.pdf",
  "\\outside.pdf",
  "/%2e%2e/outside.pdf",
  "/%2foutside.pdf",
  "?download=1",
  "#page=1",
  "/ outside.pdf",
  "/\u0000outside.pdf",
);

function assertSafeSyntax(value: string): void {
  assert.equal(value.includes("\\"), false);
  assert.equal(/\s/u.test(value), false);
  assert.equal(CONTROL_CHARACTER_PATTERN.test(value), false);
  assert.equal(PERCENT_ENCODED_PATTERN.test(value), false);
  assert.equal(
    value.split("/").some((segment) => segment === "." || segment === ".."),
    false,
  );
}

function assertInsideDirectory(candidate: string, directory: string): void {
  const relative = path.relative(directory, candidate);

  assert.notEqual(relative, "");
  assert.equal(path.isAbsolute(relative), false);
  assert.equal(relative.split(path.sep).includes(".."), false);
}

// Feature: talk-upload-endpoint, Property 2: Derived storage keys and slide paths are safe, code-owned, and distinct
// **Validates: Requirements 5.1, 5.2, 5.4, 5.5**
test("Property 2: derived deck locations are safe, code-owned, and distinct", () => {
  fc.assert(
    fc.property(
      distinctDeckIdsArbitrary,
      fc.array(adversarialPathTextArbitrary, {
        minLength: 1,
        maxLength: 8,
      }),
      (deckIds, adversarialPathTexts) => {
        const pendingKeys: string[] = [];
        const approvedKeys: string[] = [];
        const slidePaths: string[] = [];
        const projectRoot = path.resolve("property-tests", ...adversarialPathTexts);
        const apiSlideDirectory = path.resolve(
          projectRoot,
          "public",
          "talks",
          "slides",
          "api",
        );

        for (const deckId of deckIds) {
          const pendingKey = pendingDeckKey(deckId);
          const approvedKey = approvedDeckKey(deckId);
          const slidePath = deckSlidePath(deckId);
          const expectedFileName = `${deckId}.pdf`;

          assert.match(deckId, UUID_V4_PATTERN);
          assert.equal(
            pendingKey,
            `${PENDING_DECK_PREFIX}${expectedFileName}`,
          );
          assert.equal(
            approvedKey,
            `${APPROVED_DECK_PREFIX}${expectedFileName}`,
          );
          assert.equal(slidePath, `${API_SLIDE_PREFIX}${expectedFileName}`);

          assertSafeSyntax(pendingKey);
          assertSafeSyntax(approvedKey);
          assertSafeSyntax(slidePath);
          assert.equal(validateSlidePath(slidePath), slidePath);

          const resolved = resolveSlideAsset(slidePath, { projectRoot });
          assert.ok(resolved !== null);
          assert.equal(
            resolved.slideFilePath,
            path.join(apiSlideDirectory, expectedFileName),
          );
          assertInsideDirectory(resolved.slideFilePath, apiSlideDirectory);

          for (const adversarialPathText of adversarialPathTexts) {
            assert.equal(
              validateSlidePath(`${slidePath}${adversarialPathText}`),
              null,
            );
          }

          pendingKeys.push(pendingKey);
          approvedKeys.push(approvedKey);
          slidePaths.push(slidePath);
        }

        assert.equal(new Set(pendingKeys).size, deckIds.length);
        assert.equal(new Set(approvedKeys).size, deckIds.length);
        assert.equal(new Set(slidePaths).size, deckIds.length);
        assert.equal(
          new Set([...pendingKeys, ...approvedKeys]).size,
          deckIds.length * 2,
        );
      },
    ),
    { numRuns: 100 },
  );
});
