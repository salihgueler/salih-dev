# Agent readiness deployment notes

The application exposes its locally verifiable readiness state at:

- `/.well-known/agent-readiness.json`
- `/api/catalog.json`
- `/llms.txt` and `/llms-full.txt`
- canonical content routes through `Accept: text/markdown`

## DNS-AID

DNS-AID remains marked unavailable because the discovery convention and TXT
owner name have not been finalized. Route 53 infrastructure is managed in this
repository, but DNS publication is intentionally separate from stack deployment.

After domain cutover and confirmation of the current DNS-AID specification, add
a TXT record to the Route 53 hosted zone that points agents to the readiness
manifest:

```text
manifest=https://salih.dev/.well-known/agent-readiness.json
```

Confirm the owner name and version marker against the current DNS-AID
specification before publishing; emerging discovery conventions may change.

## Talks representations

`/talks/` uses the same representation pair as the site's other canonical pages,
and both outputs are generated from one validated published snapshot, so a
record change is reflected in both or in neither:

- `dist/talks/index.html` is the canonical HTML archive.
- `dist/talks/index.md` is its Markdown alternate, advertised by the layout
  through the `/talks/` → `/talks/index.md` mapping in `src/lib/discovery.ts`.
- `/talks/` appears exactly once in `/sitemap.xml`, `/llms.txt`, and
  `/llms-full.txt`, always as the canonical trailing-slash URL.
- Published slide decks are served from
  `https://salih.dev/talks/slides/<file>.pdf`.

In development, `src/middleware.ts` negotiates the pair through that shared
discovery mapping, so Talks needs no route-specific middleware branch. In
production the CloudFront functions in `infra/lib/edge-functions.ts` own the
contract:

- clean `/talks` and `/talks/` requests rewrite to `/talks/index.html`;
- an explicit `text/markdown` preference rewrites to `/talks/index.md` before
  cache lookup, keeping the two representations in separate cache objects;
- an HTML preference keeps the HTML representation;
- successful `/talks/index.html` and `/talks/index.md` responses advertise
  `<https://salih.dev/talks/>; rel="canonical"; type="text/html"` and
  `<https://salih.dev/talks/index.md>; rel="alternate"; type="text/markdown"`
  alongside `Vary: Accept` and the catalog service description.

Repository-authored records under `src/content/talks/` and API-authored records
materialized under `src/content/talks/api/` enter the same validated snapshot.
API decks are materialized only beneath `public/talks/slides/api/`; both generated
namespaces are cleared and rebuilt from the approved record/deck caches before
each publisher validation pass. Missing approved decks are excluded, and no
materialization changes a repository-authored record or Git-tracked slide.

Canonical identity and slide-path conflicts fail the build with both sources
named. Repository content is authoritative when it participates, so remediation
removes or conditionally replaces the API-authored record rather than changing
repository content through the API. Metadata, PDF, and static verification use
the same strict rules for both sources.

A talk record that fails build validation fails site generation, leaves the
stored API state unchanged, and leaves the previously published site live. Only
a successful test, check, build, and verification gate publishes the snapshot.
The source mechanism does not change the public contract: HTML and Markdown,
sitemap, LLM indexes, and slide URLs still agree or publish nothing. While the
collection is empty, both representations publish the approved empty archive.

## Hosting headers

The runtime already emits these application headers:

```text
Content-Signal: search=yes, ai-input=yes, ai-train=no
Vary: Accept
Link: <...md>; rel="alternate"; type="text/markdown"
```

The selected host or CDN must preserve them and include `Accept` in its cache
key. It must not cache a Markdown response as the HTML representation.

Web Bot Auth, OAuth, and commerce protocols remain unavailable until real
cryptographic, identity, or transaction services exist. Their discovery routes
return RFC 9457 Problem Details with HTTP 501.
