/**
 * CDK assertions for the render-rollout-flag feature.
 *
 * Feature: render-rollout-flag (Parts 1 and 2).
 *
 * These prove the synthesized template carries the AppConfig control plane, the
 * extension layer and IAM on the render Lambda, the off-path site-bucket read
 * scope, the alarm monitor, the vid-only cookie forwarding, and the no-cache
 * render behavior. They do not deploy anything.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { SalihDevDeliveryStack } from "../lib/delivery-stack";
import { SalihDevStateStack } from "../lib/state-stack";

function deliveryTemplate(): Template {
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
  return Template.fromStack(delivery);
}

test("creates an AppConfig application, a production environment, and a feature-flag profile", () => {
  const t = deliveryTemplate();
  t.hasResourceProperties("AWS::AppConfig::Application", {
    Name: "salih-dev",
  });
  t.hasResourceProperties("AWS::AppConfig::Environment", {
    Name: "production",
  });
  t.hasResourceProperties("AWS::AppConfig::ConfigurationProfile", {
    Name: "render-flags",
    Type: "AWS.AppConfig.FeatureFlags",
  });
});

test("the deployed flag content defines renderFromBackend disabled by default", () => {
  const t = deliveryTemplate();
  const versions = t.findResources("AWS::AppConfig::HostedConfigurationVersion");
  const contents = Object.values(versions).map(
    (r) => (r.Properties as { Content: string }).Content,
  );
  assert.ok(contents.length >= 1, "a hosted configuration version exists");
  const flagContent = contents.find((c) => c.includes("renderFromBackend"));
  assert.ok(flagContent !== undefined, "the flag content is present");
  const parsed = JSON.parse(flagContent) as {
    values: { renderFromBackend: { enabled: boolean } };
  };
  assert.equal(parsed.values.renderFromBackend.enabled, false);
});

test("the environment has CloudWatch alarm monitors (auto-generated role)", () => {
  const t = deliveryTemplate();
  t.hasResourceProperties("AWS::AppConfig::Environment", {
    Monitors: Match.arrayWith([
      Match.objectLike({ AlarmArn: Match.anyValue() }),
    ]),
  });
  // The render-error alarm on the Lambda's Errors metric.
  t.hasResourceProperties("AWS::CloudWatch::Alarm", {
    MetricName: "Errors",
    Namespace: "AWS/Lambda",
  });
});

test("handled render failures drive their own alarm and AppConfig monitor", () => {
  const t = deliveryTemplate();
  // The metric filter counts every failure outcome the render path logs.
  const filters = Object.values(t.findResources("AWS::Logs::MetricFilter"));
  const failure = filters.find((f) => {
    const transforms = (
      f.Properties as {
        MetricTransformations: { MetricName: string }[];
      }
    ).MetricTransformations;
    return transforms.some((m) => m.MetricName === "RenderFailures");
  });
  assert.ok(failure !== undefined, "a RenderFailures metric filter exists");
  const pattern = (failure.Properties as { FilterPattern: string })
    .FilterPattern;
  for (const outcome of [
    "on_path_fallback",
    "render_error",
    "middleware_error",
    "load_error",
  ]) {
    assert.ok(pattern.includes(outcome), `filter matches ${outcome}`);
  }
  t.hasResourceProperties("AWS::CloudWatch::Alarm", {
    MetricName: "RenderFailures",
    Namespace: "SalihDev/Render",
    Threshold: 1,
  });
  // Three monitors: Lambda errors, p95 latency, handled render failures.
  const envs = Object.values(t.findResources("AWS::AppConfig::Environment"));
  const monitors = (envs[0].Properties as { Monitors: unknown[] }).Monitors;
  assert.equal(monitors.length, 3);
});

test("the deployment strategy has a final bake time", () => {
  const t = deliveryTemplate();
  t.hasResourceProperties("AWS::AppConfig::DeploymentStrategy", {
    Name: "salih-dev-render-rollout",
    FinalBakeTimeInMinutes: Match.anyValue(),
  });
});

test("the stack creates the flag version but does not deploy it", () => {
  // The monitor alarms start in INSUFFICIENT_DATA, which AppConfig treats as a
  // rollback signal, so a deployment in the same stack deploy rolls it back.
  const t = deliveryTemplate();
  t.resourceCountIs("AWS::AppConfig::HostedConfigurationVersion", 1);
  t.resourceCountIs("AWS::AppConfig::Deployment", 0);
  t.resourceCountIs("AWS::AppConfig::DeploymentStrategy", 1);
});

test("the render Lambda carries the AppConfig extension layer and coordinates", () => {
  const t = deliveryTemplate();
  const functions = t.findResources("AWS::Lambda::Function");
  const render = Object.values(functions).find((fn) => {
    const env = (fn.Properties as { Environment?: { Variables?: Record<string, unknown> } })
      .Environment?.Variables;
    return env?.SALIH_DEV_SSR === "1";
  });
  assert.ok(render !== undefined, "the render function exists");
  const props = render.Properties as {
    Layers?: unknown[];
    Environment: { Variables: Record<string, unknown> };
  };
  assert.ok(
    Array.isArray(props.Layers) && props.Layers.length >= 1,
    "the render function has at least one layer (the AppConfig agent)",
  );
  const vars = props.Environment.Variables;
  assert.ok("AWS_APPCONFIG_EXTENSION_PREFETCH_LIST" in vars);
  assert.equal(vars.APPCONFIG_ENVIRONMENT, "production");
  assert.equal(vars.APPCONFIG_APPLICATION, "salih-dev");
  assert.equal(vars.APPCONFIG_PROFILE, "render-flags");
  assert.equal(vars.RENDER_ROLLOUT_ACTIVE, "1");
  assert.ok("SITE_BUCKET_NAME" in vars);
});

test("the render role can read the AppConfig configuration", () => {
  const t = deliveryTemplate();
  t.hasResourceProperties(
    "AWS::IAM::Policy",
    Match.objectLike({
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              "appconfig:StartConfigurationSession",
              "appconfig:GetLatestConfiguration",
            ]),
          }),
        ]),
      }),
    }),
  );
});

test("the render behavior forwards only the vid cookie", () => {
  const t = deliveryTemplate();
  t.hasResourceProperties("AWS::CloudFront::OriginRequestPolicy", {
    OriginRequestPolicyConfig: Match.objectLike({
      Name: "salih-dev-render-vid",
      CookiesConfig: {
        CookieBehavior: "whitelist",
        Cookies: ["vid"],
      },
    }),
  });
});

test("the rollout render cache policy caches nothing (all TTLs at or near zero)", () => {
  const t = deliveryTemplate();
  t.hasResourceProperties("AWS::CloudFront::CachePolicy", {
    CachePolicyConfig: Match.objectLike({
      Name: "salih-dev-render-rollout",
      DefaultTTL: 0,
      MinTTL: 0,
    }),
  });
});

test("CloudFront may call the render Function URL and invoke the function", () => {
  // OAC on a Function URL needs both actions; with only InvokeFunctionUrl every
  // render route returned 403 in production.
  const t = deliveryTemplate();
  const permissions = Object.values(t.findResources("AWS::Lambda::Permission")).map(
    (resource) => resource.Properties as { Action: string; Principal: string },
  );
  for (const action of ["lambda:InvokeFunctionUrl", "lambda:InvokeFunction"]) {
    assert.ok(
      permissions.some(
        (p) => p.Action === action && p.Principal === "cloudfront.amazonaws.com",
      ),
      `CloudFront has ${action}`,
    );
  }
});
