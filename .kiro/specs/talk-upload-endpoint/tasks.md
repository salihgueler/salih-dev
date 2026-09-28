# Implementation Plan: Talk Upload Endpoint

## Overview

Implement the approved talk upload workflow by extending the existing IAM-authorized content API, retained content bucket, CodeBuild publisher, and validated Talks pipeline. The implementation keeps PDF bytes outside API Gateway and Lambda request bodies, validates uploads before approval, materializes only approved API-authored records and referenced decks into code-owned source directories, and preserves the completed Talks feature's single validated snapshot and strict static verification. Root application and `infra/` work remain separate TypeScript/npm packages with separate lockfiles.

## Tasks

- [x] 1. Establish shared package and module foundations
  - [x] 1.1 Add exact-pinned infrastructure Lambda dependencies
    - Add `@aws-sdk/s3-presigned-post@3.1127.0` and `pdfjs-dist@6.3.289` to `infra/package.json` dependencies with exact versions and update only `infra/package-lock.json` through the `infra/` package.
    - Keep the root `pdfjs-dist@6.3.289` entry in `devDependencies`; do not move it into root runtime dependencies or mix root and infrastructure lockfile changes.
    - Prepare the completion Lambda for `bundling.nodeModules: ["pdfjs-dist"]` rather than bundling the parser's legacy worker-relative module.
    - _Requirements: 4.4, 4.9, 11.3_

  - [x] 1.2 Create the browser/build-safe site-origin leaf and explicit shared module boundary
    - Add `src/config/site-origin.ts` exporting the single typed `SITE_ORIGIN`, update `src/config/site.ts` to use it for `site.url`, and update `src/lib/talks/validation.ts` to import the leaf instead of the filesystem/JSON-transitive site configuration.
    - Use explicit `.js` relative specifiers for modules reachable from `infra/functions/**`, keeping those shared modules free of Astro virtual modules, JSON imports, filesystem side effects, and browser-only dependencies so both the root bundler and `infra/tsconfig.json` Node16 resolution remain valid.
    - Preserve the completed Talks schema, normalized URLs, public slide URLs, and every existing validation diagnostic.
    - _Requirements: 6.1, 6.6, 8.2, 11.3_

  - [x] 1.3 Implement canonical talk identity and record-key derivation
    - Create leaf module `src/lib/talks/identity.ts` with branded `TalkIdentity` and `TalkRecordKey` types plus `deriveTalkIdentity`, `deriveTalkRecordKey`, and `isTalkRecordKey`.
    - Implement NFC normalization, trim, internal-whitespace collapse, locale-independent case folding, ISO-date separation, and deterministic SHA-256-derived safe record keys containing no author text or path separator.
    - Keep derivation source-independent so Git-authored and API-authored records use one implementation.
    - _Requirements: 7.2, 7.7, 9.4_

  - [x] 1.4 Implement code-owned deck identifiers, keys, and slide paths
    - Create leaf module `src/lib/talks/deck.ts` with the approved media type, byte bounds, pending/approved prefixes, API slide prefix, branded `DeckId`, UUID creation/validation, key derivation, slide-path derivation, and inverse `deckIdFromSlidePath`.
    - Ensure callers cannot influence any key or path; reject malformed IDs and produce only `.pdf` values without traversal, uncontrolled separators, whitespace, control characters, or percent-encoded sequences.
    - Make generated slide paths satisfy the existing safe-slide-path validator beneath `/talks/slides/api/`.
    - _Requirements: 3.1–3.4, 5.1, 5.2, 5.4, 5.5, 8.3_

  - [x] 1.5 Extract the shared strict PDF byte parser without weakening asset validation
    - Create leaf module `src/lib/talks/pdf-document.ts` and move the byte signature and complete-document parsing behavior out of `src/lib/talks/asset.ts` rather than duplicating it.
    - Preserve the exact-pinned legacy parser, `stopAtErrors`, every existing disabled network/font/canvas capability, complete page retrieval, parser cleanup, encrypted/malformed/empty classification, and add `isEvalSupported: false` for both build and upload callers.
    - Keep `asset.ts` responsible for path resolution, realpath containment, filesystem reads, and existing talks-section diagnostics while delegating all byte-level checks to the extracted module.
    - _Requirements: 4.3–4.6, 4.9, 6.1, 11.3_

  - [x]* 1.6 Write the property-based test for safe derived deck locations
    - **Property 2: Derived storage keys and slide paths are safe, code-owned, and distinct**
    - Create a dedicated root TypeScript property-test file with generated UUID sequences, adversarial path text, and at least 100 cases; assert prefix ownership, syntax safety, existing slide-path acceptance, containment, and pairwise distinctness.
    - **Validates: Requirements 5.1, 5.2, 5.4, 5.5**

  - [x]* 1.7 Write the property-based test for deck path inversion
    - **Property 3: Storage key and slide path round trip**
    - Create a separate root property-test file that round-trips generated deck identifiers and rejects paths not produced by the feature.
    - **Validates: Requirements 5.2, 8.3**

  - [x]* 1.8 Write the property-based test for canonical source-independent identity
    - **Property 7: Talk identity derivation is canonical and source-independent**
    - Generate Unicode combining forms, astral text, case variants, whitespace runs, dates, sources, IDs, and unrelated field changes; assert the exact identity equivalence relation.
    - **Validates: Requirements 7.2**

  - [x]* 1.9 Write the property-based test for identity-derived record keys
    - **Property 8: Equal identity derives equal record key**
    - Generate equal and unequal canonical identities and assert key equality is equivalent to identity equality while every key matches the code-owned safe alphabet and shape.
    - **Validates: Requirements 7.7, 9.4**

