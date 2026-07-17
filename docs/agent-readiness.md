# Agent readiness deployment notes

The application exposes its locally verifiable readiness state at:

- `/.well-known/agent-readiness.json`
- `/api/catalog.json`
- `/llms.txt` and `/llms-full.txt`
- canonical content routes through `Accept: text/markdown`

## DNS-AID

DNS configuration is intentionally marked unavailable in the manifest because
deployment and DNS management are outside this repository.

When a hosting provider and the final DNS-AID convention are selected, publish
a TXT record that points agents to the readiness manifest. The deployment
record should carry this value:

```text
manifest=https://salih.dev/.well-known/agent-readiness.json
```

Confirm the owner name and version marker against the current DNS-AID
specification before publishing; emerging discovery conventions may change.

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
