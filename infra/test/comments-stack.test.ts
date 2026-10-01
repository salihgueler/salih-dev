/**
 * Infrastructure tests for the comments feature: the table, the public
 * comments function and its route, the moderation routes, and the flag.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { APPCONFIG_AGENT_LAYER_ARN, SalihDevDeliveryStack } from "../lib/delivery-stack";
import { SalihDevStateStack } from "../lib/state-stack";

type Resource = { Properties: Record<string, unknown> };
type Statement = { Action: unknown; Resource?: unknown };

const templates = (() => {
  const app = new App();
  const env = { account: "111111111111", region: "us-east-1" };
  const state = new SalihDevStateStack(app, "State", { domainName: "salih.dev", env });
  const delivery = new SalihDevDeliveryStack(app, "Delivery", {
    contentBucket: state.contentBucket,
    domainName: "salih.dev",
    env,
    hostedZone: state.hostedZone,
    readerCountsTable: state.readerCountsTable,
    commentsTable: state.commentsTable,
  });
  return { state: Template.fromStack(state), delivery: Template.fromStack(delivery) };
})();

function functionWithEnv(name: string, extra?: (vars: Record<string, unknown>) => boolean): Resource {
  const fn = Object.values(templates.delivery.findResources("AWS::Lambda::Function")).find(
    (resource) => {
      const vars = (resource.Properties as { Environment?: { Variables?: Record<string, unknown> } })
        .Environment?.Variables;
      return vars !== undefined && name in vars && (extra?.(vars) ?? true);
    },
  );
  assert.ok(fn !== undefined, `a function with ${name}`);
  return fn as Resource;
}

/** DynamoDB statements on the comments table, per role policy. */
function commentStatements(): Array<{ policy: string; actions: unknown }> {
  return Object.entries(templates.delivery.findResources("AWS::IAM::Policy")).flatMap(
    ([logicalId, resource]) =>
      (resource.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument.Statement
        .filter(
          (s) =>
            JSON.stringify(s.Action).includes("dynamodb:") &&
            JSON.stringify(s.Resource).includes("Comments"),
        )
        .map((s) => ({ policy: logicalId, actions: s.Action })),
  );
}

test("the comments table is on-demand, retained, with TTL and point-in-time recovery", () => {
  templates.state.hasResource("AWS::DynamoDB::GlobalTable", {
    DeletionPolicy: "Retain",
    Properties: Match.objectLike({
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      Replicas: [
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      ],
    }),
  });
});

test("the public comments role can submit and list, never approve or delete", () => {
  const statements = commentStatements();
  const publicRole = statements.find((s) => s.policy.startsWith("CommentsFunction"));
  assert.ok(publicRole !== undefined);
  assert.deepEqual(publicRole.actions, ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]);
  const moderation = statements.find((s) => s.policy.startsWith("ContentApiCommentModeration"));
  assert.ok(moderation !== undefined);
  assert.deepEqual(moderation.actions, [
    "dynamodb:GetItem",
    "dynamodb:Query",
    "dynamodb:PutItem",
    "dynamodb:DeleteItem",
  ]);
  assert.equal(statements.length, 2, "no other role touches the comments table");
});

test("the comments function reads the flag through the pinned layer and can mail Salih", () => {
  const props = functionWithEnv("COMMENTS_TOPIC_ARN").Properties as {
    Layers: unknown[];
    Environment: { Variables: Record<string, unknown> };
  };
  assert.ok(props.Layers.includes(APPCONFIG_AGENT_LAYER_ARN));
  assert.equal(props.Environment.Variables.APPCONFIG_PROFILE, "render-flags");
  templates.delivery.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([Match.objectLike({ Action: "sns:Publish" })]),
    }),
  });
});

test("moderation is editor-only on the IAM content API, and not behind the flag", () => {
  const vars = functionWithEnv("COMMENTS_TABLE_NAME", (v) => "CONTENT_ALLOWED_CALLER_ARNS" in v)
    .Properties as { Environment: { Variables: Record<string, unknown> }; Layers?: unknown };
  assert.match(JSON.stringify(vars.Environment.Variables.CONTENT_ALLOWED_CALLER_ARNS), /:root/);
  assert.equal(vars.Layers, undefined, "moderation reads no flag");
});

test("/api/comments/* allows POST, caches nothing and forwards only vid and the payload hash", () => {
  const distribution = Object.values(
    templates.delivery.findResources("AWS::CloudFront::Distribution"),
  )[0] as Resource;
  const behaviors = (distribution.Properties.DistributionConfig as {
    CacheBehaviors: Array<Record<string, unknown>>;
  }).CacheBehaviors;
  const comments = behaviors.find((b) => b.PathPattern === "/api/comments/*");
  const readers = behaviors.find((b) => b.PathPattern === "/api/readers/*");
  assert.ok(comments !== undefined && readers !== undefined);
  assert.ok((comments.AllowedMethods as string[]).includes("POST"));
  assert.equal(comments.CachePolicyId, "4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  assert.deepEqual(comments.OriginRequestPolicyId, readers.OriginRequestPolicyId);
  assert.notEqual(comments.TargetOriginId, readers.TargetOriginId);
});

test("CloudFront may call the comments Function URL and invoke the function", () => {
  const permissions = Object.values(templates.delivery.findResources("AWS::Lambda::Permission"))
    .map((resource) => resource.Properties as { Action: string; FunctionName: unknown });
  for (const action of ["lambda:InvokeFunctionUrl", "lambda:InvokeFunction"]) {
    assert.ok(
      permissions.some(
        (p) => p.Action === action && JSON.stringify(p.FunctionName).includes('"CommentsFunction'),
      ),
      `CloudFront has ${action} on the comments function`,
    );
  }
});

test("the flag profile defines comments, off, next to the other two flags", () => {
  const content = Object.values(
    templates.delivery.findResources("AWS::AppConfig::HostedConfigurationVersion"),
  ).map((r) => (r.Properties as { Content: string }).Content)[0];
  const parsed = JSON.parse(content) as { values: Record<string, { enabled: boolean }> };
  assert.deepEqual(Object.keys(parsed.values).sort(), ["comments", "readerCounts", "renderFromBackend"]);
  for (const flag of Object.values(parsed.values)) assert.equal(flag.enabled, false);
});
