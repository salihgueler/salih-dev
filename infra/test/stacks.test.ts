import assert from "node:assert/strict";
import test from "node:test";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { SalihDevDeliveryStack } from "../lib/delivery-stack";
import { SalihDevStateStack } from "../lib/state-stack";

function createStacks() {
  const app = new App();
  const env = { account: "111111111111", region: "us-east-1" };
  const state = new SalihDevStateStack(app, "State", {
    domainName: "salih.dev",
    env,
  });
  const delivery = new SalihDevDeliveryStack(app, "Delivery", {
    contentBucket: state.contentBucket,
    domainName: "salih.dev",
    env,
    hostedZone: state.hostedZone,
  });
  return {
    state: Template.fromStack(state),
    delivery: Template.fromStack(delivery),
  };
}

test("creates retained private versioned storage", () => {
  const { state } = createStacks();

  state.resourceCountIs("AWS::S3::Bucket", 1);
  state.allResourcesProperties("AWS::S3::Bucket", {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: "AES256",
          },
        },
      ],
    },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    VersioningConfiguration: {
      Status: "Enabled",
    },
  });
});

test("creates static delivery and daily publishing resources", () => {
  const { delivery } = createStacks();

  delivery.resourceCountIs("AWS::CloudFront::Distribution", 1);
  delivery.resourceCountIs("AWS::CloudFront::Function", 2);
  delivery.resourceCountIs("AWS::CodeBuild::Project", 1);
  delivery.resourceCountIs("AWS::Scheduler::Schedule", 1);
  delivery.resourceCountIs("AWS::SQS::Queue", 1);
  delivery.hasResourceProperties("AWS::Scheduler::Schedule", {
    ScheduleExpression: "cron(15 3 * * ? *)",
    FlexibleTimeWindow: {
      Mode: "OFF",
    },
    Target: Match.objectLike({
      RetryPolicy: {
        MaximumEventAgeInSeconds: 3600,
        MaximumRetryAttempts: 2,
      },
    }),
  });
});

test("uses a private S3 origin and TLS domain aliases", () => {
  const { delivery } = createStacks();

  delivery.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      Aliases: ["salih.dev", "www.salih.dev"],
      Enabled: true,
      HttpVersion: "http2and3",
      IPV6Enabled: true,
      ViewerCertificate: Match.objectLike({
        MinimumProtocolVersion: "TLSv1.2_2021",
        SslSupportMethod: "sni-only",
      }),
    }),
  });
});

test("includes agent-friendly edge behavior", () => {
  const { delivery } = createStacks();
  const functions = delivery.findResources("AWS::CloudFront::Function");
  const joinedCode = Object.values(functions)
    .map((resource) => JSON.stringify(resource.Properties.FunctionCode))
    .join("\n");

  assert.match(joinedCode, /text\/markdown/);
  assert.match(joinedCode, /Content-Signal|canonical/);
  assert.match(joinedCode, /api\/catalog\.json/);
  delivery.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
    ResponseHeadersPolicyConfig: Match.objectLike({
      CustomHeadersConfig: {
        Items: [
          {
            Header: "Content-Signal",
            Override: true,
            Value: "search=yes, ai-input=yes, ai-train=no",
          },
        ],
      },
    }),
  });
});

test("adds privacy-first analytics and low-cost monitoring", () => {
  const { delivery } = createStacks();

  // Analytics: one privacy-filtered CloudFront log delivery + catalog + queries.
  delivery.resourceCountIs("AWS::Logs::Delivery", 1);
  delivery.resourceCountIs("AWS::Glue::Database", 1);
  delivery.resourceCountIs("AWS::Glue::Table", 1);
  delivery.resourceCountIs("AWS::Athena::WorkGroup", 1);
  delivery.resourceCountIs("AWS::Athena::NamedQuery", 3);

  // Monitoring: scheduled homepage checker, operations dashboard, no canary.
  delivery.resourceCountIs("AWS::Lambda::Function", 1);
  delivery.resourceCountIs("AWS::Events::Rule", 1);
  delivery.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
  delivery.resourceCountIs("AWS::Synthetics::Canary", 0);

  // Build failure alarm plus CloudFront 4xx/5xx and two homepage-check alarms.
  delivery.resourceCountIs("AWS::CloudWatch::Alarm", 5);

  // Selected log fields must exclude visitor identifiers.
  const deliveries = delivery.findResources("AWS::Logs::Delivery");
  const fields = Object.values(deliveries)[0].Properties.RecordFields as string[];
  for (const forbidden of [
    "c-ip",
    "cs(Cookie)",
    "cs-uri-query",
    "cs(User-Agent)",
    "cs(Referer)",
    "x-forwarded-for",
  ]) {
    assert.ok(!fields.includes(forbidden), `must not log ${forbidden}`);
  }
});
