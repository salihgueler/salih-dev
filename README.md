# salih.dev

A text-first personal website and blog for Salih Güler, built with Astro and
TypeScript. The static site serves human-friendly pages and machine-readable
representations of the same public content.

## Requirements

- Node.js 22.12 or newer
- npm
- AWS CLI and the `personal` profile for infrastructure work

## Getting started

```sh
npm install
npm run dev -- --background
```

Astro starts at `http://localhost:4321` by default. Manage the background
process with `npm run astro -- dev status`, `npm run astro -- dev logs`, and
`npm run astro -- dev stop`.

## Commands

| Command                     | Purpose                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`               | Start the Astro development server                                        |
| `npm test`                  | Run importer and content-processing tests                                 |
| `npm run check`             | Run Astro and TypeScript diagnostics                                      |
| `npm run build`             | Build the static site into `dist/`                                        |
| `npm run verify:build`      | Verify discovery files, post representations, and self-hosted DEV banners |
| `./redeploy`                | Validate, review, deploy, publish, and verify the production site         |
| `npm run preview`           | Preview the production build locally                                      |
| `npm run import:dev`        | Synchronize reviewed DEV posts and banners                                |
| `npm run import:medium`     | Import reviewed Medium posts                                              |
| `npm run materialize:talks` | Rebuild generated API talk sources from local record/deck caches          |

Infrastructure commands run from `infra/`:

```sh
npm run build
npm test
npm run synth
```

## Content

Blog posts live in `src/content/blog/` and are validated by
`src/content.config.ts`. Set `draft: true` to exclude a post from the website,
RSS feed, and machine-readable indexes. Permanent identity, biography, social
links, and map presentation live in `src/config/site.ts`.

Talks have two authoring sources that converge before validation. Repository-authored
Markdown records live under `src/content/talks/` with PDFs under
`public/talks/slides/`; they are changed only through Git. API-authored records
and approved decks live under `talks/records/` and `talks/decks/` in the retained
content bucket. The publisher synchronizes those objects to separate local
caches and runs `npm run materialize:talks`, which clears and recreates only the
gitignored `src/content/talks/api/` and `public/talks/slides/api/` namespaces.
Records without an approved deck and unreferenced decks are excluded, while
repository-authored files are never modified.

Both sources use the strict `talks` schema in `src/content.config.ts` and the
shared validators in `src/lib/talks/`. Each record requires `title`, `eventName`,
a quoted `date` in `YYYY-MM-DD` form, `location`, an absolute HTTPS `eventUrl`,
1 to 10 unique `eventTypes` labels, and `slides`. `videoUrl` is optional and must
be a supported YouTube source URL (`youtube.com/watch?v=ID` or `youtu.be/ID`);
`sourceCodeUrl` is optional and must be a credential-free absolute HTTPS URL on
`github.com` (the `www.github.com` alias normalizes to it) with a non-empty
repository path, so deceptive suffix hosts and non-GitHub links are rejected;
`draft: true` excludes a talk from the website and every machine-readable
representation. Unknown fields are rejected. Repository slide paths use
`/talks/slides/<file>.pdf`; API paths are code-derived beneath
`/talks/slides/api/`.

The talk API exposes exactly four `AWS_IAM` routes for starting an upload,
completing server-side PDF validation, listing API records/versions, and
conditionally removing a record. It reuses the exact Root_Editor ARN allowlist
and temporary `aws login` credentials of the content API, and adds no public
upload UI, hosted login, alternate editor, or long-lived root key. Detailed
signed-request, replacement, removal, failure-recovery, and storage procedures
are in `DEPLOY.md`.

Build validation rejects invalid metadata, unsafe or escaping slide paths,
missing/empty/non-PDF/malformed/encrypted/zero-page documents, and duplicate
canonical identities or slide paths. All Git/API records resolve through one
validated snapshot for `/talks/`, `/talks/index.md`, `/sitemap.xml`, `/llms.txt`,
and `/llms-full.txt`. If sources conflict, repository content is authoritative
and the API record must be removed or replaced. A failed build leaves stored API
state unchanged and preserves the previously published site. The collection is
intentionally empty until the Author supplies a talk through one of these two
workflows.

For local API materialization, place stored record JSON and approved PDF files
in separate cache directories, then run:

```sh
TALK_RECORD_CACHE_PATH=<record-cache> \
TALK_DECK_CACHE_PATH=<deck-cache> \
npm run materialize:talks
```

The command reads the caches without modifying them. After any talk, slide, or
materialization change, run `npm test`, `npm run check`, `npm run build`, and
`npm run verify:build`. Infrastructure changes additionally require `npm run
build`, `npm test`, and `npm run synth` from `infra/`.

Current location and conference events use the versioned schema in
`src/config/site-content-schema.ts`. Local builds use
`src/config/site-content.default.json`; production builds load
`site/content.v1.json` from the retained content bucket. The IAM-authenticated
content API updates that object and starts the existing publisher, so content
changes do not require a CDK deployment. The API uses an exact root-ARN allowlist
for this personal account and has no public or alternate editor identity.

The DEV importer uses reviewed category and summary metadata, writes normalized
Markdown, and downloads deterministic banner files under
`public/images/blog/`. That generated directory and `.cache/` manifest are
ignored by Git; the publication pipeline persists them in the retained content
bucket. DEV-origin frontmatter must reference
`https://salih.dev/images/blog/...`, never the upstream image proxy.

