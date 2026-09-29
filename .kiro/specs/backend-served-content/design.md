# Design Document: Backend-Served Content

## Overview

This feature moves three content surfaces — the Talks archive, the Author's current Location, and the Events list — from the baked static build to request-time rendering, so a content change is live in seconds without a publisher build. It does this by adding one read-only Render Lambda as a second CloudFront origin on the existing `SalihDevDelivery` distribution, behind cache behaviors that route only the dynamic routes to it. Every other page stays static and continues to publish only through the CodeBuild publisher.

The design's load-bearing property is byte-parity with the static build. The Talks HTML, its JSON-LD, and its Markdown alternate are already produced by pure, side-effect-free modules (`src/lib/talks/gateway.ts` pure helpers, `projection.ts`, `markdown.ts`) from one validated published snapshot; the Location and Events display is produced by pure classification (`src/config/site-content.ts`, `src/config/site.ts`, `LocationSidebar.astro`'s markup) from one validated content object. The Render Lambda reuses those exact modules, reading the same S3 objects the publisher materializes, so what it emits at request time matches what the static build would have baked.

### Goals

- Serve `/talks/`, `/talks/index.md`, and the home page `/` (with its Location and Events) at request time from the content bucket.
- Make `PUT /v1/content`, talk-upload completion, and talk removal go live in seconds by invalidating exactly the affected dynamic routes instead of starting the publisher.
- Keep the request-time output identical to the static build: same HTML, JSON-LD, Markdown, headers, ordering, date formatting, empty state, and draft exclusion.
- Keep the Render Lambda strictly read-only and least-privilege, reachable only through CloudFront.
- Keep the static build and its verification green without materializing dynamic content.

### Non-goals

- Making every page dynamic. Only the routes whose primary content is Talks, Location, or Events become dynamic.
- A new datastore, admin surface, authentication, or visitor-facing write path.
- Changing the publisher's role for code, design, blog, and other static content.
- Client-side fetching of primary content; the server response carries the full HTML, Markdown, and structured data.
- Any AWS mutation or deployment in this change.

### Repository and research findings

- `astro.config.ts` sets `output: "static"`; the site is synced to the private OAC S3 origin and served by one CloudFront distribution in `infra/lib/delivery-stack.ts`. The distribution already carries a viewer-request CloudFront Function (`edge-functions.ts`) that maps clean URLs to S3 keys and negotiates Markdown, and a viewer-response function that advertises representations.
- Talk rendering is centralized: `gateway.ts` is the only reader of the `talks` collection, and `projection.ts`/`markdown.ts` are pure. `getPublishedTalksSnapshot()` returns the newest-first, draft-excluded snapshot. The `/talks/` page, `/talks/index.md`, `sitemap.xml`, `llms.txt`, and `llms-full.txt` all consume that one snapshot.
- The `talks` collection is populated by `npm run materialize:talks` (`scripts/materialize-api-talks.mjs` → `src/lib/talks/materialize.ts`), which reads the publisher's local caches of `talks/records/` and `talks/decks/`. The record shape (`api-record.ts`) and the deck path derivation (`deck.ts`) are pure and reusable outside Astro.
- Location and events: `site-content.ts` reads `site-content.default.json` (or `SITE_CONTENT_PATH`), validates through `site-content-schema.ts`, and classifies events into `upcoming`/`recent`. `site.ts` exposes `location` and `conferences`. These render in `LocationSidebar.astro` (home `/`), `BaseLayout.astro` JSON-LD `homeLocation` (every page head), and the home Markdown document in `markdown-documents.ts`.
- The three write handlers (`content-write.ts`, `talk-upload-complete.ts`, `talk-records.ts`) each end by calling `codebuild:StartBuild`. Their IAM grants include that action in `content-api.ts`.
- The publisher's application source asset in `delivery-stack.ts` excludes `infra/**`, and CodeBuild installs only root dependencies. A root test that imports an `infra/` file therefore fails in CodeBuild. This constrains where the render composition tests live.
- `talk-upload-complete.ts` already imports `../../src/lib/talks/*.js` with `resolution-mode: import`, establishing that an infra Lambda can reuse the `src/lib/talks` modules. `content-api.ts` already builds an ESM Node 24 arm64 `NodejsFunction` with the `createRequire` banner and `bundleAwsSDK` for `pdfjs-dist`; the Render Lambda follows the same recipe because it transitively pulls the talk modules.

