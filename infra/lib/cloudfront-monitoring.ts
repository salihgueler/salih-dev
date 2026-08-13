import { Duration } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

export interface CloudFrontMonitoring {
  readonly alarm4xx: cloudwatch.Alarm;
  readonly alarm5xx: cloudwatch.Alarm;
  readonly error4xxRate: cloudwatch.Metric;
  readonly error5xxRate: cloudwatch.Metric;
}

export function createCloudFrontMonitoring(
  scope: Construct,
  distributionId: string,
  alarmTopic: sns.ITopic,
): CloudFrontMonitoring {
  const metricOptions = {
    dimensionsMap: { DistributionId: distributionId, Region: "Global" },
    namespace: "AWS/CloudFront",
    period: Duration.minutes(5),
    statistic: "Average",
  };
  const error5xxRate = new cloudwatch.Metric({
    ...metricOptions,
    metricName: "5xxErrorRate",
  });
  const error4xxRate = new cloudwatch.Metric({
    ...metricOptions,
    metricName: "4xxErrorRate",
  });
  const alarm5xx = new cloudwatch.Alarm(scope, "CloudFront5xxAlarm", {
    alarmDescription:
      "CloudFront 5xx error rate exceeded 5% in two of three periods.",
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    datapointsToAlarm: 2,
    evaluationPeriods: 3,
    metric: error5xxRate,
    threshold: 5,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  const alarm4xx = new cloudwatch.Alarm(scope, "CloudFront4xxAlarm", {
    alarmDescription:
      "CloudFront 4xx error rate exceeded 10% in two of three periods.",
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    datapointsToAlarm: 2,
    evaluationPeriods: 3,
    metric: error4xxRate,
    threshold: 10,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  alarm5xx.addAlarmAction(new actions.SnsAction(alarmTopic));
  alarm4xx.addAlarmAction(new actions.SnsAction(alarmTopic));
  return { alarm4xx, alarm5xx, error4xxRate, error5xxRate };
}
