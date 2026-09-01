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