Content from external documentation is rephrased for compliance with licensing restrictions.

## Architecture

### System context

```mermaid
flowchart LR
  V[Visitor / crawler / agent] --> CF[CloudFront SalihDevDelivery]
  CF -->|static routes| S3[(Site bucket - static dist)]
  CF -->|/talks/, /talks/index.md, /| RL[Render Lambda]
  RL -->|GetObject read-only| CB[(Content bucket\nsite/content.v1.json\ntalks/records/\ntalks/decks/)]
  RL --> PT[getPublishedTalksSnapshot from S3]
  RL --> SC[site-content classification]
  PT --> HTML[/talks/ HTML + JSON-LD]
  PT --> MD[/talks/index.md]
  SC --> HOME[home / HTML + JSON-LD + /index.md]
  A[Author] -->|PUT /v1/content,\ncompletion, DELETE record| API[Content API]
  API -->|store| CB
  API -->|scoped invalidation| CF
```

### Route classification

- **Dynamic routes (Render Lambda origin):** `/talks/` (HTML), `/talks/index.md`, `/talks/` with `Accept: text/markdown`; the home page `/` (HTML), `/index.md`, and `/` with `Accept: text/markdown`.
- **Static routes (S3 origin, unchanged):** every other path, including `/about/`, `/contact/`, `/blog/**`, `/categories/**`, `/tags/**`, `rss.xml`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, `.well-known/**`, `_astro/**`, and all assets.

The dynamic set is exactly the routes whose *primary* content is Talks, Location, or Events. It is expressed as a small number of CloudFront cache behaviors with explicit path patterns, so the default behavior (the S3 origin) is untouched for everything else.

### Where the Location decision lands

The Location and Events are primary content on the home page `/` (the `LocationSidebar`, the "Currently in {city}" line, and the upcoming/recent conference lists) and in the home Markdown document. They also appear as a single secondary JSON-LD field, `homeLocation`, in the `<head>` of *every* page through `BaseLayout.astro`.

The decision is to make the **home page `/` (HTML + `/index.md`) and `/talks/` (HTML + `/talks/index.md`)** the dynamic routes, and to leave the site-wide `homeLocation` JSON-LD on other static pages as of the last publish.

Justification. The location's authoritative, human-visible presentation — the map, the "currently in" sentence, and the home-page structured data — is on the home page, and that page becomes dynamic, so a location change is live within seconds where a reader or an agent actually looks for it. The `homeLocation` field on About, Contact, and blog pages is coarse secondary metadata (a home city on the `Person` schema, not a live-location claim), and making every page dynamic to keep that one field fresh would turn the entire site into request-time compute for a value that is stable for weeks and already correct on the page a reader consults for location. This keeps the dynamic surface minimal (two page families), preserves the cheap static default for the whole long tail, and matches the existing memory rule that the biography location and the current-location map are allowed to diverge. When the Author changes cities, the next publisher build (blog cadence, or a manual run) refreshes the secondary `homeLocation` on the static pages; nothing about correctness depends on it being instantaneous.

The alternative of injecting location into every static page via a CloudFront edge function or an SSR-everywhere origin was rejected: it spreads request-time compute across the whole site for a secondary field, and an edge-function HTML rewrite of baked pages is fragile against markup changes.

### The Render Lambda

One Lambda, Node 24 arm64, packaged from the Astro SSR build produced by the official `@astrojs/node@11.1.0` adapter (middleware mode) plus a thin API Gateway v2 handler that bridges the event to the adapter's Node `http` handler. `infra/scripts/build-render-lambda.mjs` assembles it: patch the four routes' prerender flag to a literal `false`, run `SALIH_DEV_SSR=1 npm run build`, copy `dist/server` + `dist/client` as siblings so the adapter's runtime client-directory resolution works, and esbuild both the handler and the server entry to ESM (createRequire banner; the AWS SDK is bundled, not left external, because ESM resolution ignores `NODE_PATH` — the same class of fix as `talk-upload-complete.ts`). It is fronted by a Function URL with `AWS_IAM` auth + CloudFront OAC, so it is never world-reachable.

Responsibilities:

