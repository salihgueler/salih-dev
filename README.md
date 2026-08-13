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

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Astro development server |
| `npm test` | Run importer and content-processing tests |
| `npm run check` | Run Astro and TypeScript diagnostics |
| `npm run build` | Build the static site into `dist/` |
| `npm run verify:build` | Verify discovery files, post representations, and self-hosted DEV banners |
| `npm run preview` | Preview the production build locally |
| `npm run import:dev` | Synchronize reviewed DEV posts and banners |
| `npm run import:medium` | Import reviewed Medium posts |

Infrastructure commands run from `infra/`:

```sh
npm run build
npm test
npm run synth
```

## Content

Blog posts live in `src/content/blog/` and are validated by
`src/content.config.ts`. Set `draft: true` to exclude a post from the website,
RSS feed, and machine-readable indexes. Site identity, biography, social links,
location, and conference details live in `src/config/site.ts`.

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
  CodeBuild publication, daily DEV synchronization, alarms, and analytics.

Analytics use privacy-filtered CloudFront standard logs v2 in a retained
90-day S3 bucket, a projected Glue table, an Athena workgroup, and three saved
queries. The selected fields exclude IP addresses, cookies, query strings, user
agents, full referrers, and browser identifiers.

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
