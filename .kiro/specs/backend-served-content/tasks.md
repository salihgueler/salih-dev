# Implementation Plan: Backend-Served Content

## Overview

Serve every page whose content lives in the content bucket from a read-only Render Lambda at request time: the home page (location, events, latest posts), the Talks archive, the blog index, posts, categories and tags, and the machine-readable listings, each with its Markdown alternate. Slide decks and blog images are served straight from the content bucket through CloudFront. Content writes and the daily dev.to import invalidate the affected paths instead of rebuilding the site. The full publisher build stays for code and design changes.

## Tasks

- [x] 1. Request-time content seams in `src/`
  - [x] 1.1 S3-backed talk source (`src/lib/talks/s3-source.ts`) and request-scoped talks snapshot (`src/lib/talks/gateway-astro.ts`).
  - [x] 1.2 Request-scoped site content (`src/config/site-content-source.ts`).
  - [x] 1.3 Request-scoped published posts (`src/lib/blog/posts-source.ts`), S3 post source (`src/lib/blog/s3-posts.ts`) and one shared blog schema (`src/lib/blog/schema.ts`) used by both the Astro collection and the S3 source.
  - [x] 1.4 One shared Markdown config (`src/lib/markdown-config.ts`) used by `astro.config.ts` and the request-time post renderer, so post bodies render identically.
  - [x] 1.5 `src/lib/render-content.ts` reads `site/content.v1.json`, `talks/records/`, the `talks/decks/` key listing and `posts/` from S3. It never downloads a deck and never falls back to repo content.

- [x] 2. Dynamic routes
  - [x] 2.1 16 route files use `export const prerender = PRERENDER_DYNAMIC_ROUTE`; `infra/scripts/build-render-lambda.mjs` validates every sentinel before patching, patches them to `false` for the SSR build only, restores them afterwards, and holds a lock so concurrent builds cannot interleave.
  - [x] 2.2 `src/middleware.ts` loads what each route needs (site content for every route, posts for home/blog/listings, talks for Talks and listings). Any read failure, including a missing `site/content.v1.json`, returns a `no-store` 502.
  - [x] 2.3 `blog/[slug].astro` renders the build-time `render()` output in the static build and the request-time compiled HTML in the SSR build; an unknown slug is a 404.

- [x] 3. CDK
  - [x] 3.1 Render behaviors: `/`, `/index.md`, `/talks`, `/talks/`, `/talks/index.md`, `/blog`, `/blog/*`, `/categories/*`, `/tags/*`, `/rss.xml`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt`. About, contact, 404, skills and the API catalog stay static.
  - [x] 3.2 Render role: `s3:GetObject` on `site/content.v1.json`, `talks/records/*`, `posts/*`; `s3:ListBucket` scoped to `talks/records/*`, `talks/decks/*`, `posts/*`. No write, no deck read.
  - [x] 3.3 Deck behavior `/talks/slides/api/*` and image behavior `/images/blog/*` served from the content bucket through prefix-scoped OAC origins. The OAC grants land in the state stack's content-bucket policy and use an account-scoped `distribution/*` SourceArn, because a concrete distribution id would create a cross-stack cycle.
  - [x] 3.4 Import-only `DevImporter` CodeBuild project runs daily: dev.to import, sync `posts/` and `images/`, scoped invalidation. No site build or site-bucket sync.

- [x] 4. Writes invalidate instead of publish
  - [x] 4.1 Site content writes invalidate every dynamic route (the location is in every page's JSON-LD).
  - [x] 4.2 Talk writes invalidate `/talks/`, `/talks/index.md`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt`.

- [x] 5. Verification (no AWS mutation)
  - [x] 5.1 Root: `npm test` 81/81, `npm run check` 0 errors, `npm run build` 79 pages, `npm run verify:build`. Same with `infra/` moved aside.
  - [x] 5.2 Infra: `tsc`, `npm test` 50/50, `cdk synth --strict` clean (15 cache behaviors).
  - [x] 5.3 Lambda image (`public.ecr.aws/lambda/nodejs:24`, arm64, `--network none`, stubbed S3): all 16 dynamic routes return 200 with the right content type and are byte-identical to the static build; all 21 posts are byte-identical; an unknown post is 404; a missing site object and an S3 outage both return a `no-store` 502.

- [x] 6. Rollout flag (branch `feat/render-rollout-flag`, merged into this branch)
  - [x] 6.1 `infra/lib/feature-flags.ts`: AppConfig application, `production` environment, `render-flags` profile with `renderFromBackend` off, linear strategy with a 10-minute final bake, and the Errors, p95 and `RenderFailures` alarms as monitors.
  - [x] 6.2 Render Lambda: arm64 AppConfig Agent layer, prefetch list, scoped AppConfig read IAM, and `s3:GetObject` on the baked dynamic-route keys in the site bucket.
  - [x] 6.3 `src/lib/flags.ts`, `vid-cookie.ts`, `off-path-key.ts`, `off-path-render.ts` and the middleware branch: flag off or a flag-on 5xx serves the baked page; `x-render-path` on every response.
  - [x] 6.4 CloudFront: `vid`-only origin request policy and a no-cache render policy during the rollout.
  - [x] 6.5 Dual writes gated on `RENDER_ROLLOUT_ACTIVE`: content/talk writes and the `DevImporter` also start the publisher.
  - [x] 6.6 Verification: root `npm test` 112/112, infra 59/59, `cdk synth --strict`; Lambda image proof of flag on, flag off, extension down, cookie minting and a flag-on read failure.
  - [ ] 6.7 Deploy with the flag off, then roll out per `DEPLOY.md` section 11.
  - [ ] 6.8 Remove the flag at 100%.