1. Parse the incoming request path and `Accept` header (the render-origin CloudFront viewer-request function normalizes `www`, keeps the clean route path the SSR server matches, and negotiates the `.md` alternate; it does NOT append `/index.html`).
2. For a talks route: the bundled Astro middleware reads `talks/records/` and `talks/decks/` from the content bucket, builds the same validated published snapshot the static build builds (reusing `resolveValidatedTalks`/`selectPublishedTalks` and the S3-backed record source in place of the Astro collection reader, with `skipPdfParse` so no PDF is re-parsed at render time), sets it as the request-scoped published-talks override, and the same `/talks/` `.astro` page renders the HTML or the Markdown route serializes via `serializeTalksMarkdown`.
3. For the home route: the middleware reads `site/content.v1.json`, validates it through `parseSiteContent`, and sets the request-scoped site-content override; the same home `.astro` page renders the sidebar + latest posts, or the home Markdown document is serialized. Latest-posts content on the home page is static blog data compiled into the SSR bundle.
4. Emit the same headers the static path emits: `Content-Signal`, the canonical/alternate `Link` set, `Vary: Accept`, `X-Content-Type-Options`, referrer policy, and the correct `Content-Type`.
5. Read-only S3: `GetObject` on the three prefixes plus prefix-scoped `ListBucket` on each (so a missing key is a clean 404, not an S3 `AccessDenied` masked as a 500 — the same lesson already applied to the read/records handlers).

The Lambda produces HTML by rendering the same `.astro` components. Two implementation options for the HTML body were considered:

- **Extract the dynamic-region markup into pure TypeScript template functions** that both the `.astro` component and a plain Lambda call. This keeps the Lambda free of the Astro runtime, but it means hand-maintaining a second copy of every component's markup (cards, filters, JSON-LD, the location sidebar, the layout head) and proving byte-parity against the compiled Astro output — a large, brittle reverse-engineering surface that drifts the moment a component changes.
- **Server-render Astro in the Lambda via the official Node adapter.** The same `.astro` components render at request time, so there is exactly one source of truth for the markup and parity is structural rather than asserted against a copy.

Decision (revised during implementation): **server-render Astro with the official `@astrojs/node@11.1.0` adapter in middleware mode.** The template-extraction approach was rejected once the cost of hand-copying the Astro-compiled HTML became clear (the previous attempt abandoned exactly that path). The adapter build produces a standard SSR server the render Lambda wraps; the four dynamic routes opt out of prerendering while every other route stays prerendered and static. Request-time freshness is injected through two request-scoped `AsyncLocalStorage` seams (site content and the published-talks snapshot) that the readers resolve through, defaulting to the build-time content so the static build's output is unchanged. The pdfjs parse is skipped at render time (`skipPdfParse`), so the Astro runtime is pulled into the request path but no native canvas dependency is, and cold-start stays bounded. This is the "another official approach that works on Lambda" allowed by the constraints, and it removes the parity-drift risk entirely.

### CloudFront origin and caching

