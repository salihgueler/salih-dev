# Deploy salih.dev to AWS

Deployment creates billable AWS resources and changes DNS only when the
corresponding phase is explicitly approved.

## 1. Verify locally

```sh
npm ci
npm test
npm run check
npm run build
npm run verify:build

cd infra
npm ci
npm run build
npm test
npm run synth
```

## 2. Authenticate and bootstrap

Production uses the `personal` AWS CLI profile and `us-east-1`, where CloudFront
requires its ACM certificate. Authenticate in the user's terminal, then verify
the identity before any CDK command:

```sh
aws login --profile personal
export AWS_PROFILE=personal
export CDK_DEFAULT_REGION=us-east-1
aws sts get-caller-identity
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

cd infra
npx cdk bootstrap "aws://${CDK_DEFAULT_ACCOUNT}/${CDK_DEFAULT_REGION}"
```

Stop if the returned account is not the intended personal account. Run
`npx cdk diff --strict --no-change-set` before every deployment. Diff is a
read-only review step; deployment still requires separate explicit approval.

## 3. Deploy retained state

```sh
cd infra
npx cdk diff SalihDevState --strict --no-change-set
npx cdk deploy SalihDevState --strict
```

Record `HostedZoneNameServers`, `HostedZoneId`, and `ContentBucketName`.
Do not change Squarespace nameservers yet.

## 4. Deploy delivery without DNS downtime

Start the delivery deployment:

```sh
cd infra
npx cdk diff SalihDevDelivery --strict --no-change-set
npx cdk deploy SalihDevDelivery --strict
```

While CloudFormation waits for certificate validation, locate the pending
certificate:

```sh
aws acm list-certificates --region us-east-1
aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn <certificate-arn> \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
```

Add the returned validation CNAME to the current Squarespace DNS zone. Wait for
the delivery deployment to finish.

## 5. Run the initial publication

Use the `PublisherProjectName` stack output:

```sh
aws codebuild start-build --project-name <publisher-project-name>
aws codebuild batch-get-builds --ids <build-id>
```

Read build output from `/aws/codebuild/salih-dev-publisher`. Verify the
CloudFront URL from the stack output before DNS cutover.

## 6. Cut over Squarespace DNS

1. Export or inventory all current Squarespace DNS records.
2. Copy MX, TXT, CAA, DKIM, verification, and non-web subdomain records into
   Route 53.
3. Do not overwrite the CDK-managed apex and `www` A/AAAA alias records.
4. Compare both zones.
5. Replace the domain's nameservers at Squarespace with
   `HostedZoneNameServers`.
6. Keep Squarespace as the registrar.

Verify delegation and TLS:

```sh
dig NS salih.dev
dig A salih.dev
dig AAAA salih.dev
curl -I https://salih.dev/
curl -I https://www.salih.dev/
```

## 7. Verify agent readiness

```sh
curl -fsSI https://salih.dev/
curl -fsSI -H 'Accept: text/markdown' https://salih.dev/
curl -fsS -H 'Accept: text/markdown' https://salih.dev/about/ \
  | diff - <(curl -fsS https://salih.dev/about.md)
curl -fsSI https://salih.dev/talks/
curl -fsS -H 'Accept: text/markdown' https://salih.dev/talks/ \
  | diff - <(curl -fsS https://salih.dev/talks/index.md)
curl -fsSI https://salih.dev/llms.txt
curl -fsSI https://salih.dev/llms-full.txt
curl -fsSI https://salih.dev/api/catalog.json
curl -fsSI https://salih.dev/api/openapi.json
curl -fsSI https://salih.dev/.well-known/agent-readiness.json
curl -fsSI https://salih.dev/.well-known/mcp/server-card.json
curl -fsSI https://salih.dev/.well-known/skills/index.json
curl -fsSI https://salih.dev/skills/read-salih-dev/SKILL.md
curl -fsSI https://salih.dev/rss.xml
curl -fsSI https://salih.dev/sitemap.xml
```

For negotiated HTML and Markdown routes, verify `Content-Signal`, `Link`, and
`Vary: Accept` headers.

## 8. Analytics and operations

