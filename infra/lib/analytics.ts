import { CfnOutput } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import type { Construct } from "constructs";

import { createAnalyticsCatalog } from "./analytics-catalog";
import {
  ANALYTICS_DATABASE_NAME,
  ANALYTICS_WORKGROUP_NAME,
} from "./analytics-constants";
import { createAnalyticsLogging } from "./analytics-logging";
import { createAnalyticsQueries } from "./analytics-queries";

export interface AnalyticsProps {
  readonly distribution: cloudfront.IDistribution;
}

/** Privacy-first aggregate analytics from selected CloudFront log fields. */
export class Analytics {
  public constructor(scope: Construct, props: AnalyticsProps) {
    const bucket = createAnalyticsLogging(scope, props.distribution);
    const catalog = createAnalyticsCatalog(scope, bucket);
    createAnalyticsQueries(scope, bucket, catalog);

    new CfnOutput(scope, "AnalyticsBucketName", { value: bucket.bucketName });
    new CfnOutput(scope, "AnalyticsDatabaseName", {
      value: ANALYTICS_DATABASE_NAME,
    });
    new CfnOutput(scope, "AnalyticsWorkGroupName", {
      value: ANALYTICS_WORKGROUP_NAME,
    });
  }
}
