import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";

import { HOMEPAGE_CHECK_CODE } from "./homepage-check-code";

export interface HomepageMonitoring {
  readonly duration: cloudwatch.IMetric;
  readonly errors: cloudwatch.IMetric;
  readonly failureAlarm: cloudwatch.Alarm;
  readonly function: lambda.Function;
  readonly invocations: cloudwatch.IMetric;
  readonly schedule: events.Rule;
  readonly scheduleAlarm: cloudwatch.Alarm;
}

export function createHomepageMonitoring(
  scope: Construct,
  domainName: string,
  alarmTopic: sns.ITopic,
): HomepageMonitoring {
  const period = Duration.minutes(15);
  const logGroup = new logs.LogGroup(scope, "HomepageCheckLogs", {
    removalPolicy: RemovalPolicy.DESTROY,
    retention: logs.RetentionDays.ONE_WEEK,
  });
  const check = new lambda.Function(scope, "HomepageCheck", {
    architecture: lambda.Architecture.ARM_64,
    code: lambda.Code.fromInline(HOMEPAGE_CHECK_CODE),
    description:
      "Checks the salih.dev homepage status and title without a browser runtime.",
    environment: {
      CHECK_URL: `https://${domainName}/`,
      EXPECTED_TITLE: "Salih",
    },
    handler: "index.handler",
    logGroup,
    memorySize: 128,
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: Duration.seconds(10),
  });
  const schedule = new events.Rule(scope, "HomepageCheckSchedule", {
    description: "Runs the lightweight salih.dev homepage check.",
    schedule: events.Schedule.rate(period),
  });
  schedule.addTarget(new targets.LambdaFunction(check, { retryAttempts: 0 }));

  const invocations = check.metricInvocations({ period, statistic: "Sum" });
  const errors = check.metricErrors({ period, statistic: "Sum" });
  const duration = check.metricDuration({ period, statistic: "p95" });
  const failureAlarm = new cloudwatch.Alarm(
    scope,
    "HomepageCheckFailureAlarm",
    {
      alarmDescription:
        "The homepage check failed in two of three 15-minute periods.",
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      datapointsToAlarm: 2,
      evaluationPeriods: 3,
      metric: errors,
      threshold: 0,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    },
  );
  const scheduleAlarm = new cloudwatch.Alarm(
    scope,
    "HomepageCheckScheduleAlarm",
    {
      alarmDescription:
        "The scheduled homepage check did not run in two of three 15-minute periods.",
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      datapointsToAlarm: 2,
      evaluationPeriods: 3,
      metric: invocations,
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    },
  );
  failureAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
  scheduleAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));

  NagSuppressions.addResourceSuppressions(
    check,
    [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "AWSLambdaBasicExecutionRole is used only for short-retention checker logs.",
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Lambda logging needs a wildcard for generated streams in its log group.",
      },
    ],
    true,
  );
  return {
    duration,
    errors,
    failureAlarm,
    function: check,
    invocations,
    schedule,
    scheduleAlarm,
  };
}