CloudFront standard logs v2 arrive as privacy-filtered JSON in the retained
`AnalyticsBucketName` bucket and expire after 90 days. The delivery excludes IP
addresses, cookies, query strings, user agents, and full referrers. Use the
`salih_dev_analytics` Glue database and `salih-dev-analytics` Athena workgroup.
Three saved queries provide top content, daily traffic/errors, and edge p95
performance.

List or run the saved queries:

```sh
aws athena list-named-queries \
  --work-group salih-dev-analytics \
  --region us-east-1
aws athena start-query-execution \
  --query-string 'SELECT * FROM salih_dev_analytics.cloudfront_access_logs LIMIT 20' \
  --query-execution-context Database=salih_dev_analytics \
  --work-group salih-dev-analytics \
  --region us-east-1
```

Open the `salih-dev-operations` CloudWatch dashboard for request volume, 4xx and
5xx rates, homepage check invocations and errors, p95 request duration, top
content, daily traffic/errors, and edge p95 performance. The three analytics
widgets invoke a read-only Lambda inside the AWS console and reuse eligible
Athena results for up to one hour. The dashboard viewer needs
`lambda:InvokeFunction` permission for the `AnalyticsWidgetFunctionName` output;
no public endpoint or site authentication is created.

An EventBridge rule invokes the lightweight homepage check every 15 minutes and
verifies the homepage HTTP status and title without a browser runtime. CloudFront
and homepage-check alarms publish to `BuildAlarmTopicArn`; subscribe and confirm
an email endpoint if notifications are wanted.

Use the `AnalyticsWidgetFunctionName`, `HomepageCheckFunctionName`, and
`HomepageCheckScheduleName` stack outputs when inspecting the functions:

```sh
aws cloudwatch get-dashboard \
  --dashboard-name salih-dev-operations \
  --region us-east-1
aws lambda get-function-configuration \
  --function-name <homepage-check-function-name> \
  --region us-east-1
aws events describe-rule \
  --name <homepage-check-schedule-name> \
  --region us-east-1
aws cloudwatch describe-alarms \
  --alarm-name-prefix SalihDevDelivery \
  --region us-east-1
```

Manually rerun the DEV import (it writes `posts/` and `images/` to the content
bucket and invalidates the blog routes, with no site build). The project has a
generated name, so look it up first:

```sh
aws codebuild list-projects --query "projects[?contains(@, 'DevImporter')]"
aws codebuild start-build --project-name <dev-importer-project-name>
```

Rerun the publisher with `PublisherProjectName` only for a code or design
change. Inspect the scheduler DLQ and `/aws/codebuild/salih-dev-dev-importer`
when the import alarm fires, and `/aws/codebuild/salih-dev-publisher` for a
failed publish.
Rollback site content by restoring a previous S3 object version or publishing
a previously verified source revision. Route 53 and retained buckets remain
protected; deleting a CDK stack does not delete retained content.

## 9. Manage location and events through the content API

> **Backend-served content.** The home page, the Talks archive, the blog index,
> posts, categories, tags, and the machine-readable listings (`rss.xml`,
> `sitemap.xml`, `llms.txt`, `llms-full.txt`), each with its Markdown alternate,
> are served at request time by a read-only render Lambda that is a second
> CloudFront origin (its Function URL is IAM-authed and fronted by Origin Access
> Control, so it is never public). It reads `site/content.v1.json`,
> `talks/records/`, and `posts/` from the content bucket and reuses the same
> pages and serializers the static build uses, so its output matches the baked
> pages. Slide PDFs (`/talks/slides/api/*`) and blog images (`/images/blog/*`)
> are served straight from the content bucket through CloudFront; the render
> Lambda never downloads a PDF.
>
> The three content write paths (`PUT /v1/content`, talk-upload completion, and
> talk removal) store their object and issue a scoped CloudFront invalidation,
> so the change is live within seconds. The daily `DevImporter` CodeBuild
> project imports dev.to posts into `posts/` and `images/` and invalidates the
> blog routes, also without a site build. The publisher is now only for code and
> design changes; start it manually.
>
> While the `renderFromBackend` rollout is in place (section 11), the render
> Lambda serves the baked page from the site bucket to every visitor the flag
> is off for, and the write paths and the `DevImporter` also start the
> publisher so those baked pages stay current. Write responses then include a
> `buildId` next to the `invalidationId`.
>
> `site/content.v1.json` must exist before this is deployed. If it is missing,
> a flag-on request falls back to the baked page and logs `on_path_fallback`,
> which trips the `RenderFailures` alarm. Once the flag is removed, every
> dynamic route returns an uncached 502 instead of falling back to repo
> content.