- Add a second origin to the existing distribution for the Render Lambda. To keep the Lambda off the public internet (matching the content API's rationale for choosing API Gateway over a `Principal:"*"` Function URL), front it with the same managed-origin pattern: an HTTP API origin, or a Function URL with OAC and an origin-access policy scoped to the distribution. Chosen: **Function URL + CloudFront OAC**, because the render path is a single GET-only origin with no route fan-out, OAC keeps it non-public, and it avoids a second API Gateway stage; the content API's API-Gateway choice was driven by its multi-route mutating surface, which the read-only renderer does not have. (If account guardrails flag a Function URL, the fallback is an HTTP API origin; the design keeps the origin construct isolated so the swap is local.)
- Cache behaviors: explicit path patterns `"/talks/"`, `"/talks/index.md"`, and the home patterns route to the Render origin; the default behavior stays on S3. A cache policy keys on the path and on `Accept` (so HTML and Markdown negotiate correctly) and honors the origin's `Cache-Control`.
- Freshness: the Render Lambda sets a short `Cache-Control` `max-age`/`s-maxage` so the edge serves repeat requests without re-invoking the Lambda, while a content write invalidates the exact affected paths so the next request is fresh within seconds.
- Resilience: the origin behavior enables `stale-if-error` semantics via a CloudFront error-caching/`origin-shield`-style fallback so a brief Lambda or S3 blip serves the last good cached response rather than an error. A hard read failure with no cached response returns a 5xx that CloudFront does not cache as success.

### Write paths: invalidate instead of publish

Each of the three write handlers drops its `codebuild:StartBuild` call and instead issues a scoped CloudFront invalidation for exactly the affected dynamic paths, on the existing distribution:

- `content-write.ts` (`PUT /v1/content`): invalidate the home paths (`/`, `/index.md`).
- `talk-upload-complete.ts` (completion): invalidate the talks paths (`/talks/`, `/talks/index.md`).
- `talk-records.ts` (DELETE): invalidate the talks paths.

The handlers keep every existing authorization, precondition, conflict, and storage behavior; only the follow-on action changes. Their IAM policies swap `codebuild:StartBuild` on the publisher project ARN for `cloudfront:CreateInvalidation` scoped to the one distribution ARN (the same scoped grant the publisher already holds). The response contract reports the stored version and the invalidation id instead of a build id. The distribution id is passed to these functions as an environment variable, resolved in `content-api.ts` from the distribution the delivery stack owns.

The publisher remains the sole path for code/design/blog changes; its scheduled and manual builds are untouched.

### Build no longer needs materialized dynamic content

Because talks and site content are served at request time, the static build for the static routes no longer needs them materialized. The changes:

- The static `/talks/` page and its outputs either become an empty/fallback archive at build time (the gateway already renders an approved empty state), or the talks routes are omitted from the static build and served only dynamically. Chosen: keep the routes present but allow an empty published snapshot at build time, so the build is self-sufficient and the dynamic origin overrides the baked page at the edge. This keeps sitemap/llms discovery entries stable.
- `verify-static-build.mjs` is adjusted so the Talks archive invariants accept an empty or fallback archive rather than requiring materialized API talks; the strict pairing checks still apply to any repository-authored talk that is present.
- The publisher buildspec's `materialize:talks` and `site-content` copy steps become optional and non-blocking for the static-route build (they may remain to keep any repository talk rendering, but a missing content object or empty caches no longer fail the build).

## Components and interfaces

### New modules

- `infra/functions/render.ts` — the Render Lambda handler: an API Gateway v2 ↔ Node `http` bridge that wraps the built Astro SSR server (`./server/entry.mjs`) and returns its response. GET/HEAD only; read-only.
- `infra/scripts/build-render-lambda.mjs` — assembles the render Lambda package: patches the four routes' prerender flag to `false`, runs the SSR build, copies `dist/server` + `dist/client` as siblings, and esbuilds the handler and server entry to ESM.
- `src/lib/talks/s3-source.ts` — a pure adapter that turns S3 object listings/bodies for `talks/records/` and `talks/decks/` into the `TalkSourceRecord[]` shape `resolveValidatedTalks` consumes, plus available deck ids. Mirrors what `materialize.ts` reads from local caches, but from S3 buffers, with no filesystem writes. Pure enough to unit-test with stubbed S3.
- `src/lib/render-content.ts` — reads the content bucket at request time and builds the two request-scoped overrides (site content, published-talks snapshot). Reused by the Astro middleware inside the SSR bundle.
- `src/config/site-content-source.ts` — the `AsyncLocalStorage` site-content override + build-time default; `src/config/site-content.ts` and `src/config/site.ts` (getters) resolve through it. `src/lib/talks/gateway-astro.ts` gains the parallel published-talks-snapshot override.
- `src/lib/dynamic-route.ts` — the `PRERENDER_DYNAMIC_ROUTE` sentinel the four routes export; the build script patches it to a literal per build shape.
- `src/middleware.ts` — the request-time seam: for the SSR build it resolves the route's content from S3 and runs the render inside the overrides; otherwise it keeps the dev-only Markdown negotiation.
- CDK (`delivery-stack.ts`): the render `lambda.Function` (Function URL + OAC), a render-specific viewer-request CloudFront function, the render cache policy + behaviors for the four dynamic paths, and (already present) the invalidation env/permission wiring on the content API functions.

### Reused modules (unchanged behavior)

- `src/lib/talks/gateway.ts` pure helpers (`resolveValidatedTalks`, `selectPublishedTalks`, `sortPublishedTalks`), `projection.ts`, `markdown.ts`, `api-record.ts`, `deck.ts`, `identity.ts`, `validation.ts`.
- `src/config/site-content.ts` classification, `site-content-schema.ts` validation.
- `src/lib/discovery.ts` (canonical/alternate/negotiation), `src/lib/http.ts` (`markdownResponse`).

### Interface: Render Lambda

Input: an origin request (API Gateway v2 event or Function URL event) carrying the resolved path and the `Accept` header. Output: `{ statusCode, headers, body }` with the correct `Content-Type` and the full representation headers. GET/HEAD only.

## Data model

No new persistent data. The Render Lambda reads existing objects:

- `site/content.v1.json` → `parseSiteContent` → Location + classified Events.
- `talks/records/*.json` + `talks/decks/*.pdf` → S3 source adapter → `resolveValidatedTalks` → `selectPublishedTalks` → published snapshot.

## Error handling

- Missing `site/content.v1.json`: fall back to the packaged `site-content.default.json` so the home page still renders defaults (the same fallback the build uses), rather than erroring.
- Missing talks prefix or empty: render the approved empty archive.
- S3 `AccessDenied` masking a missing key: prevented by prefix-scoped `ListBucket`, so absence is a clean not-found.
- Unreadable/invalid content the validator rejects: return a 5xx that CloudFront does not cache as success; `stale-if-error` serves the last good response meanwhile.
- Logs carry only route, outcome, and request id — no request/response bodies, PII, or headers.

## Testing strategy

- **Render handler unit tests** (in `infra/test/`, since the handler lives under `infra/`): talks HTML, talks Markdown (byte-equal to `serializeTalksMarkdown`), JSON-LD, filters, events, location, draft exclusion, empty state, and S3-read-failure → 5xx. Stub S3 with two published talks, a location, and events.
- **Render handler + runtime proof** (`infra/test/render.test.ts` + the Docker proof): the handler unit tests cover the API Gateway bridge (method gate, load-failure 5xx). The full four-route rendering — talks HTML with cards/filters/JSON-LD, talks Markdown byte-equal to `serializeTalksMarkdown`, home HTML with location/events, home Markdown, draft exclusion, empty state — is proven against the real Lambda Node 24 arm64 image with stubbed S3, because that is the only place the built SSR server actually runs.
- **Structural parity** comes from the components themselves: the request-time output is produced by the same `.astro` components and the same pure serializers the static build uses, so there is no separate template to assert byte-parity against.
- **CDK assertions** in `infra/test/stacks.test.ts`: the Render origin exists and is non-public; its cache behaviors cover the dynamic paths and the default stays S3; the Render role has only `GetObject` + prefix-scoped `ListBucket` and no write/StartBuild; the three write functions no longer have `codebuild:StartBuild` and now have `cloudfront:CreateInvalidation` scoped to the distribution.
- **Bundle test**: synthesize the Render Lambda asset and assert no ESM-only dependency is emitted as a `require()` call (same class of check the completion handler needs).
- **Asset-boundary regression**: the existing pattern — move `infra/` (or `infra/node_modules`) aside and run the root test/build — must still pass, proving no root test imports `infra/`.
- **Runtime proof**: run the synthesized render bundle inside `public.ecr.aws/lambda/nodejs:24`, `--platform linux/arm64`, `--network none`, dummy creds, via a node probe with `--no-experimental-require-module` and stubbed S3/fixtures, and show the rendered HTML, Markdown, and location/events output.

## Deployment and rollout (not executed here)

Deployment is a separate, explicitly approved step. The expected `cdk diff` shape:

- **Added**: the Render Lambda + its role/log group, the render origin (Function URL + OAC or HTTP API), the new CloudFront cache behaviors, the cache policy, and the `DISTRIBUTION_ID`/invalidation permissions on the three write functions.
- **Changed**: the CloudFront distribution (origins + behaviors), and the three write Lambda roles (StartBuild → CreateInvalidation) and their code assets; the publisher buildspec (optional materialize steps); `verify-static-build.mjs`.
- **Removed**: `codebuild:StartBuild` statements from the three write functions' policies.
- **Replaced**: none expected (the distribution is updated in place; buckets and the hosted zone are retained).
