# Implementation Plan: Talks Section

## Overview

Implement the author-managed Talks archive as a validated Astro content pipeline with one immutable published-talk snapshot feeding the accessible HTML archive, progressive filtering and click-to-load video behavior, Markdown alternate, discovery documents, static-build verification, and CloudFront representation mappings. The work remains static and repository-controlled: it adds no visitor upload path, runtime content service, analytics stream, or deployment action.

## Tasks

- [x] 1. Establish the TypeScript content contract and test tooling
  - [x] 1.1 Add exact-pinned build-time validation and property-test dependencies
    - Select a maintained Node-compatible PDF parser that can reject malformed or unreadable documents and report a positive page count; install it as an exact-pinned development dependency with `npm install --save-dev --save-exact`, not a range.
    - Add `fast-check` and any TypeScript test runner needed by the existing Node test setup as exact-pinned development dependencies, update `package.json` test scripts without dropping `scripts/*.test.mjs`, and retain the resulting `package-lock.json` changes.
    - Keep PDF parsing and generated-data testing build/test-only; do not introduce a runtime service or browser dependency for either capability.
    - _Requirements: 2.7, 2.9, 6.6, 6.7_

  - [x] 1.2 Extend `src/content.config.ts` with the strict file-backed `talks` collection
    - Load author-managed Markdown records from `src/content/talks/` and define the approved `title`, `eventName`, `date`, `location`, `eventUrl`, `eventTypes`, `slides`, optional `videoUrl`, and defaulted `draft` fields.
    - Reject unknown keys, wrong scalar/array shapes, empty optional values, and cardinality violations; connect field-specific schema failures to the approved requirement criteria without rewriting source files.
    - Keep the existing `blog` collection unchanged and export both collections.
    - _Requirements: 2.1–2.9, 6.1, 6.7_

  - [x] 1.3 Create the typed Talks domain model and pure metadata validators
    - Add exact TypeScript types for candidate, normalized, validated, and published talks, branded dates/paths/URLs, normalized event types/videos, validation issues, filter options, and `TalkValidationError`; do not use `any` or type-error suppression.
    - Implement Unicode code-point-aware trim/NFC normalization, real ISO-date validation, credential-free HTTPS URL validation, narrow YouTube source parsing and `youtube-nocookie.com` embed derivation, canonical event-type uniqueness, and safe slide-path validation.
    - Aggregate deterministic record/field/criterion issues, preserve candidate values unchanged, and expose reusable pure helpers for later schema, publication, filter, and serializer work.
    - _Requirements: 2.1–2.9, 6.5, 6.7_

  - [ ]* 1.4 Write the property-based test for scalar metadata validation
    - **Property 1: Scalar metadata validation is exact**
    - Create a dedicated TypeScript property-test file using Unicode and Gregorian-date generators with at least 100 cases and the design-prescribed feature/property comment.
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [ ]* 1.5 Write the property-based test for external URL and video normalization
    - **Property 2: External URL and video normalization is safe**
    - Generate valid and deceptive URL forms, including credentials, suffix hosts, ports, fragments, unsupported paths/providers, invalid IDs, and length boundaries; assert that accepted embeds are code-owned privacy-enhanced URLs.
    - **Validates: Requirements 2.5, 2.8**

  - [ ]* 1.6 Write the property-based test for event-type validation
    - **Property 3: Event-type validation enforces bounded canonical uniqueness**
    - Generate labels around count/code-point limits and normalization, case, and whitespace collisions; assert display-label preservation and comparison-key uniqueness.
    - **Validates: Requirements 2.6**

  - [ ]* 1.7 Write the property-based test for aggregate non-mutating diagnostics
    - **Property 4: Validation reports all metadata failures without mutation**
    - Generate candidates with arbitrary combinations of violations, assert exact issue coverage and no false issues, and compare the candidate before and after validation.
    - **Validates: Requirements 2.9**