- [x] 2. Implement shared request, record, and materialization contracts
  - [x] 2.1 Implement the closed talk upload request parser
    - Create `src/lib/talks/upload-request.ts` with exact types and `parseTalkUploadRequest(body, slidePath)` for the optional `metadata` and optional `replaces` contract.
    - Reject and name unknown members at every contract level, including caller-supplied `slides`, storage keys, filenames, or paths; inject only the code-derived slide path and reuse `normalizeTalkCandidate` for all approved metadata rules and the draft default.
    - Enforce API-only round-trip-safe text constraints and reject replacements that change the target Talk_Identity without creating a second validation implementation.
    - _Requirements: 2.2, 2.6, 5.3, 6.1–6.5, 7.7, 9.1–9.4, 11.3_

  - [x] 2.2 Implement stored API talk records and frontmatter serialization
    - Create `src/lib/talks/api-record.ts` with the versioned `ApiTalkRecord` contract, strict parser, deterministic JSON serializer, and `toTalkFrontmatterDocument` serializer.
    - Store exactly the normalized approved talk fields plus the derived slide association, deck byte/page facts, canonical identity/key, deck ID, and timestamps; reject unknown, malformed, or inconsistent stored values.
    - Emit frontmatter-only Markdown that round-trips through both Astro's talks schema and the existing verifier parser without changing Git-authored record behavior.
    - _Requirements: 4.8, 6.4, 6.6, 7.1, 7.6, 8.1, 11.3_

  - [x] 2.3 Implement the pure API talk materialization planner
    - Create `src/lib/talks/materialize.ts` with `planMaterialization` over parsed API records, available approved deck IDs, and explicit record/slide roots.
    - Select exactly records whose referenced approved deck exists, map one record to one deck, derive all target paths inside `src/content/talks/api/` and `public/talks/slides/api/`, and reject any target that escapes those code-owned roots or could replace Git-authored content.
    - Skip absent-deck records and ignore unreferenced approved decks so neither can enter a snapshot.
    - _Requirements: 3.7, 5.6, 5.7, 7.1, 7.6, 7.8, 8.1, 8.3, 9.6, 11.4_

  - [x] 2.4 Add the clear-then-write API talk materializer
    - Create `scripts/materialize-api-talks.mjs` as a thin filesystem shell over the shared parsers/planner and add `materialize:talks` to the root `package.json` using the existing `node --import tsx` convention.
    - Read only local record/deck cache directories supplied by the publisher, fail on invalid stored records, clear and recreate only `src/content/talks/api/` and `public/talks/slides/api/`, write planned Markdown, and copy only referenced approved decks.
    - Add both generated API directories to `.gitignore`; do not ignore or mutate `src/content/talks/` or `public/talks/slides/` generally.
    - _Requirements: 5.6, 5.7, 6.6, 6.7, 7.6, 7.8, 8.1, 8.3, 9.6, 9.7, 11.4_

  - [x]* 2.5 Write the property-based test for closed request contracts
    - **Property 4: Unsupported request members are always rejected and named**
    - Generate otherwise valid requests with arbitrary extra members at the top level, metadata level, and replacement level, biased toward storage-shaped names; assert every extra name is diagnosed and no grant/store action is produced.
    - **Validates: Requirements 2.6, 5.3, 6.2**

  - [x]* 2.6 Write the property-based test for metadata-validation parity
    - **Property 5: API metadata validation is exactly repository metadata validation**
    - Differentially test generated payloads through the API request parser and `normalizeTalkCandidate`, asserting identical acceptance, normalized values, draft defaults, and field/criterion diagnostics after injecting the same code-derived slide path.
    - **Validates: Requirements 6.1, 6.3, 6.5, 11.3**

  - [x]* 2.7 Write the property-based test for stored/materialized record round trips
    - **Property 6: Stored record and materialized record round trip**
    - Generate accepted normalized metadata and deck associations, serialize and parse both stored JSON and materialized frontmatter, and assert no approved field is added, lost, or altered.
    - **Validates: Requirements 6.4**

  - [x]* 2.8 Write the property-based test for materialization confinement
    - **Property 10: Materialization is confined to the code-owned API namespace**
    - Generate record/deck availability sets, orphaned records, unreferenced decks, stale generated files, and adversarial roots; assert exact membership, one-to-one deck mapping, root containment, and no Git-authored path mutation.
    - **Validates: Requirements 3.7, 5.6, 5.7, 7.6, 7.8, 8.3, 9.6, 11.4**

  - [x]* 2.9 Add focused parser integration fixtures and tests
    - Add or reuse non-public reviewed fixtures for valid one/multi-page, zero-byte, wrong-signature, truncated/malformed, encrypted/unreadable, and zero-page PDFs where representable.
    - Exercise both `readPdfDocument` and the production `validatePdfAsset` delegation, proving identical strict parsing outcomes, unchanged talks-section diagnostics, no recovery/eval path, and no network access.
    - _Requirements: 4.3–4.7, 4.9, 11.3_

  - [x]* 2.10 Add focused materializer shell integration tests
    - Create `scripts/materialize-api-talks.test.mjs` using temporary project/cache roots with present and absent decks plus stale generated files.
    - Assert clear-then-write removal behavior, exact generated Markdown/deck membership, rejection of malformed records, no writes outside the two API roots, and no mutation of the local cache/store representation.
    - _Requirements: 5.6, 5.7, 6.6, 6.7, 7.6, 7.8, 8.3, 9.6, 9.7, 11.4_

