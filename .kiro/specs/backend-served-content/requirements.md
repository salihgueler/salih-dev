# Requirements Document

## Introduction

This feature makes the salih.dev Talks archive, the current-location display, and the conference/events list resolve from backend content at request time instead of being baked into the static build. A content change to any of these must appear on the live site within seconds, without starting the CodeBuild publisher. Blog posts, the About and Contact pages, and every other page stay static and continue to publish only through the publisher.

Repository inspection established the ground this feature builds on. The published site is an Astro `output: "static"` build synchronized to a private S3 site bucket and served worldwide by one CloudFront distribution (`SalihDevDelivery`) with an Origin Access Control S3 origin, a viewer-request CloudFront Function that redirects `www`, negotiates Markdown, and maps clean URLs to S3 keys, and a viewer-response CloudFront Function that advertises canonical HTML and Markdown representations. Mutable content lives in the retained, private, versioned, TLS-only content bucket: the site content object `site/content.v1.json` holds the location and the events, API-authored talk records live under `talks/records/`, and approved decks live under `talks/decks/`. The publisher CodeBuild project copies that content into the source tree (`SITE_CONTENT_PATH`, `npm run materialize:talks`), runs the full test/check/build/verify gate, syncs `dist/` to the site bucket, and invalidates CloudFront. Three write paths currently trigger this publisher through `codebuild:StartBuild`: `PUT /v1/content` (location and events), `POST /v1/talks/uploads/{deckId}/completion` (talk publication), and `DELETE /v1/talks/records/{recordKey}` (talk removal).

Two facts shape these requirements. First, the human-readable HTML, the Markdown alternate, and the JSON-LD for talks are already produced by pure, side-effect-free modules (`src/lib/talks/gateway.ts` pure helpers, `projection.ts`, `markdown.ts`) from one validated published snapshot, and the location/events display is produced by pure classification (`src/config/site-content.ts`) from one validated content object. A request-time renderer can reuse those exact modules so its output matches the static build byte for byte. Second, the content already lives in S3 in the shape those modules expect, so a renderer needs only read access, not a new datastore.

The published Talks archive may be empty. This feature changes how content is served; it introduces no talk, location, or event content of its own.

## Glossary

- **Author**: Salih Güler or a trusted maintainer who manages salih.dev content through the site's existing author-controlled process.
- **Root_Editor**: The single account root identity the Content_API already authorizes for content changes, used as temporary credentials from the established `aws login` workflow.
- **Content_API**: The existing IAM-authorized HTTP API `salih-dev-content` that serves the mutable content routes.
- **Publisher**: The existing `salih-dev-publisher` CodeBuild project that materializes remote content into the source tree, runs the full gate, syncs `dist/` to the Site_Bucket, and invalidates the Distribution.
- **Distribution**: The existing `SalihDevDelivery` CloudFront distribution that serves salih.dev worldwide.
- **Site_Bucket**: The private, OAC-only S3 origin bucket holding the published static site.
- **Content_Bucket**: The retained, private, versioned, TLS-only S3 bucket holding mutable content: `site/content.v1.json`, `talks/records/`, and `talks/decks/`.
- **Site_Content_Object**: The `site/content.v1.json` object holding the Location and the Events.
- **Location**: The Author's current city and country and the map coordinates, held in the Site_Content_Object.
- **Events**: The conference and community event list held in the Site_Content_Object, classified into upcoming and recent for display.
- **Talk_Record**: Structured content for one presentation, from a repository record under `src/content/talks/` or an API_Authored_Talk_Record under `talks/records/`.
- **API_Authored_Talk_Record**: A Talk_Record stored under `talks/records/` in the Content_Bucket.
- **Approved_Deck**: A validated PDF slide deck stored under `talks/decks/` in the Content_Bucket.
- **Published_Talk_Snapshot**: The single set of published, validated, newest-first Talk_Records produced by the existing talks gateway, with draft records excluded.
- **Dynamic_Route**: A public route whose primary content is the Talks archive, the Location, or the Events, and which this feature serves at request time.
- **Static_Route**: Every other public route (blog posts, About, Contact, RSS, static assets, and the like), served unchanged from the Site_Bucket.
- **Render_Function**: The backend compute this feature adds, which reads the Content_Bucket at request time and produces the HTML, Markdown, and JSON-LD for the Dynamic_Routes.
- **Dynamic_Origin**: The CloudFront origin, added to the existing Distribution, that routes Dynamic_Routes to the Render_Function.
- **Machine_Readable_Representation**: The Markdown representation of a public page negotiated by `Accept: text/markdown` or served from the page's `.md` alternate.
- **Discovery_Documents**: The site's `sitemap.xml`, `llms.txt`, and `llms-full.txt`.
- **Content_Signal**: The `Content-Signal: search=yes, ai-input=yes, ai-train=no` value the site advertises on content responses.
- **Visitor**: Any person or automated client, including a crawler or an AI agent, accessing the public site without authoring privileges.
- **Draft_Talk**: A Talk_Record with `draft: true`, which is never served publicly.

