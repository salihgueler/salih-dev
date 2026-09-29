/**
 * Talks slide-asset validation.
 *
 * Feature: talks-section
 *
 * This module is the only place that touches slide bytes on disk. It resolves a
 * validated root-relative slide path beneath `public/talks/slides/`, proves the
 * resolved path stays inside that directory, and delegates complete document
 * parsing to the shared strict PDF byte validator.
 *
 * The validator is read-only by construction: it opens files for reading, never
 * writes, repairs, moves, or removes an author asset, and returns immutable
 * size/page diagnostics for build verification rather than public display. It is
 * build/test-only code and performs no network request.
 */

import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import type {
  HttpsUrl,
  SlidePath,
  TalkCriterion,
  ValidationIssue,
} from "./model.js";
import { hasPdfSignature, PDF_SIGNATURE, readPdfDocument } from "./pdf-document.js";
import {
  deriveSlidePublicUrl,
  TALK_SLIDE_PATH_PREFIX,
  validateSlidePath,
} from "./validation.js";

export { PDF_SIGNATURE } from "./pdf-document.js";

/** Repository-relative directory that holds every author-managed slide deck. */
export const SLIDE_DIRECTORY_SEGMENTS = ["public", "talks", "slides"] as const;

/** Criterion reported when the slide association or path is unsafe. */
const CRITERION_ASSOCIATION: TalkCriterion = "6.7";

/** Criterion reported when the referenced file cannot be read as content. */
const CRITERION_READABLE: TalkCriterion = "2.7";

/** Criterion reported when the bytes are not a readable, non-empty PDF. */
const CRITERION_PDF_DOCUMENT: TalkCriterion = "6.6";

/**
 * Immutable diagnostics for one accepted slide deck. `byteLength` and
 * `pageCount` exist for build verification and author-facing troubleshooting;
 * they are not part of any public representation.
 */
export type ValidatedSlideAsset = Readonly<{
  slidePath: SlidePath;
  slideFilePath: string;
  slidePublicUrl: HttpsUrl;
  byteLength: number;
  pageCount: number;
}>;

/** Outcome of validating one slide association. */
export type SlideAssetValidationResult =
  | Readonly<{ ok: true; asset: ValidatedSlideAsset }>
  | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>;

/** Overrides used by build-time verification and integration fixtures. */
export type SlideAssetValidationOptions = Readonly<{
  /**
   * Directory that contains `public/talks/slides/`. Defaults to the current
   * working directory, which is the repository root for every `npm` script.
   */
  projectRoot?: string;
  /**
   * Skip the full pdfjs parse of the deck bytes, keeping every other check
   * (safe path, existence, non-empty, PDF signature). The request-time renderer
   * sets this: the deck was already fully validated when the Author published
   * it, and re-parsing every PDF on each render would pull the pdfjs native
   * canvas dependency into the Lambda and cost a full parse per request for a
   * `pageCount` that is a build-time diagnostic and appears in no public
   * representation. When set, an accepted asset reports `pageCount` 0.
   */
  skipPdfParse?: boolean;
}>;

function issue(
  recordId: string,
  criterion: TalkCriterion,
  message: string,
): ValidationIssue {
  return Object.freeze({
    recordId,
    field: "slides" as const,
    criterion,
    message,
  });
}

function rejected(
  recordId: string,
  criterion: TalkCriterion,
  message: string,
): Readonly<{ ok: false; issues: readonly ValidationIssue[] }> {
  return Object.freeze({
    ok: false as const,
    issues: Object.freeze([issue(recordId, criterion, message)]),
  });
}

function accepted(
  asset: ValidatedSlideAsset,
): Readonly<{ ok: true; asset: ValidatedSlideAsset }> {
  return Object.freeze({ ok: true as const, asset });
}

/** Extracts a printable detail from an unknown thrown value. */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return String(error);
}

/** Reads the POSIX error code of a Node filesystem rejection, if present. */
function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

/**
 * Absolute path of the directory that must contain every slide deck. The
 * project root follows the repository convention of resolving build-time paths
 * from the working directory.
 */
export function resolveSlideDirectory(projectRoot?: string): string {
  return path.resolve(
    projectRoot ?? process.cwd(),
    ...SLIDE_DIRECTORY_SEGMENTS,
  );
}

/** True when `candidate` is a descendant of `directory`, not the directory. */
function isInsideDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);

  if (relative === "" || path.isAbsolute(relative)) return false;

  return !relative.split(path.sep).includes("..");
}

/** Repository file path and public URL derived from one validated slide path. */
export type ResolvedSlideAsset = Readonly<{
  slidePath: SlidePath;
  slideFilePath: string;
  slidePublicUrl: HttpsUrl;
}>;

/**
 * Resolves a root-relative slide path to its repository file path and public
 * URL. Returns `null` when the path is not a safe `.pdf` reference beneath
 * `/talks/slides/` or when the resolved path would leave the slide directory.
 *
 * The path shape (traversal segments, backslashes, whitespace, control
 * characters, query strings, fragments, encoded separators and dots, non-PDF
 * names) is rejected by `validateSlidePath` before any path arithmetic, and the
 * resolved location is then proven to remain inside the slide directory.
 */
