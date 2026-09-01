import { CfnOutput, Duration } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

import { ANALYTICS_QUERY_DEFINITIONS } from "./analytics-query-definitions";
import { createCloudFrontMonitoring } from "./cloudfront-monitoring";
import { createHomepageMonitoring } from "./homepage-monitoring";

export interface MonitoringProps {
  readonly alarmTopic: sns.ITopic;
  readonly analyticsWidgetFunction: lambda.IFunction;
  readonly distribution: cloudfront.Distribution;
  readonly distributionId: string;
  readonly domainName: string;
}

/** Adds CloudFront alarms, a dashboard, and a low-cost homepage check. */
export class Monitoring {
  public constructor(scope: Construct, props: MonitoringProps) {
    const cloudFront = createCloudFrontMonitoring(
      scope,
      props.distributionId,
      props.alarmTopic,
    );
    const homepage = createHomepageMonitoring(
      scope,
      props.domainName,
      props.alarmTopic,
    );
    const dashboard = new cloudwatch.Dashboard(
      scope,
      "OperationsDashboard",
      { dashboardName: "salih-dev-operations" },
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        left: [
          props.distribution.metricRequests({
            period: Duration.minutes(5),
            statistic: "Sum",
          }),
        ],
        right: [cloudFront.error4xxRate, cloudFront.error5xxRate],
        title: "Requests and error rates",
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        left: [homepage.invocations, homepage.errors],
        right: [homepage.duration],
        title: "Homepage checks and p95 duration",
        width: 12,
      }),
      new cloudwatch.AlarmStatusWidget({
        alarms: [
          cloudFront.alarm5xx,
          cloudFront.alarm4xx,
          homepage.failureAlarm,
          homepage.scheduleAlarm,
        ],
        title: "Operational alarm states",
        width: 24,
      }),
    );
    dashboard.addWidgets(
      ...ANALYTICS_QUERY_DEFINITIONS.map(
        (definition) =>
          new cloudwatch.CustomWidget({
            functionArn: props.analyticsWidgetFunction.functionArn,
            height: definition.widgetHeight,
            params: { view: definition.view },
            title: definition.title,
            updateOnRefresh: true,
            updateOnResize: false,
            updateOnTimeRangeChange: false,
            width: definition.widgetWidth,
          }),
      ),
    );

    new CfnOutput(scope, "OperationsDashboardName", {
      value: dashboard.dashboardName,
    });
    new CfnOutput(scope, "HomepageCheckFunctionName", {
      value: homepage.function.functionName,
    });
    new CfnOutput(scope, "HomepageCheckScheduleName", {
      value: homepage.schedule.ruleName,
    });
  }
}
