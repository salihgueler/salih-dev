# Agent instructions

## Project shape

- The Astro application is at the repository root and builds to `dist/`.
- AWS CDK infrastructure is a separate TypeScript package under `infra/`.
- Existing architecture and operations documentation lives in `README.md`,
  `DEPLOY.md`, `docs/aws-migration.md`, and `docs/agent-readiness.md`.
- Do not create additional Markdown documentation unless the user explicitly
  requests it; update the relevant existing document instead.

## Local development

Use Astro background mode for a long-lived development server:

```sh
npm run dev -- --background
npm run astro -- dev status
npm run astro -- dev logs
npm run astro -- dev stop
```

Before reporting an application or content change complete, run:

```sh
npm test
npm run check
npm run build
npm run verify:build
```

Before reporting an infrastructure change complete, also run from `infra/`:

```sh
npm run build
npm test
npm run synth
```

Do not add unit tests unless the user explicitly requests them. Existing tests
must continue to pass.

## Content synchronization

- DEV articles are synchronized with `npm run import:dev`.
- Preserve reviewed metadata in `scripts/import-dev.mjs`.
- DEV banner frontmatter must use `https://salih.dev/images/blog/...`.
- `public/images/blog/` and `.cache/` are generated and intentionally ignored;
  do not commit their contents.
- Do not weaken `scripts/verify-static-build.mjs` to accept upstream DEV image
  proxies or missing machine-readable representations.

## Privacy and observability

CloudFront analytics must remain aggregate and privacy-first. Do not add these
fields to standard logging:

- client IP or forwarded IP
- cookies
- query strings
- user agent
- full referrer
- browser or device identifiers

Keep analytics storage private, TLS-only, SSE-S3 encrypted, and limited to the
90-day lifecycle unless the user explicitly approves a policy change. Keep the
Athena dashboard widget read-only, without a public endpoint, and retain its
one-hour result reuse plus one-week Lambda log retention. Prefer service-default
metrics and the scheduled Lambda homepage checker over paid CloudFront additional
metrics or browser canaries.

## AWS deployment safety

- Production uses the `personal` AWS CLI profile in `us-east-1`.
- Verify the account before every deployment with
  `aws sts get-caller-identity --profile personal`.
- Run CDK diff with `--profile personal --strict --no-change-set` first.
- Deploy `SalihDevState` before `SalihDevDelivery`.
- Deployment creates billable resources and requires explicit user approval.
- DNS cutover is a separate high-risk action. Never change Squarespace
  nameservers without separate explicit approval and a complete DNS inventory.
- Retained state and analytics buckets may survive stack deletion; do not delete
  production resources or disable retention protections without approval.

## Git

Do not commit or push unless requested. When committing, keep each commit to one
logical purpose, stage only the intended files, preserve hooks, and never push
directly to the protected branch.
