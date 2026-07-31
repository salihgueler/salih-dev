# Deploy salih.dev to AWS

Deployment creates billable AWS resources and changes DNS only when the
corresponding phase is explicitly approved.

## 1. Verify locally

```sh
npm ci
npm test
npm run check
npm run build

cd infra
npm ci
npm run build
npm test
npm run synth
```

## 2. Authenticate and bootstrap

Use `us-east-1` because CloudFront requires its ACM certificate there.

```sh
aws sts get-caller-identity
export CDK_DEFAULT_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

cd infra
npx cdk bootstrap "aws://${CDK_DEFAULT_ACCOUNT}/${CDK_DEFAULT_REGION}"
```

Run `npx cdk diff --strict` before every deployment.

## 3. Deploy retained state

```sh
cd infra
npx cdk diff SalihDevState --strict
npx cdk deploy SalihDevState --strict
```

Record `HostedZoneNameServers`, `HostedZoneId`, and `ContentBucketName`.
Do not change Squarespace nameservers yet.

## 4. Deploy delivery without DNS downtime

Start the delivery deployment:

```sh
cd infra
npx cdk diff SalihDevDelivery --strict
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

## 8. Operations

Manually rerun synchronization:

```sh
aws codebuild start-build --project-name <publisher-project-name>
```

Inspect the scheduler DLQ and CodeBuild logs when an alarm fires. Subscribe an
email endpoint to `BuildAlarmTopicArn` and confirm the subscription.

Rollback site content by restoring a previous S3 object version or publishing
a previously verified source revision. Route 53 and both buckets have retention
protection; deleting a CDK stack does not delete retained content.