- [x] 3. Checkpoint - Ensure shared tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement the authenticated talk upload handlers
  - [x] 4.1 Extend shared content API utilities for the talk routes
    - Update `infra/functions/content-api-shared.ts` only with reusable typed helpers/constants needed by all talk handlers for body byte limits, JSON responses, request IDs/headers, strict precondition parsing, and privacy-limited structured logging.
    - Preserve the existing content read/write behavior and require each new handler to call `isExpectedEditor` before parsing input, deriving grants, or invoking any AWS client.
    - Keep logs to the approved action-specific field sets and never include request bodies, PDF/rendered bytes, IP addresses, cookies, query strings, user agents, referrers, or browser/device identifiers.
    - _Requirements: 1.2–1.5, 2.7, 9.1–9.5, 10.1–10.6, 11.2_

  - [x] 4.2 Implement the presigned POST upload-start handler
    - Create `infra/functions/talk-upload-start.ts` for `POST /v1/talks/uploads`, enforcing authorization first, the 65,536-byte UTF-8 body cap, strict JSON/unknown-member diagnostics, shared metadata validation, and replacement identity/version checks before any mutation.
    - Derive a unique deck ID, pending/approved keys, slide path, and optional identity-derived record key; use `createPresignedPost` with an exact key condition, exact `application/pdf` condition, `content-length-range` 1..26,214,400, and expiry no later than 900 seconds.
    - Stage exactly one validated request with safe conditional semantics, issue no grant on API identity conflict/precondition failure, and return one grant with storage references and expiry without granting read/list/overwrite/delete access.
    - _Requirements: 1.1–1.6, 2.1–2.7, 3.1–3.7, 5.1–5.5, 6.1–6.5, 7.7, 9.1–9.4, 10.1, 10.4, 10.5, 11.1–11.3_

  - [x] 4.3 Implement the upload-completion and server-side deck-validation handler
    - Create `infra/functions/talk-upload-complete.ts` for `POST /v1/talks/uploads/{deckId}/completion`, authorizing before work and accepting only an absent body or `{}`.
    - Read the staged request and pending object; validate recorded media type, 1..26,214,400 byte size, `%PDF-` signature, strict complete parse, encryption rejection, and positive page count using `pdf-document.ts` before any approved-store write.
    - On success, copy to `talks/decks/{deckId}.pdf` with validated byte/page metadata, conditionally create or replace the API record, clean pending objects only after durable writes, remove the superseded deck only after the replacement record succeeds, and then invoke exactly one publisher build.
    - Return the approved response/version/build taxonomy; on validation or precondition failure record no talk and start no build, and on publication-start failure retain and identify stored records in a `503` response.
    - Emit only approved validation/store log fields and keep pending bytes fail-closed on timeout, parser error, or unexpected storage failure.
    - _Requirements: 3.7, 4.1–4.9, 6.4, 7.7, 8.7, 8.8, 9.1–9.4, 10.2–10.7, 11.3_

  - [x] 4.4 Implement API talk record listing and conditional removal
    - Create `infra/functions/talk-records.ts` to serve `GET /v1/talks/records` and `DELETE /v1/talks/records/{recordKey}` after the shared authorization guard.
    - List and strictly parse only `talks/records/` metadata with record versions/ETags and never return deck bytes; require a valid `If-Match` and `x-talk-removal: confirmed` for removal.
    - Reject missing/stale preconditions without mutation, reject Git-only identities as repository-authored, conditionally remove the API record and associated approved deck, tolerate an already-absent deck, and invoke exactly one publisher build only after accepted removal.
    - Implement the approved `400/403/404/409/412/428/500/503` response taxonomy and privacy-limited authorization/store logs.
    - _Requirements: 1.1–1.6, 7.5, 8.7, 8.8, 9.1–9.8, 10.1, 10.3–10.7, 11.2, 11.4_

  - [x]* 4.5 Write the property-based test for constrained grant issuance
    - **Property 1: Every accepted upload issues exactly one fully constrained grant**
    - Generate accepted deck-only and metadata requests and inspect staged data plus presigned policy fields, cardinality, exact constraints, expiry bounds, response references, and conditional record association.
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3**

  - [x]* 4.6 Write the property-based test for optimistic mutation preconditions
    - **Property 11: Version preconditions decide every mutating request**
    - Generate target presence, precondition presence, and matching combinations; assert exact response class and zero store calls for every rejecting case.
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5**

  - [x]* 4.7 Write the property-based test for removal ownership
    - **Property 12: Removal resolves by owning store**
    - Generate Git/API record sets and removal targets; assert only API-owned identities can be removed and every Git-only/rejected case leaves both stores unchanged.
    - **Validates: Requirements 9.8**

  - [x]* 4.8 Write the property-based test for fail-closed deck rejection
    - **Property 13: Rejected deck bytes name a criterion and record nothing**
    - Generate recorded media types, arbitrary/truncated headers, and lengths at/around both bounds; assert one approved criterion identifier, no approved deck/record mutation, and no publisher invocation on every rejection.
    - **Validates: Requirements 4.2, 4.3, 4.7**

  - [x]* 4.9 Write the property-based test for privacy-limited upload logs
    - **Property 14: Upload log records carry only permitted fields**
    - Generate every authorization, validation, and store outcome with nested sensitive-looking values; assert each emitted record's exact allowlisted field set and absence of PDF/rendered content and all prohibited visitor identifiers at every depth.
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.5**

  - [x]* 4.10 Add focused handler integration tests with stubbed AWS clients
    - Create `infra/test/talk-upload.test.ts` and test all three handlers without AWS/network access, including authorization rejection before every client call, 65,536/65,537 UTF-8 byte boundaries, strict unknown-member diagnostics, response taxonomy, and malformed preconditions.
    - Cover exact mutation ordering, no approved write before validation, conditional identity conflicts, replacement cleanup, removal, retained records when `StartBuild` fails, exactly one build start per accepted completion/removal, and permitted structured logs only.
    - Reuse parser fixtures where applicable; do not add unrelated UI/component unit tests.
    - _Requirements: 1.3–1.5, 2.6, 2.7, 4.1–4.8, 7.7, 8.7, 8.8, 9.1–9.8, 10.1–10.6_