## Requirements

### Requirement 1: Serve Talks, Location, and Events from the backend at request time

**User Story:** As the Author, I want the Talks archive, my current location, and my events to come from stored content when a Visitor requests the page, so that a change is visible without a rebuild.

#### Acceptance Criteria

1. WHEN a Visitor requests a Dynamic_Route, THE Render_Function SHALL read the current content from the Content_Bucket and produce the response from that content.
2. THE Render_Function SHALL treat `/talks/` (HTML), `/talks/index.md` (Markdown), and the Location and Events regions of the pages that display them as Dynamic_Routes.
3. THE feature SHALL leave every Static_Route served from the Site_Bucket unchanged.
4. WHEN the Author changes the Site_Content_Object or an API_Authored_Talk_Record or Approved_Deck through the Content_API, THE site SHALL reflect that change on the affected Dynamic_Routes within seconds and without a Publisher build.
5. THE Render_Function SHALL require no client-side fetch to display the primary content of a Dynamic_Route; the HTML, Markdown, and structured data SHALL be present in the server response so a crawler or an AI agent that executes no JavaScript reads the same content a browser renders.

### Requirement 2: Produce output identical to the static build

**User Story:** As a Visitor or an automated client, I want the dynamically served pages to be indistinguishable from the previously static pages, so that nothing about links, structure, metadata, or machine-readability regresses.

#### Acceptance Criteria

1. THE Render_Function SHALL produce the `/talks/` HTML, its `CollectionPage`/`ItemList` JSON-LD, and its event-type and topic filter controls from the same Published_Talk_Snapshot and the same projection the static build uses.
2. THE Render_Function SHALL produce the `/talks/` Machine_Readable_Representation byte-for-byte identical to the static build's `/talks/index.md` for the same content.
3. THE Render_Function SHALL emit the Location and Events regions with the same markup, ordering, and date formatting the static build produces for the same Site_Content_Object.
4. THE Render_Function SHALL emit the same `Content-Signal`, security, and representation headers (canonical/alternate `Link`, `Vary: Accept`, `X-Content-Type-Options`, and the rest) that the Distribution and the static negotiation emit for the same route.
5. THE Render_Function SHALL exclude every Draft_Talk from every representation, exactly as the published snapshot does.
6. WHEN the published snapshot contains no talk, THE Render_Function SHALL emit the approved empty-archive message and no unusable filter controls.
7. THE Render_Function SHALL preserve the exact document title, single `h1`, canonical URL, and Markdown-alternate link the static Talks page and layout define.

### Requirement 3: Read-only, least-privilege backend access

**User Story:** As the Author, I want the request-time renderer to have only read access to the content it serves, so that a public-facing surface can never mutate content or read anything it does not need.

#### Acceptance Criteria

1. THE Render_Function SHALL be granted only `s3:GetObject` on the Site_Content_Object, the `talks/records/` prefix, and the `talks/decks/` prefix, and `s3:ListBucket` scoped to exactly the prefixes it reads.
2. THE Render_Function SHALL be granted no write, delete, or `codebuild:StartBuild` permission, and no access to any object outside the prefixes it reads.
3. WHERE the Render_Function treats a missing S3 object as absent, THE Render_Function's role SHALL carry prefix-scoped `s3:ListBucket` on that prefix so a missing key surfaces as a clean not-found rather than an access-denied masked as a server error.
4. THE Dynamic_Origin SHALL reach the Render_Function only through the managed front door of the existing Distribution and SHALL NOT expose the Render_Function as a directly world-reachable endpoint.
5. THE Render_Function SHALL emit no request body, PDF bytes, rendered content, IP address, cookie, query string, user agent, or referrer into its logs; log entries SHALL carry only the route, an outcome, and a request identifier.

### Requirement 4: Content writes stop triggering the Publisher

**User Story:** As the Author, I want a location, event, talk-completion, or talk-removal write to go live immediately on its own, so that I no longer wait for or depend on a full rebuild for these changes.

