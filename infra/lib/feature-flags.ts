import { Duration } from "aws-cdk-lib";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

/**
 * The AWS AppConfig control plane for the `renderFromBackend` rollout.
 *
 * Feature: render-rollout-flag (Parts 1 and 2 of the AppConfig rollout).
 *
 * This construct owns:
 *
 * - an AppConfig application and a single `production` environment (the site has
 *   one environment);
 * - a feature-flag configuration profile holding one boolean flag,
 *   `renderFromBackend`, deployed with its default `false`, so the deployed code
 *   takes the off path for everyone until the flag is turned on out of band
 *   (deploying the code and turning the feature on are two separate acts);
 * - a deployment strategy with a linear rollout and a FINAL BAKE TIME, during
 *   which AppConfig watches the CloudWatch alarm and rolls the configuration
 *   back if it fires;
 * - a CloudWatch alarm on the render Lambda's errors (and its p95 duration) that
 *   is attached to the environment as a monitor. The L2 `Monitor.fromCloudWatchAlarm`
 *   auto-generates the IAM role AppConfig needs to read the alarm.
 *
 * Everything here is provisioning only; no configuration is turned on. The
 * multi-variant targeting rule and the `split` rollout rule (Part 2) are set on
 * the deployed flag out of band, not baked into this stack, so a rollout step
 * is a flag deployment rather than a CDK deploy.
 *
 * The flag JSON is the `AWS.AppConfig.FeatureFlags` schema: a `version`, a
 * `flags` map describing each flag, and a `values` map giving each flag's
 * current value. `renderFromBackend` starts disabled.
 */
export interface FeatureFlagsProps {
  /**
   * The render Lambda's error metric source. The alarm and monitor are built
   * from this function's `Errors` and `Duration` metrics.
   */
  readonly renderFunction: lambda.IFunction;
}

/** The flag key the render Lambda reads and the rollout turns on. */
export const RENDER_FLAG_KEY = "renderFromBackend";

/** The one environment this single-environment site deploys the flag to. */
export const APPCONFIG_ENVIRONMENT_NAME = "production";

/** The code-set application and profile names, used to build the config path. */
export const APPCONFIG_APPLICATION_NAME = "salih-dev";
export const APPCONFIG_PROFILE_NAME = "render-flags";

export class FeatureFlags extends Construct {
  public readonly application: appconfig.Application;
  public readonly environment: appconfig.Environment;
  public readonly configuration: appconfig.HostedConfiguration;
  public readonly deploymentStrategy: appconfig.DeploymentStrategy;

  public constructor(scope: Construct, id: string, props: FeatureFlagsProps) {
    super(scope, id);

    this.application = new appconfig.Application(this, "Application", {
      applicationName: APPCONFIG_APPLICATION_NAME,
      description: "Feature flags and rollout control for salih.dev.",
    });

    // An alarm on the render Lambda's errors: any error over a short window is
    // the signal a bad configuration is live. AppConfig watches this during the
    // deployment and the final bake time and rolls back if it fires.
    const errorAlarm = new cloudwatch.Alarm(this, "RenderErrorsAlarm", {
      alarmDescription:
        "The render Lambda is erroring; roll back the renderFromBackend rollout.",
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      metric: props.renderFunction.metricErrors({
        period: Duration.minutes(1),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // A secondary latency guard: a rollout that makes the render path slow (a
    // cold-start storm, an S3 slowdown) trips this before visitors feel it.
    const latencyAlarm = new cloudwatch.Alarm(this, "RenderLatencyAlarm", {
      alarmDescription:
        "The render Lambda p95 duration is high during the rollout.",
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 3,
      metric: props.renderFunction.metricDuration({
        period: Duration.minutes(1),
        statistic: "p95",
      }),
      threshold: Duration.seconds(5).toMilliseconds(),
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    this.environment = new appconfig.Environment(this, "Environment", {
      application: this.application,
      environmentName: APPCONFIG_ENVIRONMENT_NAME,
      description: "salih.dev production rollout targets.",
      // Monitor.fromCloudWatchAlarm auto-generates the alarm-read role AppConfig
      // needs, so no role is authored by hand here.
      monitors: [
        appconfig.Monitor.fromCloudWatchAlarm(errorAlarm),
        appconfig.Monitor.fromCloudWatchAlarm(latencyAlarm),
      ],
    });

    // A linear rollout with a final bake time. The bake time is the window in
    // which the automatic alarm rollback is armed after the configuration
    // reaches 100% of targets; it is sized to how long a bad render takes to
    // show up in the error metric, not a token minute.
    this.deploymentStrategy = new appconfig.DeploymentStrategy(
      this,
      "DeploymentStrategy",
      {
        deploymentStrategyName: "salih-dev-render-rollout",
        rolloutStrategy: appconfig.RolloutStrategy.linear({
          growthFactor: 25,
          deploymentDuration: Duration.minutes(20),
          finalBakeTime: Duration.minutes(10),
        }),
      },
    );

    // The feature-flag configuration: one boolean flag, deployed with its
    // default `false`. Turning it on, and adding the targeting or split rule,
    // happens out of band as a flag deployment.
    this.configuration = new appconfig.HostedConfiguration(
      this,
      "FeatureFlags",
      {
        application: this.application,
        name: APPCONFIG_PROFILE_NAME,
        description: "salih.dev render rollout feature flags.",
        deployTo: [this.environment],
        deploymentStrategy: this.deploymentStrategy,
        type: appconfig.ConfigurationType.FEATURE_FLAGS,
        content: appconfig.ConfigurationContent.fromInlineJson(
          JSON.stringify({
            version: "1",
            flags: {
              [RENDER_FLAG_KEY]: {
                name: RENDER_FLAG_KEY,
                description:
                  "Serve the dynamic routes from the render Lambda (on) or the baked static pages (off).",
              },
            },
            values: {
              [RENDER_FLAG_KEY]: {
                enabled: false,
              },
            },
          }),
        ),
      },
    );
  }

  /**
   * The configuration-path env value the AppConfig Agent prefetch list and the
   * render Lambda's flag read both use:
   * `/applications/<app>/environments/<env>/configurations/<profile>`.
   *
   * Uses the code-set names so the value is stable and does not depend on a
   * generated id.
   */
  public configurationPath(): string {
    return (
      `/applications/${APPCONFIG_APPLICATION_NAME}` +
      `/environments/${APPCONFIG_ENVIRONMENT_NAME}` +
      `/configurations/${APPCONFIG_PROFILE_NAME}`
    );
  }
}