- [x] 2. Implement PDF validation, publication, and derived projections
  - [x] 2.1 Implement safe slide resolution and parser-backed PDF validation
    - Resolve root-relative slide paths beneath `public/talks/slides/`, prove the resolved path remains inside that directory, and reject traversal, encoded separators, query/fragment data, missing files, empty bytes, and non-PDF signatures.
    - Parse complete PDF bytes with the exact-pinned parser in strict/non-recovery mode and reject malformed, encrypted-unreadable, or zero-page documents with record/field/criterion context.
    - Return immutable size/page diagnostics without modifying, repairing, deleting, or replacing author assets.
    - _Requirements: 2.7, 2.9, 6.1, 6.6, 6.7_

  - [x] 2.2 Implement the validated and published Talks gateways
    - Add `getValidatedTalks()` as the only raw `getCollection("talks")` boundary; combine metadata and PDF issues across every record before throwing a deterministically ordered `TalkValidationError`.
    - Add `getPublishedTalks()` to exclude drafts, derive immutable safe public/embed values, emit every published ID exactly once, and sort newest-first with a deterministic ID tie-breaker.
    - Ensure downstream HTML, Markdown, and discovery code can reuse one resolved published snapshot rather than rereading raw records.
    - _Requirements: 2.9, 3.1, 4.1, 6.5–6.7, 8.5, 8.6_

  - [x] 2.3 Implement pure archive, filter, date, and projection helpers
    - Implement `formatTalkDate`, publication/archive projection, lossless per-talk tag projection, distinct stable filter-option derivation, and exact filtering where `All talks` is identity.
    - Generate code-owned event-type IDs and keep author text out of selectors and executable source.
    - Represent the defensive zero-match state without introducing URL, cookie, storage, analytics, or network-backed filter state.
    - _Requirements: 3.1, 3.5, 3.6, 4.1–4.8_

  - [ ]* 2.4 Write the property-based test for publication projection
    - **Property 5: Publication projection is complete, unique, and chronological**
    - Generate finite valid collections with duplicate-resistant IDs, arbitrary dates, and draft flags; assert exact membership, uniqueness, and adjacent date order.
    - **Validates: Requirements 3.1, 4.1**

  - [ ]* 2.5 Write the property-based test for talk date formatting
    - **Property 6: Talk dates have the required human-readable form**
    - Generate valid calendar dates across leap years and month/day boundaries and assert the English full-month representation preserves the date without a forced day leading zero.
    - **Validates: Requirements 3.5**

  - [ ]* 2.6 Write the property-based test for lossless talk tags
    - **Property 7: Talk tag projection is lossless**
    - Generate published talks with overlapping tags and assert each card projection has exactly its assigned labels once and no labels from other talks.
    - **Validates: Requirements 3.6**

  - [ ]* 2.7 Write the property-based test for filter-option derivation
    - **Property 8: Filter options equal the distinct published tag union**
    - Generate collections with overlapping canonical tag keys and assert one stable option per distinct published key and no extraneous option.
    - **Validates: Requirements 4.2**

  - [ ]* 2.8 Write the property-based test for exact filtering
    - **Property 9: Filtering returns the exact matching set and All is identity**
    - Generate published collections and selected keys; assert exact unique matching membership and that All preserves the original sequence without additions, removals, or reordering.
    - **Validates: Requirements 4.4, 4.5**

  - [ ]* 2.9 Write the property-based test for slide association and public URL safety
    - **Property 11: Slide association and public URL derivation are safe**
    - Generate safe and traversal-like associations and assert acceptance is limited to one root-relative PDF beneath `/talks/slides/`, with the accepted path preserved on an exact `https://salih.dev` URL.
    - **Validates: Requirements 6.5, 6.7**

  - [ ]* 2.10 Add parser-backed PDF validation integration fixtures and tests
    - Add minimal reviewed test fixtures for valid one-page/multi-page PDFs and invalid zero-byte, wrong-content, truncated/malformed, unreadable/encrypted, missing, unsafe-path, and zero-page cases when the parser can represent the last case.
    - Exercise the production `validatePdfAsset` path and assert field-specific diagnostics; keep fixtures outside public author content and make no network requests.
    - _Requirements: 2.7, 2.9, 6.6, 6.7_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Build the accessible, responsive Astro Talks experience
  - [x] 4.1 Extend the shared title and primary-navigation contracts
    - Add the optional `documentTitle` interface to `src/layouts/BaseLayout.astro` so Talks renders exactly `<title>Talks</title>` while existing pages and social metadata keep their current site-qualified titles.
    - Add exactly one Talks item to `src/config/site.ts`, normalize route-boundary current-page matching in `src/components/Header.astro`, retain visible and `aria-current="page"` states, and replace the mobile three-column assumption with wrapping/count-safe navigation styling.
    - _Requirements: 1.1–1.5, 7.1, 7.4_

  - [x] 4.2 Create static Talk card, archive, and filter components
    - Create `TalkCard.astro`, `TalkArchive.astro`, and `TalkFilter.astro` with semantic articles/headings, associated metadata, exact event/link/tag/title occurrence rules, accessible PDF labels, native filter buttons, an `All talks` option, and empty/no-match/status regions.
    - Render every published talk in complete static HTML, initially hide the progressive filter controls, and preserve full usable content when scripts fail.
    - Keep all author strings text-safe and use generated filter IDs rather than interpolating author labels into selectors or scripts.
    - _Requirements: 3.2–3.8, 4.2, 4.3, 4.6–4.9, 6.2–6.4, 7.1, 7.2_

  - [x] 4.3 Implement progressive one-hot client filtering
    - Install listeners before revealing the filter, initialize `All talks` with exactly one `aria-pressed="true"`, and update every button, article `hidden` state, visible result/no-match copy, and polite status region after Enter, Space, or pointer activation.
    - Leave focus on the selected button and perform no navigation, network, storage, cookie, query-string, or analytics operation.
    - _Requirements: 4.1, 4.4–4.9, 7.1, 7.2_

  - [ ]* 4.4 Write the property-based test for one-hot filter selection
    - **Property 10: Filter selection remains one-hot**
    - Generate non-empty selection sequences beginning at All and test the pure controller/state reducer used by the DOM enhancement, asserting the latest option is the only selected and assistive-technology-selected option after every transition.
    - **Validates: Requirements 4.9**

  - [x] 4.5 Implement privacy-enhanced click-to-load talk video
    - Create `TalkVideo.astro` using only normalized video values, with a local 16:9 placeholder, native play button, original-source fallback link, and no thumbnail, iframe, or provider request before activation.
    - On activation, replace only the media control with one focused, labeled `youtube-nocookie.com` iframe using code-owned attributes and autoplay query; retain all metadata, event/PDF actions, fallback access, and page location on failures.
    - Render no media region at all when a talk omits `videoUrl`.
    - _Requirements: 5.1–5.5, 7.1, 7.2, 7.5_

  - [x] 4.6 Create `/talks/` and its responsive visual treatment
    - Create `src/pages/talks/index.astro`, await one published snapshot, render exactly one `h1` with `Talks`, wire the components, set the exact document title, and emit safe `CollectionPage`/`ItemList` structured data without draft leakage or visible-content duplication.
    - Extend the incumbent paper/ink/mono/red system with wrapping-safe ruled archive layouts, 2 CSS pixel enclosing focus indicators measured at 3:1 or better, a 16:9 media region, and desktop/tablet/mobile layouts that avoid clipping, overlap, and horizontal page scrolling from 320 through 2560 CSS pixels.
    - Preserve the approved empty archive behavior and omit unusable filter controls when there are no published talks.
    - _Requirements: 1.2–1.5, 3.1–3.8, 4.1, 5.1–5.5, 6.2–6.5, 7.1–7.5_

  - [ ]* 4.7 Add automated browser integration coverage for Talks interaction and layout
    - Use an exact-pinned browser test dependency only if the repository has no suitable existing runner; cover populated/mixed-video/no-video/empty/maximum-length fixtures without contacting YouTube.
    - Verify keyboard order and Enter/Space behavior, one-hot selection, no-match status, click-to-load focus and unchanged `/talks/` location, blocked-video resilience, semantic/accessibility checks, reduced motion, focus geometry/contrast, and no horizontal overflow at the approved viewport widths.
    - Keep this as integration coverage; do not add separate component unit tests or duplicate the property tests with hand-picked validator cases.
    - _Requirements: 1.1–1.5, 3.2–3.8, 4.3–4.9, 5.1–5.5, 6.2–6.4, 7.1–7.5_

