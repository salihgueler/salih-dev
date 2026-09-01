# AWS migration plan

## Architecture decision

The site is deployed as a static Astro build because its pages are public,
content changes at most daily, and no request-specific rendering is required.
This avoids a permanently running server, container hosting, Lambda cold starts,
and runtime Markdown processing.

The architecture uses:

- Amazon S3 for a private website origin.
- Amazon CloudFront with origin access control for HTTPS delivery.
- CloudFront Functions for clean URLs, the `www` redirect, and Markdown content
  negotiation.
- AWS Certificate Manager for the `salih.dev` and `www.salih.dev` certificate.
- Amazon Route 53 for authoritative DNS. Squarespace remains the registrar.
- A separate, private, versioned S3 bucket for normalized content, copied
  banners, and synchronization state.
- AWS CodeBuild with Lambda compute for synchronization and static builds.
- Amazon EventBridge Scheduler for the daily trigger.
- Amazon SQS as the scheduler dead-letter queue.
- CloudWatch and Amazon SNS for build, availability, and error-rate alarms,
  plus an operations dashboard.
- EventBridge and an arm64 Lambda function for a 15-minute homepage HTTP status
  and title check without a browser runtime.
- A read-only arm64 Lambda powering three CloudWatch custom widgets for top
  content, daily traffic/errors, and edge p95. The widgets reuse eligible Athena
  results for one hour and have no public endpoint.
- CloudFront standard logging v2 to a dedicated encrypted S3 bucket with a
  90-day lifecycle, a Glue table, an Athena workgroup, and saved queries. The
  selected fields omit IP addresses, cookies, query strings, user agents, and
  full referrers.

This design has no container or server in the website serving path. CodeBuild
uses short-lived AWS Lambda compute for build automation.

## Daily DEV synchronization

**Trigger:** EventBridge Scheduler invokes CodeBuild `StartBuild` every day at
03:15 UTC. Scheduler uses at-least-once delivery, retries twice for up to one
hour, and sends undeliverable events to an encrypted SQS dead-letter queue.

**Fetch logic:** The build downloads the versioned synchronization manifest,
normalized Markdown, and existing banners from the private content bucket. The
sync script lists published posts through
`https://dev.to/api/articles?username=salihgueler`. It compares each article ID
and edit timestamp with the manifest, fetches details only for new or changed
posts, and removes only previously synchronized DEV posts that are no longer
published. Known posts retain their reviewed category and summary. New posts
use the DEV description and deterministic tag-to-category rules.

**Banner handling:** For each new or changed article, the script downloads
`cover_image` or `social_image`, validates its image content type and 20 MB size
limit, and writes it under `images/blog/<article-id>-<slug>.<extension>`.
Generated frontmatter uses `https://salih.dev/images/blog/...`, so banners have
no runtime dependency on DEV.

**Storage:**

- `s3://<content-bucket>/posts/`: normalized Markdown source.
- `s3://<content-bucket>/images/`: durable banner copies.
- `s3://<content-bucket>/state/dev-sync-manifest.json`: article IDs, edit
  versions, slugs, and banner filenames.
- `s3://<site-bucket>/`: generated HTML, Markdown representations, discovery
  documents, CSS, and public banner copies.

After synchronization, CodeBuild runs tests and Astro diagnostics, builds the
site, updates the website bucket, and invalidates CloudFront. Publication is
skipped if any validation or build command fails.

## Migration sequence

### Phase 1: Application preparation

1. Convert Astro from standalone Node SSR to static output.
2. Add build-time paths for posts, categories, tags, Markdown routes, and
   capability documents.
3. Keep local development middleware while moving production negotiation and
   headers to CloudFront Functions.
4. Replace the one-shot DEV importer with the manifest-based synchronization.
5. Add unit tests and verify the complete static build without warnings.

### Phase 2: AWS foundation

6. Authenticate the `personal` AWS CLI profile and verify its account ID in
   `us-east-1`; stop if it is not the intended personal account.
7. Bootstrap that account and Region for AWS CDK if `CDKToolkit` is absent or
   below the required bootstrap version.
8. Deploy `SalihDevState` to create the retained content bucket and Route 53
   hosted zone.
9. Record the four Route 53 nameservers but do not change Squarespace yet.
10. Inventory every current Squarespace DNS record, including MX, TXT, CAA,
    DKIM, verification, subdomain, and email records.

### Phase 3: Delivery infrastructure

11. Start the `SalihDevDelivery` deployment while Squarespace DNS is still
    authoritative.
12. Read the pending ACM certificate's DNS validation CNAME and add it to
    Squarespace DNS. The same record is already created in the new Route 53
    zone.
13. Allow the deployment to finish creating CloudFront, OAC, the website
    bucket, DNS aliases, scheduler, publisher, DLQ, and alarms.
14. Start the first CodeBuild publication manually.
15. Verify the CloudFront distribution before changing nameservers.

### Phase 4: Domain cutover

16. Recreate all existing non-web DNS records in Route 53. Do not replace the
    CDK-managed apex and `www` A/AAAA aliases.
17. Compare Squarespace and Route 53 records line by line.
18. At Squarespace Domains, replace only the authoritative nameservers with
    the four Route 53 nameservers. Keep the registration at Squarespace.
19. Verify Route 53 delegation, ACM, apex HTTPS, IPv4/IPv6 aliases, the `www`
    redirect, email records, and external verification records.
