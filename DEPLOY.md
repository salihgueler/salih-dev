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

Manually rerun synchronization:

```sh
aws codebuild start-build --project-name <publisher-project-name>
```

Inspect the scheduler DLQ and CodeBuild logs when a publication alarm fires.
Rollback site content by restoring a previous S3 object version or publishing
a previously verified source revision. Route 53 and retained buckets remain
protected; deleting a CDK stack does not delete retained content.

## 9. Manage location and events through the content API

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

A successful PUT returns HTTP 202 with the new S3 version and CodeBuild build
ID. Invalid content returns HTTP 400 before storage; unsigned callers, other IAM
identities, and mismatched caller ARNs receive HTTP 403. Restore an earlier S3
version of `site/content.v1.json` and publish again to roll back.

## 10. Manage API-authored talks

The talk capability has no public page, upload form, hosted login, or additional
editor identity. These four routes extend the same `AWS_IAM` HTTP API and exact
root-ARN allowlist used by `/v1/content`:

| Method and route                             | Purpose                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `POST /v1/talks/uploads`                     | Validate an optional talk record, stage the request, and issue one PDF upload grant |
| `POST /v1/talks/uploads/{deckId}/completion` | Validate the transferred PDF, store approved state, and start publication           |
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
remove pending state, and start exactly one publisher build. A successful `202`
returns `status: publishing`, validated byte/page counts, `buildId`, and, for a
metadata upload, `recordKey`, `recordVersion`, and the same ETag in the response
header.

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
- `503 publication_not_started`: the response identifies state that was already
  stored. Do not repeat completion. Start the publisher manually with the
  returned/stored identifiers, or allow the next scheduled publication to use
  that state.

A publisher validation failure leaves the stored API record unchanged and the
previously published site live. Fix it through a conditional replacement or
removal, then publish again; do not bypass or weaken validation.

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
starts exactly one build; an already-absent deck is tolerated. Missing intent or
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
after one day. The publisher synchronizes records and decks into separate local
caches with deletion enabled, then `npm run materialize:talks` clears and
recreates only `src/content/talks/api/` and `public/talks/slides/api/`. Records
without an available approved deck and unreferenced decks do not enter the
snapshot. The caches and retained store are read-only to materialization, while
Git-authored records and tracked slides remain unchanged.

After materialization the publisher runs DEV import, tests, Astro/type checks,
the static build, and strict build verification. Only a successful gate may sync
`dist/` to the website bucket and invalidate CloudFront. The Talks HTML,
Markdown alternate, sitemap, and LLM indexes continue to come from one validated
snapshot.

Authorization, deck-validation, and store-change logs are retained for one
month and contain only their action-specific request ID, caller authorization,
derived storage key, byte/page facts, stored version, and build ID fields. They
exclude request/PDF/rendered content, IP and forwarded IP, cookies, query
strings, user agents, referrers, and browser or device identifiers.

Creating or updating this infrastructure is billable and requires separate
explicit approval. Local implementation and validation must not deploy or diff
CDK, invoke the production content API, transfer/delete S3 objects, start
CodeBuild, or change DNS or nameservers.
