/**
 * Strict PDF byte validation shared by build-time assets and upload handling.
 *
 * The parser receives only an in-memory byte array, never a URL. Network,
 * worker-fetch, font, canvas, image-decoder, and dynamic-evaluation capabilities
 * are disabled, and strict parsing retrieves every page before acceptance.
 */

import {
  getDocument,
  InvalidPDFException,
  PasswordException,
  VerbosityLevel,
} from "pdfjs-dist/legacy/build/pdf.mjs";

/** Leading bytes every accepted PDF document must begin with. */
export const PDF_SIGNATURE = "%PDF-";

/**
 * Exact strict parser options shared by every PDF-byte caller.
 *
 * Exporting the immutable options keeps the security boundary reviewable and
 * lets integration tests prove that recovery, network/font/canvas helpers, and
 * dynamic evaluation remain disabled without replacing the real parser.
 */
export const STRICT_PDF_DOCUMENT_OPTIONS = Object.freeze({
  stopAtErrors: true,
  verbosity: VerbosityLevel.ERRORS,
  disableFontFace: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  isEvalSupported: false,
});

/** Classified reason an in-memory PDF document was rejected. */
export type PdfRejection = Readonly<{
  kind: "signature" | "encrypted" | "malformed" | "empty";
  message: string;
}>;

/** Result of validating and completely parsing one in-memory PDF document. */
export type PdfDocumentResult =
  | Readonly<{ ok: true; pageCount: number }>
  | Readonly<{ ok: false; rejection: PdfRejection }>;

/** Extracts a printable detail from an unknown thrown value. */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return String(error);
}

function rejected(
  kind: PdfRejection["kind"],
  message: string,
): Readonly<{ ok: false; rejection: PdfRejection }> {
  return Object.freeze({
    ok: false as const,
    rejection: Object.freeze({ kind, message }),
  });
}

/** True when the bytes begin with the PDF header sequence. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_SIGNATURE.length) return false;

  for (let index = 0; index < PDF_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PDF_SIGNATURE.charCodeAt(index)) return false;
  }

  return true;
}

/**
 * Validates the PDF signature, parses the complete document with the pinned
 * legacy parser in strict/non-recovery mode, and returns its positive page
 * count. Every page is retrieved so a truncated or structurally damaged page
 * tree fails here instead of reaching a caller.
 *
 * The loading task is always destroyed so no worker or buffer is retained.
 */
export async function readPdfDocument(
  bytes: Uint8Array,
): Promise<PdfDocumentResult> {
  if (!hasPdfSignature(bytes)) {
    return rejected(
      "signature",
      `PDF validation failed: the document does not begin with the ${PDF_SIGNATURE} header and does not open as a PDF document`,
    );
  }

  const loadingTask = getDocument({
    data: bytes,
    ...STRICT_PDF_DOCUMENT_OPTIONS,
  });

  try {
    const document = await loadingTask.promise;
    const pageCount = document.numPages;

    if (pageCount < 1) {
      return rejected(
        "empty",
        "PDF validation failed: the document contains no pages",
      );
    }

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      await document.getPage(pageNumber);
    }

    return Object.freeze({ ok: true as const, pageCount });
  } catch (error: unknown) {
    if (error instanceof PasswordException) {
      return rejected(
        "encrypted",
        `PDF validation failed: the document is encrypted and cannot be read without a password (${describeError(error)})`,
      );
    }

    if (error instanceof InvalidPDFException) {
      return rejected(
        "malformed",
        `PDF validation failed: the document is not a valid PDF (${describeError(error)})`,
      );
    }

    return rejected(
      "malformed",
      `PDF validation failed: the document could not be parsed (${describeError(error)})`,
    );
  } finally {
    // Cleanup must never mask the validation outcome, so a teardown failure is
    // swallowed rather than replacing the diagnostic the Author needs.
    await loadingTask.destroy().catch(() => undefined);
  }
}