- [x] 5. Wire storage, routes, function packaging, and publisher orchestration
  - [x] 5.1 Extend `ContentApi` with talk functions, routes, and least-privilege IAM
    - Update `infra/lib/content-api.ts` with three ARM64 Node 24 `NodejsFunction`s, dedicated one-month log groups, shared allowlist/bucket environment, publisher environment only where needed, and basic-log-policy suppression.
    - Package `pdfjs-dist` as an external installed module only for the 1769 MB/29-second completion function; keep start/records functions at 256 MB/10 seconds.
    - Add exactly the four approved talk routes to the existing `HttpApi`, inheriting the same default `HttpIamAuthorizer` and `$default` stage throttle of burst 10/rate 5 with no unauthenticated or route-level exception.
    - Grant start only pending `PutObject` plus required record lookup, completion only the approved pending/deck/record operations plus one publisher project `StartBuild`, and records only prefix-restricted list/get/delete plus one publisher project `StartBuild`; grant no broad bucket, public, cross-prefix, or unrelated service access.
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 2.1, 3.4, 7.7, 8.7, 10.6, 10.7, 11.1, 11.2_

  - [x] 5.2 Add pending-upload expiration to retained content storage
    - Update the existing `ContentBucket` lifecycle rules in `infra/lib/state-stack.ts` with a one-day expiration scoped only to `talks/pending/` while preserving private access, TLS enforcement, SSE-S3, versioning, `RETAIN`, and the existing 90-day noncurrent-version expiration.
    - Create no additional bucket and do not weaken or disable any retention, encryption, ownership, or public-access protection.
    - _Requirements: 3.5–3.7, 10.7, 11.6_

  - [x] 5.3 Materialize API talks before every build validation pass
    - Update `infra/lib/delivery-stack.ts` publisher environment/buildspec to create separate local record/deck cache roots, sync `talks/records/` and `talks/decks/` from the retained content bucket with `--delete`, and invoke `npm run materialize:talks` in `pre_build` after existing content synchronization but before `npm test`, `npm run check`, `npm run build`, and `npm run verify:build`.
    - Preserve `concurrentBuildLimit: 1`, existing site/blog synchronization, and the `CODEBUILD_BUILD_SUCCEEDING` gate before every publication command; never sync generated talk source/slide directories back to the content bucket.
    - Ensure build-validation failure leaves the stored API record unchanged and preserves the previously published site.
    - _Requirements: 4.9, 6.6, 6.7, 8.1–8.8, 9.6, 9.7, 10.7_

  - [x]* 5.4 Extend infrastructure template, route, packaging, and IAM tests
    - Update `infra/test/stacks.test.ts` for the expected seven Lambda functions and five allowlisted content functions; assert the complete six-route set, shared `AWS_IAM` authorization, retained stage throttle, and one-month log groups.
    - Assert exact prefix-scoped IAM actions/resources for each handler, completion packaging/memory/timeout, publisher buildspec ordering and publication gate, pending-only lifecycle expiration, and unchanged private/versioned/encrypted/retained storage.
    - Add parser-pin parity between root and `infra/package.json`; assert no extra bucket, IAM user/access key, Cognito/identity resource, public endpoint, editor ARN, visitor logging field, or analytics policy change.
    - _Requirements: 1.2, 1.6, 1.7, 3.4, 4.4, 8.1, 8.5, 10.6–10.8, 11.1–11.7_