export function resolveSlideAsset(
  slidePath: string,
  options: SlideAssetValidationOptions = {},
): ResolvedSlideAsset | null {
  const safePath = validateSlidePath(slidePath);
  if (safePath === null) return null;

  const slideDirectory = resolveSlideDirectory(options.projectRoot);
  const relativePath = safePath.slice(TALK_SLIDE_PATH_PREFIX.length);
  const slideFilePath = path.resolve(slideDirectory, relativePath);

  if (!isInsideDirectory(slideFilePath, slideDirectory)) return null;

  return Object.freeze({
    slidePath: safePath,
    slideFilePath,
    slidePublicUrl: deriveSlidePublicUrl(safePath),
  });
}

/**
 * Validates the slide deck associated with one talk record.
 *
 * Rejections are reported as field-specific diagnostics carrying the record ID,
 * the `slides` field, and the violated acceptance criterion:
 *
 * - unsafe paths and paths that escape the slide directory (criterion 6.7);
 * - missing, unreadable, or zero-byte files (criterion 2.7);
 * - non-PDF signatures, malformed or encrypted-unreadable documents, and
 *   documents with no pages (criterion 6.6).
 *
 * The author asset is only ever read. Nothing is modified, repaired, deleted, or
 * replaced, and no diagnostic value is written back to source.
 */
export async function validatePdfAsset(
  slidePath: string,
  recordId: string,
  options: SlideAssetValidationOptions = {},
): Promise<SlideAssetValidationResult> {
  const resolved = resolveSlideAsset(slidePath, options);

  if (resolved === null) {
    return rejected(
      recordId,
      CRITERION_ASSOCIATION,
      `slides must reference exactly one safe root-relative .pdf path beneath ${TALK_SLIDE_PATH_PREFIX}`,
    );
  }

  const slideDirectory = resolveSlideDirectory(options.projectRoot);

  let realFilePath: string;
  try {
    realFilePath = await realpath(resolved.slideFilePath);
  } catch (error: unknown) {
    const code = errorCode(error);

    if (code === "ENOENT" || code === "ENOTDIR") {
      return rejected(
        recordId,
        CRITERION_READABLE,
        `slides references ${resolved.slidePath}, but no such file exists under ${SLIDE_DIRECTORY_SEGMENTS.join("/")}/`,
      );
    }

    return rejected(
      recordId,
      CRITERION_READABLE,
      `slides references ${resolved.slidePath}, which could not be read (${describeError(error)})`,
    );
  }

  const realSlideDirectory = await realpath(slideDirectory);

  if (!isInsideDirectory(realFilePath, realSlideDirectory)) {
    return rejected(
      recordId,
      CRITERION_ASSOCIATION,
      `slides references ${resolved.slidePath}, which resolves outside ${SLIDE_DIRECTORY_SEGMENTS.join("/")}/`,
    );
  }

  let bytes: Uint8Array;
  try {
    // Copied into a standalone view so the parser cannot observe or detach the
    // pooled Node read buffer, and so byte offsets are always zero-based.
    bytes = Uint8Array.from(await readFile(realFilePath));
  } catch (error: unknown) {
    const code = errorCode(error);

    if (code === "ENOENT" || code === "ENOTDIR") {
      return rejected(
        recordId,
        CRITERION_READABLE,
        `slides references ${resolved.slidePath}, but no such file exists under ${SLIDE_DIRECTORY_SEGMENTS.join("/")}/`,
      );
    }

    return rejected(
      recordId,
      CRITERION_READABLE,
      `slides references ${resolved.slidePath}, which could not be read as a file (${describeError(error)})`,
    );
  }

  const byteLength = bytes.byteLength;

  if (byteLength === 0) {
    return rejected(
      recordId,
      CRITERION_READABLE,
      `slides references ${resolved.slidePath}, which is empty and cannot be read as a PDF document`,
    );
  }

  // The request-time renderer skips the full pdfjs parse: the deck was already
  // validated at publish time, and re-parsing here would pull the native canvas
  // dependency into the Lambda and re-parse every deck on each render for a
  // page count that appears in no public representation. The cheap PDF-signature
  // check still runs, so a non-PDF byte stream is still rejected.
  if (options.skipPdfParse === true) {
    if (!hasPdfSignature(bytes)) {
      return rejected(
        recordId,
        CRITERION_PDF_DOCUMENT,
        `PDF validation failed: ${resolved.slidePath} does not begin with the ${PDF_SIGNATURE} header and does not open as a PDF document`,
      );
    }

    return accepted(
      Object.freeze({
        slidePath: resolved.slidePath,
        slideFilePath: resolved.slideFilePath,
        slidePublicUrl: resolved.slidePublicUrl,
        byteLength,
        pageCount: 0,
      }),
    );
  }

  const parsed = await readPdfDocument(bytes);

  if (!parsed.ok) {
    if (parsed.rejection.kind === "signature") {
      return rejected(
        recordId,
        CRITERION_PDF_DOCUMENT,
        `PDF validation failed: ${resolved.slidePath} does not begin with the ${PDF_SIGNATURE} header and does not open as a PDF document`,
      );
    }

    if (parsed.rejection.kind === "empty") {
      return rejected(
        recordId,
        CRITERION_PDF_DOCUMENT,
        `PDF validation failed: ${resolved.slidePath} contains no pages`,
      );
    }

    return rejected(
      recordId,
      CRITERION_PDF_DOCUMENT,
      `${parsed.rejection.message} for ${resolved.slidePath}`,
    );
  }

  return accepted(
    Object.freeze({
      slidePath: resolved.slidePath,
      slideFilePath: resolved.slideFilePath,
      slidePublicUrl: resolved.slidePublicUrl,
      byteLength,
      pageCount: parsed.pageCount,
    }),
  );
}