The content API accepts SigV4 requests only from:

```text
arn:aws:iam::018525129316:root
```

This root-only model was explicitly chosen for the personal account. Keep root
MFA enabled, use short-lived `aws login` credentials, and never create a root
access key. Authenticate and verify the exact caller before editing content:

```sh
aws login --profile personal
aws sts get-caller-identity --profile personal
```

The caller ARN must be `arn:aws:iam::018525129316:root`. Export the temporary
session into the current shell for curl signing:

```sh
eval "$(aws configure export-credentials \
  --profile personal \
  --format env)"
```

Read `ContentApiUrl` from the `SalihDevDelivery` outputs and set it without a
trailing slash:

```sh
export SITE_CONTENT_API="<ContentApiUrl>"
```

Initialize the retained content object once. Before initialization, an authorized
GET returns HTTP 404 with `content_not_initialized`; this confirms authorization
worked and the object is absent. Use `If-None-Match: *` for the first write rather
than an ETag update. The conditional header prevents accidentally replacing an
object that already exists:

```sh
curl --fail-with-body \
  --request PUT \
  --aws-sigv4 "aws:amz:us-east-1:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --header "x-amz-security-token: $AWS_SESSION_TOKEN" \
  --header "Content-Type: application/json" \
  --header "If-None-Match: *" \
  --data-binary @src/config/site-content.default.json \
  "$SITE_CONTENT_API/v1/content"
```

For later edits, download both the content and its ETag:

```sh
mkdir -p .cache
curl --fail-with-body \
  --aws-sigv4 "aws:amz:us-east-1:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --header "x-amz-security-token: $AWS_SESSION_TOKEN" \
  --dump-header .cache/site-content.headers \
  --output .cache/site-content.json \
  "$SITE_CONTENT_API/v1/content"

ETAG="$(awk 'tolower($1) == "etag:" { print $2 }' \
  .cache/site-content.headers | tr -d '\r')"
```

Edit `.cache/site-content.json`, then conditionally publish it. A stale ETag
returns HTTP 412 instead of overwriting a newer update:

```sh
curl --fail-with-body \
  --request PUT \
  --aws-sigv4 "aws:amz:us-east-1:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --header "x-amz-security-token: $AWS_SESSION_TOKEN" \
  --header "Content-Type: application/json" \
  --header "If-Match: $ETAG" \
  --data-binary @.cache/site-content.json \
  "$SITE_CONTENT_API/v1/content"
```

A successful PUT returns HTTP 202 with the new S3 version and a CloudFront
invalidation ID (`status: published`). The location and events are served at
request time by the render origin, so the change is live within seconds without
a publisher build. Invalid content returns HTTP 400 before storage; unsigned
callers, other IAM identities, and mismatched caller ARNs receive HTTP 403.
Restore an earlier S3 version of `site/content.v1.json`; the next request
reflects it after the write's invalidation.

## 10. Manage API-authored talks

The talk capability has no public page, upload form, hosted login, or additional
editor identity. These four routes extend the same `AWS_IAM` HTTP API and exact
root-ARN allowlist used by `/v1/content`:

| Method and route                             | Purpose                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `POST /v1/talks/uploads`                     | Validate an optional talk record, stage the request, and issue one PDF upload grant |
| `POST /v1/talks/uploads/{deckId}/completion` | Validate the transferred PDF, store approved state, and invalidate the Talks routes  |
| `GET /v1/talks/records`                      | List API-authored records and their current ETag versions; never return deck bytes  |
| `DELETE /v1/talks/records/{recordKey}`       | Conditionally remove one API-authored record and its approved deck                  |

Use only the temporary Root_Editor credentials established with `aws login` in
section 9. Never create a root access key. Set `SITE_CONTENT_API` and export the
temporary credentials as shown there; all requests below must use `--aws-sigv4`,
the temporary access key and secret, and `x-amz-security-token`. Unsigned,
expired, or non-allowlisted requests are rejected before storage work.