- [x] 5. Generate Markdown and discovery outputs from the validated snapshot
  - [x] 5.1 Implement the Talks Markdown serializer and alternate route
    - Implement Markdown-safe serialization from `PublishedTalk[]` with one ordered section per published talk, all required metadata/links, an optional source video URL only for the same talk, absolute salih.dev slide URLs, and a valid no-talk document.
    - Register `/talks/` in `src/lib/markdown-documents.ts` and create `src/pages/talks/index.md.ts` following the existing `markdownResponse` route convention; never reread raw talk records in the route.
    - _Requirements: 8.1–8.3, 8.5–8.7_

  - [ ]* 5.2 Write the property-based test for complete, publication-safe Markdown
    - **Property 12: Markdown projection is complete and publication-safe**
    - Generate validated collections with Markdown-sensitive text and optional videos; assert one section for every and only published talk and complete same-talk metadata/link membership.
    - **Validates: Requirements 8.2, 8.3**

  - [ ]* 5.3 Write the property-based test for one-snapshot human/machine projections
    - **Property 13: Human and machine projections preserve one snapshot**
    - Generate immutable published snapshots and assert archive and Markdown projections preserve equivalent ordered identities and public metadata without rereading or mixing a second source value.
    - **Validates: Requirements 8.5**

  - [x] 5.4 Add Talks to sitemap and LLM-oriented discovery routes
    - Extend `src/pages/sitemap.xml.ts` with exactly one canonical Talks URL and the newest published talk date as `lastmod` when available.
    - Extend `src/pages/llms.txt.ts` with one Talks core-page link and `src/pages/llms-full.txt.ts` with the Talks Markdown document exactly once, all from published/validated data.
    - Preserve existing blog and core-page entries and do not identify a non-canonical Talks URL as canonical.
    - _Requirements: 8.2–8.7_

  - [x] 5.5 Extend application Markdown discovery and negotiation mappings
    - Add `/talks/` → `/talks/index.md` to `src/lib/discovery.ts` so `BaseLayout` advertises the established Markdown alternate.
    - Extend `src/middleware.ts` only where its explicit clean-route/representation mapping requires Talks support, retaining existing HTML preference and content-signal behavior.
    - _Requirements: 8.1, 8.4_

