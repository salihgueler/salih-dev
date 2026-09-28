import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PDF_TEST_FIXTURES } from "./__fixtures__/pdf.js";
import { validatePdfAsset } from "./asset.js";
import {
  readPdfDocument,
  STRICT_PDF_DOCUMENT_OPTIONS,
  type PdfDocumentResult,
} from "./pdf-document.js";

const RECORD_ID = "parser-integration";

type FixtureName = keyof typeof PDF_TEST_FIXTURES;

type RejectedDocumentResult = Extract<PdfDocumentResult, { ok: false }>;

function rejection(result: PdfDocumentResult): RejectedDocumentResult {
  assert.equal(result.ok, false);
  return result as RejectedDocumentResult;
}

async function createFixtureProject(
  fixtureName: FixtureName,
): Promise<Readonly<{ projectRoot: string; slidePath: string }>> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "salih-dev-pdf-"));
  const slideDirectory = path.join(projectRoot, "public", "talks", "slides");
  await mkdir(slideDirectory, { recursive: true });

  const fileName = `${fixtureName}.pdf`;
  await writeFile(
    path.join(slideDirectory, fileName),
    PDF_TEST_FIXTURES[fixtureName],
  );

  return Object.freeze({
    projectRoot,
    slidePath: `/talks/slides/${fileName}`,
  });
}

async function withNetworkGuard<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (
    ..._arguments: Parameters<typeof fetch>
  ): ReturnType<typeof fetch> => {
    requestCount += 1;
    return Promise.reject(new Error("PDF validation attempted network access"));
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
    assert.equal(requestCount, 0, "PDF parsing must not call fetch");
  }
}

test("strict parser accepts reviewed one-page and multi-page fixtures", async () => {
  await withNetworkGuard(async () => {
    assert.deepEqual(await readPdfDocument(PDF_TEST_FIXTURES.singlePage), {
      ok: true,
      pageCount: 1,
    });
    assert.deepEqual(await readPdfDocument(PDF_TEST_FIXTURES.multiPage), {
      ok: true,
      pageCount: 2,
    });
  });
});

test("strict parser classifies invalid, encrypted, and empty-page fixtures", async () => {
  await withNetworkGuard(async () => {
    assert.equal(
      rejection(await readPdfDocument(PDF_TEST_FIXTURES.zeroByte)).rejection
        .kind,
      "signature",
    );
    assert.equal(
      rejection(await readPdfDocument(PDF_TEST_FIXTURES.wrongSignature))
        .rejection.kind,
      "signature",
    );
    assert.equal(
      rejection(await readPdfDocument(PDF_TEST_FIXTURES.truncated)).rejection
        .kind,
      "malformed",
    );
    assert.equal(
      rejection(
        await readPdfDocument(PDF_TEST_FIXTURES.encryptedUnreadable),
      ).rejection.kind,
      "encrypted",
    );
    assert.equal(
      rejection(await readPdfDocument(PDF_TEST_FIXTURES.zeroPage)).rejection
        .kind,
      "empty",
    );
  });
});

test("production asset validation delegates valid bytes to the strict parser", async (context) => {
  for (const fixtureName of ["singlePage", "multiPage"] as const) {
    const fixture = await createFixtureProject(fixtureName);
    context.after(() => rm(fixture.projectRoot, { recursive: true, force: true }));

    const direct = await readPdfDocument(PDF_TEST_FIXTURES[fixtureName]);
    const asset = await validatePdfAsset(fixture.slidePath, RECORD_ID, {
      projectRoot: fixture.projectRoot,
    });

    assert.equal(direct.ok, true);
    assert.equal(asset.ok, true);
    if (direct.ok && asset.ok) {
      assert.equal(asset.asset.pageCount, direct.pageCount);
      assert.equal(
        asset.asset.byteLength,
        PDF_TEST_FIXTURES[fixtureName].byteLength,
      );
      assert.deepEqual(
        Uint8Array.from(await readFile(asset.asset.slideFilePath)),
        PDF_TEST_FIXTURES[fixtureName],
      );
    }
  }
});

test("production asset validation preserves talks diagnostics for rejected bytes", async (context) => {
  const cases = [
    {
      fixtureName: "zeroByte",
      criterion: "2.7",
      message: /which is empty and cannot be read as a PDF document$/u,
    },
    {
      fixtureName: "wrongSignature",
      criterion: "6.6",
      message:
        /does not begin with the %PDF- header and does not open as a PDF document$/u,
    },
    {
      fixtureName: "truncated",
      criterion: "6.6",
      message: /PDF validation failed: .* for \/talks\/slides\/truncated\.pdf$/u,
    },
    {
      fixtureName: "encryptedUnreadable",
      criterion: "6.6",
      message:
        /document is encrypted and cannot be read without a password .* for \/talks\/slides\/encryptedUnreadable\.pdf$/u,
    },
    {
      fixtureName: "zeroPage",
      criterion: "6.6",
      message:
        /^PDF validation failed: \/talks\/slides\/zeroPage\.pdf contains no pages$/u,
    },
  ] as const;

  await withNetworkGuard(async () => {
    for (const fixtureCase of cases) {
      const fixture = await createFixtureProject(fixtureCase.fixtureName);
      context.after(() =>
        rm(fixture.projectRoot, { recursive: true, force: true }),
      );

      const direct = await readPdfDocument(
        PDF_TEST_FIXTURES[fixtureCase.fixtureName],
      );
      const asset = await validatePdfAsset(fixture.slidePath, RECORD_ID, {
        projectRoot: fixture.projectRoot,
      });

      assert.equal(direct.ok, false);
      assert.equal(asset.ok, false);
      if (!asset.ok) {
        assert.equal(asset.issues.length, 1);
        assert.deepEqual(
          {
            recordId: asset.issues[0]?.recordId,
            field: asset.issues[0]?.field,
            criterion: asset.issues[0]?.criterion,
          },
          {
            recordId: RECORD_ID,
            field: "slides",
            criterion: fixtureCase.criterion,
          },
        );
        assert.match(asset.issues[0]?.message ?? "", fixtureCase.message);
      }
    }
  });
});

test("production parser options prohibit recovery, network helpers, and evaluation", () => {
  assert.deepEqual(STRICT_PDF_DOCUMENT_OPTIONS, {
    stopAtErrors: true,
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    isEvalSupported: false,
  });
  assert.ok(Object.isFrozen(STRICT_PDF_DOCUMENT_OPTIONS));
});
