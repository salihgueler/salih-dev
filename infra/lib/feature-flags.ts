import { Duration } from "aws-cdk-lib";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
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
 *   auto-generates the IAM role AppConfig needs to read the alarm;
 * - a third alarm on handled render failures, counted by a metric filter on
 *   the render log group, because a failed flag-on request falls back to the
 *   baked page and never reaches the `Errors` metric.
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
  /**
   * The render Lambda's log group. A metric filter counts the handled render
   * failures it logs (`outcome` of `on_path_fallback`, `render_error`,
   * `middleware_error`, `load_error`). Those requests return a response rather
   * than throwing, so they never reach the function's `Errors` metric.
   */
  readonly renderLogGroup: logs.ILogGroup;
  /**
   * The reader-counts API function. Its errors drive a fourth monitor, so a
   * `readerCounts` rollout that breaks the API rolls back like a render one.
   */
  readonly readersFunction: lambda.IFunction;
  /** The readers function's log group, for the handled `store_error` outcome. */
  readonly readersLogGroup: logs.ILogGroup;
}

/**
 * The render log outcomes that mean the on path failed. `on_path_fallback` is
 * logged by the middleware when a flag-on request falls back to the baked page;
 * the other three are logged by the render handler.
 */
export const RENDER_FAILURE_OUTCOMES = [
  "on_path_fallback",
  "render_error",
  "middleware_error",
  "load_error",
] as const;

/** The flag key the render Lambda reads and the rollout turns on. */
export const RENDER_FLAG_KEY = "renderFromBackend";

/** The flag that shows reader counts on blog posts (reader-counts feature). */
export const READER_COUNTS_FLAG_KEY = "readerCounts";

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

    // Handled render failures. A flag-on request whose content read or render
    // fails now falls back to the baked page and returns 200, so neither the
    // Lambda `Errors` metric nor CloudFront 5xx sees it. The logged outcome is
    // the only signal, so it drives its own alarm and monitor.
    const failureFilter = new logs.MetricFilter(this, "RenderFailureFilter", {
      logGroup: props.renderLogGroup,
      metricNamespace: "SalihDev/Render",
      metricName: "RenderFailures",
      metricValue: "1",
      defaultValue: 0,
      filterPattern: logs.FilterPattern.any(
        ...RENDER_FAILURE_OUTCOMES.map((outcome) =>
          logs.FilterPattern.stringValue("$.outcome", "=", outcome),
        ),
      ),
    });
    const failureAlarm = new cloudwatch.Alarm(this, "RenderFailuresAlarm", {
      alarmDescription:
        "The render on path is failing (falling back to baked pages); roll back the renderFromBackend rollout.",
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      metric: failureFilter.metric({
        period: Duration.minutes(1),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Reader-counts API failures. The handler turns a DynamoDB or S3 failure
    // into a logged `store_error` and a 500 (the widget then hides itself), so
    // the alarm adds that count to the function's own Errors.
    const readersStoreErrors = new logs.MetricFilter(
      this,
      "ReadersStoreErrorFilter",
      {
        logGroup: props.readersLogGroup,
        metricNamespace: "SalihDev/Readers",
        metricName: "StoreErrors",
        metricValue: "1",
        defaultValue: 0,
        filterPattern: logs.FilterPattern.stringValue(
          "$.outcome",
          "=",
          "store_error",
        ),
      },
    );
    const readersAlarm = new cloudwatch.Alarm(this, "ReadersErrorsAlarm", {
      alarmDescription:
        "The reader-counts API is failing; roll back the readerCounts rollout.",
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      metric: new cloudwatch.MathExpression({
        expression: "errors + storeErrors",
        label: "Reader-counts failures",
        period: Duration.minutes(1),
        usingMetrics: {
          errors: props.readersFunction.metricErrors({
            period: Duration.minutes(1),
            statistic: cloudwatch.Stats.SUM,
          }),
          storeErrors: readersStoreErrors.metric({
            period: Duration.minutes(1),
            statistic: cloudwatch.Stats.SUM,
          }),
        },
      }),
      // Two failures in a minute: one lost heartbeat is noise, the widget
      // retries on the next beat.
      threshold: 2,
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
        appconfig.Monitor.fromCloudWatchAlarm(failureAlarm),
        appconfig.Monitor.fromCloudWatchAlarm(readersAlarm),
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

    // The feature-flag configuration: one boolean flag with its default
    // `false`. The stack creates the version but does NOT deploy it. AppConfig
    // rolls a deployment back when a monitor alarm is in ALARM or
    // INSUFFICIENT_DATA, and the three alarms above start in INSUFFICIENT_DATA
    // until CloudWatch first evaluates them, so a deployment started in the
    // same stack deploy races them and rolls the whole stack back. The first
    // flag deployment is a runbook step (DEPLOY.md section 11) once the alarms
    // are OK. Until then the flag read fails and the render Lambda serves the
    // baked pages, which is the flag-off behavior.
    this.configuration = new appconfig.HostedConfiguration(
      this,
      "FeatureFlags",
      {
        application: this.application,
        name: APPCONFIG_PROFILE_NAME,
        description: "salih.dev render rollout feature flags.",
        // Passed so CDK does not create a second, default strategy. Without
        // `deployTo` nothing is deployed with it here.
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
              [READER_COUNTS_FLAG_KEY]: {
                name: READER_COUNTS_FLAG_KEY,
                description:
                  "Show 'reading now' and 'read so far' on blog posts, and accept reader heartbeats.",
              },
            },
            values: {
              [RENDER_FLAG_KEY]: {
                enabled: false,
              },
              [READER_COUNTS_FLAG_KEY]: {
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