- [x] 6. Complete application build verification and existing documentation
  - [x] 6.1 Extend `scripts/verify-static-build.mjs` with Talks invariants
    - Require `dist/talks/index.html` and `dist/talks/index.md`; verify exact title/heading/canonical/alternate behavior, draft exclusion, equivalent ordered public metadata, conditional video links, and the approved empty-collection output.
    - Verify each published slide is a non-empty one-to-one file beneath `dist/talks/slides/` and that sitemap, `llms.txt`, and `llms-full.txt` contain the canonical Talks representation exactly where required.
    - Preserve all current blog banner, representation-pair, API, and discovery checks; do not weaken acceptance for missing machine-readable output or external slide hosts.
    - _Requirements: 2.9, 3.1–3.8, 6.2–6.7, 8.1–8.7_

  - [x] 6.2 Provide verification content without inventing public claims
    - If reviewed real talk metadata and its author-owned PDF are available and needed for the initial published archive, add one record under `src/content/talks/` and exactly one corresponding asset under `public/talks/slides/` using the validated schema.
    - Otherwise keep the public collection empty, verify the required empty HTML/Markdown behavior, and use only the non-public test fixtures from task 2.10 for populated/error coverage; do not fabricate a public talk or slide deck solely to make validation pass.
    - _Requirements: 2.1–2.9, 3.8, 6.1, 6.4–6.7, 8.7_

  - [x] 6.3 Update only existing relevant project documentation
    - Update `README.md` with the author-managed Talks record/slide workflow and local validation commands, and update the existing discovery/architecture documentation (`docs/agent-readiness.md` and, only if its current scope requires it, `docs/aws-migration.md` or `DEPLOY.md`) with the Talks HTML/Markdown and edge-route contract.
    - Do not create a new Markdown document, describe a visitor upload/admin flow, or add deployment instructions that bypass the existing production approval process.
    - _Requirements: 6.1, 8.1, 8.4–8.6_