### Start and transfer an upload

The start body is a closed JSON contract of at most 65,536 UTF-8 bytes. It may be
`{}` for a deck-only upload or contain `metadata` with the same validated fields
as a repository talk except `slides`, which is always code-derived. Caller
filenames, object keys, slide paths, `slides`, and other unknown members are
rejected. A complete example is:

```json
{
  "metadata": {
    "title": "Building agent-ready static websites",
    "eventName": "Example Conference",
    "date": "2026-06-18",
    "location": "Berlin, Germany",
    "eventUrl": "https://conference.example/talks/agent-ready",
    "eventTypes": ["Conference"],
    "tags": ["Serverless", "Developer Experience"],
    "videoUrl": "https://www.youtube.com/watch?v=abcdefghijk",
    "sourceCodeUrl": "https://github.com/example/agent-ready-talk",
    "draft": false
  }
}
```

Save the response so the generated identifiers and upload form fields remain
paired with this request:

```sh
curl --fail-with-body \
  --request POST \
  --aws-sigv4 "aws:amz:us-east-1:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --header "x-amz-security-token: $AWS_SESSION_TOKEN" \
  --header "Content-Type: application/json" \
  --data-binary @talk-upload.json \
  --output .cache/talk-upload-grant.json \
  "$SITE_CONTENT_API/v1/talks/uploads"
```

A successful `201` contains `deckId`, the pending `storageKey`, the approved
storage key, the derived `/talks/slides/api/<deckId>.pdf` path, `expiresAt`, and
`upload.url` plus `upload.fields`; metadata uploads also contain `recordKey`.
Submit the PDF directly to `upload.url` as a multipart form using every returned
field unchanged, then append a multipart `file` part. The policy permits exactly
one code-derived pending key, requires `Content-Type: application/pdf`, accepts
1 through 26,214,400 bytes inclusive, and expires no later than 900 seconds
after issue. It grants no read, list, or delete access.

Build the multipart arguments from the returned field object and use every
field unchanged:

```sh
UPLOAD_URL="$(jq -r .upload.url .cache/talk-upload-grant.json)"
UPLOAD_ARGS=()
while IFS= read -r field; do
  UPLOAD_ARGS+=(--form "$field")
done < <(jq -r '.upload.fields | to_entries[] | "\(.key)=\(.value)"' \
  .cache/talk-upload-grant.json)

curl --fail-with-body \
  "${UPLOAD_ARGS[@]}" \
  --form 'file=@slides.pdf;type=application/pdf' \
  "$UPLOAD_URL"
```

Do not invent, remove, or change a returned field.

### Complete and publish

After S3 accepts the form, call completion with no body:

```sh
DECK_ID="$(jq -r .deckId .cache/talk-upload-grant.json)"
curl --fail-with-body \
  --request POST \
  --aws-sigv4 "aws:amz:us-east-1:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --header "x-amz-security-token: $AWS_SESSION_TOKEN" \
  "$SITE_CONTENT_API/v1/talks/uploads/$DECK_ID/completion"
```

Completion re-reads the pending object and requires its recorded media type and
size to match, the `%PDF-` signature to be present, every page to parse with the
strict pinned parser without a password, and the page count to be positive.
Only then does it copy the approved deck, conditionally store the API record,
remove pending state, and issue exactly one scoped CloudFront invalidation of
the Talks routes. A successful `202` returns `status: published`, validated
byte/page counts, `invalidationId`, and, for a metadata upload, `recordKey`,
`recordVersion`, and the same ETag in the response header. The Talks archive is
served at request time by the render origin, so the change is live within
seconds without a publisher build.

Treat errors according to state:

- `404 pending_deck_not_found`: the transfer is absent or expired; start a new
  upload rather than retrying completion.
- `422 deck_validation_failed`: the response names the failed PDF criterion; no
  approved record is written. Correct the PDF and start a new upload.
- `409 talk_identity_conflict`, `412 record_changed`, or `428
precondition_required`: refresh the record list and restart with the current
  precondition; rejected requests do not overwrite the current record.