- [x] 6. Resolve one dual-source snapshot and retain strict build verification
  - [x] 6.1 Add dual-source conflict detection to the validated Talks gateway
    - Extend `TalkCriterion` in `src/lib/talks/model.ts` for the approved upload criteria and update `src/lib/talks/gateway.ts` so `resolveValidatedTalks` derives identity once for every valid Git/API record, classifies source by the reserved `api/` ID prefix, and detects all identity and slide-path collisions across drafts and published records.
    - Aggregate deterministic diagnostics naming the colliding value and every source; when Git participates, keep Git authoritative in remediation and name only the API record for removal rather than silently applying precedence.
    - Preserve the sole raw `getCollection("talks")` boundary, existing PDF/metadata validation, draft projection, ordering, immutable shared snapshot, and every downstream consumer.
    - _Requirements: 7.1–7.6, 8.2, 11.3, 11.4_

  - [x] 6.2 Add API namespace and identity checks without relaxing static verification
    - Extend `scripts/verify-static-build.mjs` to require globally unique derived Talk_Identity values across recursively read source records and enforce `src/content/talks/api/` ↔ `/talks/slides/api/` namespace pairing in both directions.
    - Keep every existing Talks HTML/Markdown equivalence, draft exclusion, ordering, discovery, PDF signature, and one-to-one slide check unchanged and applied equally to Git-authored and materialized API-authored records.
    - Fail before publication on any conflict or namespace mismatch; add no API-specific bypass, external slide host, missing-representation allowance, or weaker parser rule.
    - _Requirements: 5.7, 7.4–7.6, 8.2–8.6, 9.7, 11.3–11.5_

  - [x]* 6.3 Write the property-based test for complete conflict-aware snapshots
    - **Property 9: The snapshot is complete, unique, and reports every conflict with its sources**
    - Generate finite mixed Git/API record sets with engineered identity and slide collisions; assert exact successful membership or exact conflict failure, complete source diagnostics, and API-removal-only remediation where Git participates.
    - **Validates: Requirements 7.1, 7.3, 7.4, 7.5**

  - [x]* 6.4 Add pipeline composition and removal integration coverage
    - Add a dedicated root `scripts/*.test.mjs` integration test that materializes valid and corrupted API records in a temporary project, runs the production gateway/verifier boundaries, and proves diagnostics match Git-authored validation strictness.
    - Cover materialize/build expectation setup, record removal followed by clear/re-materialize, and absence of residual talk, deck, Markdown, or discovery expectations without contacting AWS or deploying infrastructure.
    - _Requirements: 4.9, 6.6, 6.7, 7.4–7.8, 8.1–8.6, 9.6, 9.7, 11.3–11.5_