20. Keep the previous hosting configuration available until DNS caches expire.

### Phase 5: Acceptance and operations

21. Verify HTML, RSS, sitemap, tags, categories, and banner URLs.
22. Run the agent-readiness checks below against `https://salih.dev`.
23. Subscribe an email address to the SNS build-alarm topic.
24. Confirm the next scheduled daily build succeeds.
25. Document the CloudFront distribution ID, project name, bucket names, hosted
    zone ID, and rollback owner.

## Agent-readiness acceptance criteria

The migration is incomplete until all of these pass against CloudFront and
again after domain cutover:

1. Canonical HTML pages return successfully.
2. `Accept: text/markdown` returns the same representation as the companion
   `.md` URL.
3. Negotiated responses use separate cache objects and include `Vary: Accept`.
4. HTML and Markdown responses advertise canonical, alternate, and service
   description `Link` headers.
5. Responses include
   `Content-Signal: search=yes, ai-input=yes, ai-train=no`.
6. `/llms.txt`, `/llms-full.txt`, `/api/catalog.json`,
   `/api/openapi.json`, `/.well-known/agent-readiness.json`, RSS, sitemap,
   robots, WebMCP, MCP status, and the public skill remain available.
7. Post structured data and canonical URLs use `https://salih.dev`.

The checks and commands are listed in `DEPLOY.md`.

## Estimated monthly cost

Assumptions: 100,000 viewer requests, 10 GB transfer, 2 GB combined S3
storage, and 31 daily builds of no more than 180 seconds on Lambda x86 1 GB
compute. Prices are estimates for `us-east-1` as of August 2026 and exclude tax.

| Service | Likely with ongoing allowances | Conservative paid usage |
| --- | ---: | ---: |
| Route 53 hosted zone | $0.50 | $0.50 |
| Route 53 alias queries to CloudFront | $0.00 | $0.00 |
| CloudFront transfer and requests | $0.00 | about $0.95 |
| S3 storage and requests, including 90-day analytics retention | about $0.08 | about $0.08 |
| CodeBuild Lambda compute, 5,580 seconds | $0.00 | about $0.06 |
| EventBridge schedules and rules | $0.00 | less than $0.01 |
| SQS dead-letter queue | $0.00 | less than $0.01 |
| ACM public certificate | $0.00 | $0.00 |
| CloudWatch logs, dashboard, alarms, and SNS | about $0.01 | about $3.50 |
| Scheduled arm64 Lambda homepage check | $0.00 | less than $0.01 |
| CloudFront standard logs v2, analytics widget Lambda, and reused Athena queries | less than $0.05 | less than $0.05 |
| **Estimated total** | **about $0.65/month** | **about $5.20/month** |

The likely estimate assumes this dashboard remains within CloudWatch's first
three free custom dashboards and the alarms remain within the first 10 free
alarm metrics. If those account-level allowances are already consumed, the
custom dashboard accounts for $3.00 of the conservative estimate and can be
removed without affecting alarms or SNS notifications.

CloudFront's pay-as-you-go free tier includes 1 TB of transfer and 10 million
requests each month. CodeBuild includes 6,000 Lambda 1 GB build seconds each
month. Route 53 does not charge for alias queries to CloudFront. The homepage
check's approximately 2,976 short arm64 Lambda invocations per month ordinarily
fit within Lambda and EventBridge ongoing allowances. A CloudFront Free flat-rate
plan may cover additional services, but it is not assumed by this infrastructure
or estimate.

Pricing references:

- <https://aws.amazon.com/cloudfront/pricing/>
- <https://aws.amazon.com/codebuild/pricing/>
- <https://aws.amazon.com/route53/pricing/>
- <https://aws.amazon.com/s3/pricing/>
- <https://aws.amazon.com/eventbridge/pricing/>
- <https://aws.amazon.com/lambda/pricing/>
- <https://aws.amazon.com/cloudwatch/pricing/>
- <https://aws.amazon.com/athena/pricing/>

## Operational tradeoffs

- CloudFront standard logging v2 stores only aggregate operational fields for
  90 days. It deliberately excludes IP addresses, cookies, query strings, user
  agents, and full referrers; no browser tracker, identifier, or client storage
  is used.
- The scheduled homepage checker validates HTTP status and the expected title
  every 15 minutes using a short arm64 Lambda invocation. This is appropriate
  for a static Astro site and avoids Synthetics browser-run, artifact, and custom
  metric charges, but it does not validate client-side rendering or capture
  screenshots.
- The analytics custom widgets run only when the AWS console dashboard loads or
  refreshes. They have no public endpoint, query only the privacy-filtered table,
  and request Athena result reuse for one hour; dashboard viewers need explicit
  `lambda:InvokeFunction` permission for the widget function.
- AWS WAF is not provisioned because the origin is private and the site has no
  dynamic request-processing backend.
- CodeBuild uses AWS-managed encryption instead of a customer-managed KMS key,
  avoiding an additional recurring key charge.
- The current `aws-cdk-lib@2.262.1` package bundles
  `brace-expansion@5.0.7`, which npm reports under
  `GHSA-mh99-v99m-4gvg`. This dependency is used only while synthesizing
  infrastructure and is not deployed to the site or publisher. Upgrade CDK
  when AWS releases a version with the patched bundled dependency.