- [x] 7. Extend CloudFront Talks representation handling
  - [x] 7.1 Add Talks to CloudFront request and response mappings
    - Update `infra/lib/edge-functions.ts` so clean `/talks` and `/talks/` requests rewrite to `/talks/index.html`, explicit Markdown preference rewrites before cache lookup to `/talks/index.md`, HTML preference remains HTML, and successful responses advertise exact canonical HTML and Markdown alternate links.
    - Preserve www-to-apex redirects, query serialization, existing route mappings, privacy-preserving headers/logging, and all current CloudFront/CDK resources; do not deploy or change DNS.
    - _Requirements: 1.2, 8.1, 8.4_

  - [ ]* 7.2 Extend existing edge-function integration tests for Talks
    - Add cases to `infra/test/edge-functions.test.ts` for clean HTML rewriting, Markdown-preferred rewriting, HTML-preferred behavior, and response `Link` headers for both Talks representations.
    - Retain all existing edge and stack tests and add no logging fields, browser identifiers, public endpoints, storage resources, or write permissions.
    - _Requirements: 8.1, 8.4_

- [x] 8. Final checkpoint - Ensure all application and infrastructure validation passes
  - From the repository root, run `npm test`, `npm run check`, `npm run build`, and `npm run verify:build`; fix all failures without weakening existing checks.
  - From `infra/`, run `npm run build`, `npm test`, and `npm run synth`; fix all failures and confirm the synthesized change is limited to the approved edge-function behavior.
  - Ensure all tests pass, ask the user if questions arise. Do not deploy or perform DNS changes.

## Notes

- Tasks marked with `*` are optional test-related work and can be skipped for a faster MVP; implementation agents must not implement skipped optional tasks.
- Each of the design's 13 correctness properties has its own property-based test task and requirement mapping.
- Property-test tasks should use dedicated files (or otherwise coordinated ownership) so tasks placed in the same dependency wave do not edit the same file.
- Do not add separate validator/component unit tests beyond the approved property-based tests; parser, browser, static-build, and edge coverage are integration/verification work explicitly required by the approved design.
- Public talk records and PDFs are reviewed author-managed source assets. Generated blog images and `.cache/` remain ignored and must not be repurposed for slides.
- This plan performs no AWS deployment, production mutation, or DNS cutover.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["1.2", "2.1"] },
    { "id": 3, "tasks": ["1.4", "1.5", "1.6", "1.7", "2.2"] },
    { "id": 4, "tasks": ["2.3", "2.10"] },
    { "id": 5, "tasks": ["2.4", "2.5", "2.6", "2.7", "2.8", "2.9"] },
    { "id": 6, "tasks": ["4.1", "4.2", "4.5", "5.1", "5.5", "7.1"] },
    { "id": 7, "tasks": ["4.3", "4.6", "5.4", "7.2"] },
    { "id": 8, "tasks": ["4.4", "5.2", "5.3"] },
    { "id": 9, "tasks": ["4.7", "6.2"] },
    { "id": 10, "tasks": ["6.1"] },
    { "id": 11, "tasks": ["6.3"] }
  ]
}
```