- [x] 7. Finish implementation wiring and update only existing project documents
  - [x] 7.1 Update the existing talk authoring and operational contracts
    - Update `README.md` with the repository-authored versus API-authored talk workflow, local materialization behavior, and both package validation commands.
    - Update `DEPLOY.md`, `docs/aws-migration.md`, and `docs/agent-readiness.md` only where their existing content API, publisher/materialization, retained storage, Talks representations, or production-safety sections require the approved behavior; create no new Markdown document.
    - State that API use requires temporary Root_Editor session credentials, introduces no public upload UI/editor identity, and that implementation/testing performs no AWS mutation, deployment, DNS, or nameserver action.
    - _Requirements: 1.5, 8.1–8.8, 10.7, 10.8, 11.1–11.7_

- [x] 8. Final checkpoint - Ensure all application and infrastructure validation passes
  - From the repository root, run `npm test`, `npm run check`, `npm run build`, and `npm run verify:build`; fix failures without weakening the completed Talks feature or static verifier.
  - From `infra/`, run `npm run build`, `npm test`, and `npm run synth`; fix failures and confirm synthesis only describes the approved source-level infrastructure changes.
  - Ensure all tests pass, ask the user if questions arise. Do not run CDK deploy/diff against AWS, invoke the content API, upload/delete S3 objects, start CodeBuild, change DNS, or perform any other AWS mutation.

## Notes

- Tasks marked with `*` are optional test-related work and can be skipped for a faster MVP; implementation agents must not implement skipped optional tasks.
- Each of the design's 14 correctness properties has exactly one separate property-based test task with the exact design title and requirement mapping.
- Property and integration test tasks use dedicated files so tasks in the same dependency wave can execute without editing the same target.
- Root and `infra/` are separate npm packages. Run dependency installation and lockfile updates from the owning package only; never replace one package's lockfile with the other's.
- `pdfjs-dist` remains an exact-pinned root development dependency and an exact-pinned infrastructure Lambda dependency; it must not become a site runtime dependency.
- Existing talks-section behavior, diagnostics, representations, and verifier checks are constraints, not migration targets. Do not relax or duplicate them.
- The implementation may change CDK source and synthesize locally only. It must not deploy, call production APIs, mutate AWS resources, start builds, or change DNS/nameservers.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "5.2"] },
    { "id": 1, "tasks": ["1.6", "1.7", "1.8", "1.9", "2.1", "2.2", "4.1"] },
    {
      "id": 2,
      "tasks": ["2.3", "2.5", "2.6", "2.7", "2.9", "4.2", "4.3", "4.4", "6.1"]
    },
    {
      "id": 3,
      "tasks": [
        "2.4",
        "2.8",
        "4.5",
        "4.6",
        "4.7",
        "4.8",
        "4.9",
        "5.1",
        "5.3",
        "6.2"
      ]
    },
    { "id": 4, "tasks": ["2.10", "4.10", "5.4", "6.3", "6.4"] },
    { "id": 5, "tasks": ["7.1"] }
  ]
}
```