## Machine-readable access

The site exposes:

- `/rss.xml` and `/sitemap.xml`
- `/llms.txt` and `/llms-full.txt`
- `/api/catalog.json` and `/api/openapi.json`
- `/.well-known/agent-readiness.json`
- companion `.md` routes for canonical pages
- Markdown negotiation through `Accept: text/markdown`

CloudFront Functions preserve clean routes, negotiation cache separation,
canonical links, and `Content-Signal: search=yes, ai-input=yes, ai-train=no`.
See `docs/agent-readiness.md` for protocol details.

## AWS architecture

The CDK application in `infra/` defines two stacks:

- `SalihDevState`: retained, versioned content storage and the Route 53 zone.
- `SalihDevDelivery`: private website storage, CloudFront, ACM, Route 53 aliases,
  CodeBuild publication, an IAM-authenticated content API, daily DEV
  synchronization, alarms, and analytics.

Analytics use privacy-filtered CloudFront standard logs v2 in a retained
90-day S3 bucket, an external Glue table over the default CloudFront prefix, an
Athena workgroup, and three saved queries. Three CloudWatch custom widgets render
top content, daily traffic/errors, and edge p95 as in-console Markdown tables.
The read-only widget Lambda reuses eligible Athena results for one hour to keep
query and invocation costs negligible. The selected fields exclude IP addresses,
cookies, query strings, user agents, full referrers, and browser identifiers.

Operational monitoring uses default CloudFront 4xx/5xx metrics and a lightweight
15-minute EventBridge/Lambda homepage status-and-title check. It deliberately
avoids a browser canary and paid CloudFront additional metrics. The likely total
site cost is about $0.65/month while common account allowances remain available.

## Validation and deployment

Run the complete local gate before infrastructure work:

```sh
npm test
npm run check
npm run build
npm run verify:build

cd infra
npm run build
npm test
npm run synth
```

Production deployment uses the authenticated `personal` AWS CLI profile in
`us-east-1`. Always verify `aws sts get-caller-identity --profile personal` and
run a no-change-set CDK diff before requesting explicit deployment approval.
Never change Squarespace nameservers as part of an infrastructure deployment.

Detailed sequencing, ACM validation, DNS cutover, analytics queries, monitoring,
and rollback instructions are maintained in:

- [`DEPLOY.md`](DEPLOY.md)
- [`docs/aws-migration.md`](docs/aws-migration.md)
