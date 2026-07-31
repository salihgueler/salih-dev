# salih.dev

A text-first personal website and blog for Salih Güler, built with Astro and
TypeScript. The site serves both human-friendly pages and machine-readable
representations of its public content.

## Requirements

- Node.js 22.12 or newer
- npm

## Getting started

```sh
npm install
npm run dev -- --background
```

Astro starts the development server at `http://localhost:4321` by default.
Manage the background process with:

```sh
npm run astro -- dev status
npm run astro -- dev logs
npm run astro -- dev stop
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Astro development server |
| `npm run check` | Run Astro and TypeScript diagnostics |
| `npm run build` | Build the static site into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm start` | Run the built server from `dist/` |
| `npm run import:dev` | Import reviewed DEV Community posts |
| `npm run import:medium` | Import reviewed Medium posts |

## Content

Blog posts live in `src/content/blog/` as Markdown files. Their frontmatter is
validated by the collection schema in `src/content.config.ts`:

```yaml
---
title: Post title
description: Short page and feed description
pubDate: 2026-01-01
updatedDate: 2026-01-02 # optional
category: Web Development
tags:
  - Astro
hero:
  src: https://example.com/image.jpg
  alt: Description of the image
  credit: Image source
  creditUrl: https://example.com
aiSummary: A concise summary of the article.
canonical: https://example.com/post # optional
originalUrl: https://example.com/post # optional
sources: []
draft: false
---
```

Set `draft: true` to exclude a post from the website, RSS feed, and
machine-readable indexes. Site identity, biography, social links, location,
and conference details are maintained in `src/config/site.ts`.

The import scripts fetch published articles and write normalized Markdown into
the blog collection. Each imported article must first have reviewed category
and summary metadata in the corresponding script.

## Machine-readable access

The site exposes:

- `/rss.xml` and `/sitemap.xml` for content discovery
- `/llms.txt` and `/llms-full.txt` for machine-readable site context
- `/api/catalog.json` and `/api/openapi.json` for public API discovery
- `/.well-known/agent-readiness.json` for capability status
- Companion `.md` routes for canonical pages
- Markdown content negotiation with `Accept: text/markdown`

See `docs/agent-readiness.md` for deployment and cache requirements related to
content negotiation and discovery headers.

## Production

```sh
npm run check
npm run build
npm run preview
```

The production site is pre-rendered and does not require a Node.js server.
AWS infrastructure, deployment steps, domain cutover, daily DEV synchronization,
and cost estimates are documented in:

- [`docs/aws-migration.md`](docs/aws-migration.md)
- [`DEPLOY.md`](DEPLOY.md)