- `500`: an unexpected parser, storage, or cleanup failure is fail-closed.
  Inspect the one-month Lambda logs and refresh the record list to establish
  durable state. If the intended record is absent, retry completion with the
  same `deckId`; pending state is retained on validation/store failure and the
  conditional record write prevents replacing a newer version. If the record is
  present or retry returns `pending_deck_not_found`, do not start another upload
  blindly—publication or cleanup may be the only remaining operation.
- `503 invalidation_not_started`: the response identifies state that was already
  stored. Do not repeat completion. Clear the Talks routes by hand with
  `aws cloudfront create-invalidation --distribution-id <DistributionId> --paths
"/talks/" "/talks/index.md" "/sitemap.xml" "/llms.txt" "/llms-full.txt"`, or
  wait up to five minutes for the cached pages to expire.

The render origin validates every API record on each request with the same
validators the build uses. During the flag rollout, a stored record that fails
validation makes a flag-on Talks request fall back to the baked page and trips
the `RenderFailures` alarm (section 11). Once the flag is removed, it makes the
Talks routes return an uncached 502 while CloudFront keeps serving the last good
page for up to 24 hours. Fix it through a conditional replacement or removal;
do not bypass or weaken validation.

### Replace or remove a record

List records immediately before a mutation and use the returned strong ETag from
`recordVersion` (also exposed as `etag`):

```sh
curl --fail-with-body \
  --aws-sigv4 "aws:amz:us-east-1:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --header "x-amz-security-token: $AWS_SESSION_TOKEN" \
  --output .cache/talk-records.json \
  "$SITE_CONTENT_API/v1/talks/records"
```

To replace a deck and optionally its metadata, start a new upload with
`replaces.recordKey` and the exact quoted `replaces.version`. Omitting `metadata`
preserves the current validated metadata and associates it with the new deck.
Supplying metadata may not change the canonical identity derived from date and
title. Missing, malformed, or stale versions return `428`, `400`, or `412`; an
absent target returns `404`. On success, complete the new deck normally and keep
the new ETag returned by completion.

To remove an API-authored record, send both its current ETag and explicit intent:

```sh
RECORD_KEY="<recordKey>"
RECORD_ETAG='"<etag>"'
curl --fail-with-body \
  --request DELETE \
  --aws-sigv4 "aws:amz:us-east-1:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --header "x-amz-security-token: $AWS_SESSION_TOKEN" \
  --header "If-Match: $RECORD_ETAG" \
  --header "x-talk-removal: confirmed" \
  "$SITE_CONTENT_API/v1/talks/records/$RECORD_KEY"
```

Removal deletes the current API record and its associated approved deck, then
issues one scoped CloudFront invalidation of the Talks routes; an already-absent
deck is tolerated. Missing intent or
precondition returns `428`, a malformed value returns `400`, a stale ETag
returns `412`, and a missing record returns `404`. Repository-authored talks
cannot be removed through this API and return `409 repository_authored_talk`.
When repository and API records conflict by canonical identity or slide path,
the build fails with both sources named; the repository record is authoritative,
so remove the API record rather than changing repository content through the
API.

### Storage, publication, and logs

Approved API records and decks live under `talks/records/` and `talks/decks/` in
the existing private, TLS-only, SSE-S3 encrypted, versioned, retained content
bucket. Abandoned staged requests and deck bytes under `talks/pending/` expire
after one day. The render origin reads `talks/records/` and the key-only
`talks/decks/` listing on each request and never downloads a deck; visitors get
decks straight from `talks/decks/` at `/talks/slides/api/<deckId>.pdf`. Records
without an available approved deck and unreferenced decks do not enter the
snapshot.

The static build still materializes talks for the baked pages. The publisher
synchronizes records and decks into separate local caches with deletion
enabled, then `npm run materialize:talks` clears and recreates only
`src/content/talks/api/` and `public/talks/slides/api/`. The caches and retained
store are read-only to materialization, while Git-authored records and tracked
slides remain unchanged. The publisher then runs DEV import, tests, Astro/type
checks, the static build, and strict build verification. Only a successful gate
may sync `dist/` to the website bucket and invalidate CloudFront.

Authorization, deck-validation, and store-change logs are retained for one
month and contain only their action-specific request ID, caller authorization,
derived storage key, byte/page facts, stored version, and invalidation ID
fields. They
exclude request/PDF/rendered content, IP and forwarded IP, cookies, query
strings, user agents, referrers, and browser or device identifiers.