#### Acceptance Criteria

1. WHEN `PUT /v1/content` stores a new Site_Content_Object, THE Content_API SHALL NOT start a Publisher build.
2. WHEN `POST /v1/talks/uploads/{deckId}/completion` stores an approved API_Authored_Talk_Record and Approved_Deck, THE Content_API SHALL NOT start a Publisher build.
3. WHEN `DELETE /v1/talks/records/{recordKey}` removes an API_Authored_Talk_Record and its Approved_Deck, THE Content_API SHALL NOT start a Publisher build.
4. WHEN any of these three writes succeeds, THE Content_API SHALL invalidate exactly the Dynamic_Routes affected by the write on the existing Distribution, scoped to that Distribution.
5. THE Content_API write paths SHALL retain their existing authorization, validation, precondition, conflict, and storage behavior, changing only the follow-on publication and cache-refresh action.
6. THE Content_API SHALL keep the write response contract meaningful without the Publisher build identifier, reporting the stored version and the invalidation outcome instead.
7. THE Publisher SHALL remain the sole mechanism for publishing code, design, blog, and every other static change, and the scheduled and manual Publisher builds SHALL continue to function.

### Requirement 5: Caching, freshness, and resilience at the edge

**User Story:** As a Visitor, I want the dynamic pages to load fast and stay available, and as the Author I want my changes to appear quickly, so that dynamic serving costs neither speed nor reliability.

#### Acceptance Criteria

1. THE Dynamic_Origin SHALL cache Dynamic_Route responses at the Distribution so repeat requests are served from the edge rather than re-invoking the Render_Function for every request.
2. WHEN a content write succeeds, THE Content_API's invalidation SHALL cause the next request for each affected Dynamic_Route to reflect the new content.
3. WHERE the Render_Function or the Content_Bucket is briefly unavailable, THE Distribution SHALL serve the last successfully cached response for a Dynamic_Route rather than an error, for a bounded staleness window.
4. IF the Render_Function cannot read required content and no cached response is available, THEN THE Render_Function SHALL return a server-error status that the Distribution does not cache as a success.
5. THE Dynamic_Route responses SHALL carry cache-control directives consistent with edge caching plus write-driven invalidation, and SHALL NOT instruct a Visitor's browser to hold content so long that an invalidated change is hidden.

### Requirement 6: Build no longer requires materialized dynamic content

**User Story:** As the Author, I want the static build and its verification to succeed without the location, events, or API talks being materialized into the source tree, so that a build for a code or blog change does not depend on dynamic content that is now served at request time.

#### Acceptance Criteria

1. THE static build SHALL succeed for the Static_Routes without the Site_Content_Object being copied into the source tree and without API talks being materialized.
2. THE static-build verification SHALL NOT fail on the absence of dynamically served Talks, Location, or Events output in `dist/`.
3. WHERE the static build still emits a Talks representation, THE verification SHALL accept an empty or fallback Talks archive as valid rather than requiring materialized API talks.
4. THE Publisher buildspec SHALL no longer require the talk-materialization and site-content-copy steps as a precondition for a successful build of the Static_Routes; any retained step SHALL be optional and non-blocking.
5. THE change SHALL keep the repository-authored talk records, when present, valid input to whichever path renders talks.

### Requirement 7: Implementation, deployment, and boundary constraints

**User Story:** As the Author, I want this change implemented and validated without any AWS mutation or deployment, so that I review it before anything is provisioned or billed.

#### Acceptance Criteria

1. THE implementation SHALL be written in strict TypeScript with no `any` and no type-error suppression, and SHALL pin any new dependency to an exact version.
2. THE Render_Function SHALL run on the Node 24 arm64 Lambda runtime used by the existing content functions, and WHERE it imports an ESM-only dependency it SHALL be bundled as ESM with the `createRequire` banner so no ESM-only module is `require()`d at runtime.
3. THE publisher source asset SHALL continue to exclude `infra/`, so any test that the publisher runs SHALL NOT import a file under `infra/`.
4. THE work SHALL make no commit, push, pull request, `cdk deploy`, or any other AWS mutation, and SHALL use read-only AWS access only where genuinely required.
5. THE work SHALL pass the existing gates: root `npm test`, `npm run check`, `npm run build`, `npm run verify:build`, the infra tests, and `cdk synth`, including the root test and build with `infra/` moved aside.
6. THE Render_Function's request-time behavior SHALL be proven locally against the real Lambda Node 24 arm64 runtime image before the feature is considered complete, with no network access and stubbed content.