Creating or updating this infrastructure is billable and requires separate
explicit approval. Local implementation and validation must not deploy or diff
CDK, invoke the production content API, transfer/delete S3 objects, start
CodeBuild, or change DNS or nameservers.

## 11. Roll out request-time rendering with the `renderFromBackend` flag

Request-time rendering ships behind an AppConfig feature flag. The CDK stack
creates the AppConfig application `salih-dev`, the environment `production`, the
feature-flag profile `render-flags` and the deployment strategy
`salih-dev-render-rollout`, and deploys the flag as off. With the flag off, the
render Lambda serves the page the publisher baked into the site bucket, so a
deploy changes nothing a visitor can see.

The render Lambda reads the flag from the AppConfig Agent extension on
`localhost:2772`, sending the visitor's `vid` cookie as `Context: vid=<id>`. A
read that fails, returns a non-200 status or takes longer than 300 ms counts as
off. Every render response carries `x-render-path: lambda` (rendered on request)
or `x-render-path: static` (baked page).

Turning the flag on, targeting it and raising the percentage are flag
deployments, not CDK deploys. The CDK stack only holds the default-off flag
content. Do not change that content in CDK during the rollout: a changed inline
flag deploys over whatever you set by hand.

### Check the deploy

After the CDK deploy, every dynamic route must report the baked page:

```sh
curl -sI https://salih.dev/ | grep -i -E 'x-render-path|set-cookie'
curl -sI https://salih.dev/talks/ | grep -i x-render-path
curl -sI https://salih.dev/blog/ | grep -i x-render-path
```

Each prints `x-render-path: static`. The first response without a cookie also
sets `vid=<uuid>; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax`.
Copy your own `vid` from the browser's cookie storage for the next step.

### Look up the AppConfig ids

The CLI takes ids, not names:

```sh
APP_ID=$(aws appconfig list-applications --profile personal \
  --query "Items[?Name=='salih-dev'].Id" --output text)
ENV_ID=$(aws appconfig list-environments --profile personal \
  --application-id "$APP_ID" --query "Items[?Name=='production'].Id" --output text)
PROFILE_ID=$(aws appconfig list-configuration-profiles --profile personal \
  --application-id "$APP_ID" --query "Items[?Name=='render-flags'].Id" --output text)
STRATEGY_ID=$(aws appconfig list-deployment-strategies --profile personal \
  --query "Items[?Name=='salih-dev-render-rollout'].Id" --output text)
```

### Turn the flag on for one visitor

Write the flag as a multi-variant flag. Variants are evaluated in order and the
first rule that matches wins; the variant without a rule is the default. Save
this as `.cache/render-flags.json` with your own `vid`:

```json
{
  "version": "1",
  "flags": {
    "renderFromBackend": {
      "name": "renderFromBackend",
      "description": "Serve the dynamic routes from the render Lambda (on) or the baked static pages (off)."
    }
  },
  "values": {
    "renderFromBackend": {
      "_variants": [
        { "name": "author", "enabled": true, "rule": "(in $vid [\"<your-vid>\"])" },
        { "name": "default", "enabled": false }
      ]
    }
  }
}
```

Create a version and deploy it:

```sh
VERSION=$(aws appconfig create-hosted-configuration-version --profile personal \
  --application-id "$APP_ID" --configuration-profile-id "$PROFILE_ID" \
  --content-type application/json --content file://.cache/render-flags.json \
  --cli-binary-format raw-in-base64-out --query VersionNumber --output text \
  .cache/render-flags-returned.json)
aws appconfig start-deployment --profile personal \
  --application-id "$APP_ID" --environment-id "$ENV_ID" \
  --configuration-profile-id "$PROFILE_ID" --configuration-version "$VERSION" \
  --deployment-strategy-id "$STRATEGY_ID"
```

The strategy is linear: 25% of targets at a time over 20 minutes, then a
10-minute final bake. After the deployment completes, your browser gets
`x-render-path: lambda` and a request with any other `vid` still gets `static`:

```sh
curl -sI -H 'Cookie: vid=<your-vid>' https://salih.dev/talks/ | grep -i x-render-path
curl -sI -H 'Cookie: vid=00000000-0000-4000-8000-000000000000' https://salih.dev/talks/ | grep -i x-render-path
```

The render Lambda does not send an `Entity-Id` header, so AppConfig spreads a
deployment across Lambda execution environments rather than across visitors.
While a deployment is in progress, one visitor can get the old flag from one
execution environment and the new flag from another. Once it completes, every
environment agrees and the `split` hash keeps each visitor on one side.

### Raise the percentage

Add a `split` variant under the `author` variant and deploy it the same way,
changing only `pct` for each step (10, then 50, then 100):

```json
{ "name": "rollout", "enabled": true, "rule": "(split by::$vid pct::10)" }
```

`split` hashes the `vid`, so a visitor who gets the new path keeps it as the
percentage goes up. Wait for each deployment to complete, and watch the three
alarms and the `x-render-path` mix, before the next step.

### Rollback

Three CloudWatch alarms are AppConfig monitors on the `production` environment:

| Alarm | Fires on |
| --- | --- |
| Render errors | at least one Lambda `Errors` in a minute |
| Render latency | p95 duration of 5 seconds or more for three minutes |
| Render failures | at least one handled render failure in a minute |

The last one comes from a metric filter on the render log group that counts the
`on_path_fallback`, `render_error`, `middleware_error` and `load_error`
outcomes. A flag-on request whose content read, validation or render fails with
a 5xx is served the baked page and logs `on_path_fallback`, so the visitor gets
a 200 and the Lambda `Errors` metric never sees it.

If an alarm fires during a deployment or its final bake, AppConfig rolls the
flag back to the previous version on its own. It does not watch the alarms
after the bake ends. To roll back by hand:

```sh
# During a deployment: rolls back (state ROLLED_BACK).
aws appconfig stop-deployment --profile personal \
  --application-id "$APP_ID" --environment-id "$ENV_ID" --deployment-number <n>

# After a deployment completed, within 72 hours: reverts (state REVERTED).
aws appconfig stop-deployment --profile personal \
  --application-id "$APP_ID" --environment-id "$ENV_ID" --deployment-number <n> \
  --allow-revert
```

After 72 hours, deploy a version with every variant disabled. Use the
predefined `AppConfig.AllAtOnce` strategy for that deployment to switch
everyone off at once.

A render Lambda that fails to start at all is the one failure this does not
cover, because the baked-page fallback runs inside the same function. The flag
does not help there; roll back the CDK deploy.

### While the rollout is active

`RENDER_ROLLOUT_ACTIVE=1` is set on the render Lambda, the three content write
functions (through `rolloutActive: true` on `ContentApi`) and the
`DevImporter`. It does two things:

- Render responses send `Cache-Control: private, no-store`, and the render
  behavior uses a cache policy with a zero default TTL, so CloudFront asks the
  Lambda on every request and the flag is evaluated per visitor.
- Content writes and the daily import also start the publisher, so the baked
  pages the off path serves stay current. The write responses then include a
  `buildId`. A failed publisher start never fails the write.

With caching off, `stale-if-error` has nothing to serve during an outage. The
baked-page fallback and the rollback alarms cover that window.

### Remove the flag at 100%

Once the flag has been at 100% with no alarm for a few days, remove it in a
code change:

1. Delete the flag read and the off path from `src/middleware.ts` (`getRenderFlag`,
   `serveOffPath`) and the off-path modules and tests.
2. Drop `RENDER_ROLLOUT_ACTIVE` from the render Lambda and the `DevImporter`
   in `infra/lib/delivery-stack.ts`, and pass `rolloutActive: false` to
   `ContentApi`. That restores `DYNAMIC_CACHE_CONTROL` (`s-maxage=300`,
   `stale-if-error=86400`), stops the rollout-time publisher builds, and drops
   the write functions' `codebuild:StartBuild` grant.
3. Put the render behavior back on the original render cache policy, remove the
   site-bucket read grant for baked pages, and remove the AppConfig Agent layer
   and IAM from the render Lambda.
4. Keep the `vid` cookie and the AppConfig application if the homepage A/B test
   will use them; otherwise remove them too.

A missing `site/content.v1.json` or an S3 read failure then returns an uncached
502 again, and CloudFront serves the last good page through `stale-if-error`.
