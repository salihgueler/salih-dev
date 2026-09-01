import * as athena from "aws-cdk-lib/aws-athena";
import * as glue from "aws-cdk-lib/aws-glue";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import {
  ANALYTICS_DATABASE_NAME,
  ANALYTICS_WORKGROUP_NAME,
} from "./analytics-constants";
import type { AnalyticsCatalog } from "./analytics-catalog";
import {
  ANALYTICS_QUERY_DEFINITIONS,
  type AnalyticsQueryDefinition,
} from "./analytics-query-definitions";

export function createAnalyticsQueries(
  scope: Construct,
  bucket: s3.IBucket,
  catalog: AnalyticsCatalog,
): athena.CfnWorkGroup {
  const workGroup = new athena.CfnWorkGroup(scope, "AnalyticsWorkGroup", {
    name: ANALYTICS_WORKGROUP_NAME,
    recursiveDeleteOption: true,
    state: "ENABLED",
    workGroupConfiguration: {
      enforceWorkGroupConfiguration: true,
      publishCloudWatchMetricsEnabled: true,
      resultConfiguration: {
        encryptionConfiguration: { encryptionOption: "SSE_S3" },
        outputLocation: bucket.s3UrlForObject("athena-results/"),
      },
    },
  });

  for (const definition of ANALYTICS_QUERY_DEFINITIONS) {
    addNamedQuery(scope, workGroup, catalog, definition);
  }
  return workGroup;
}

function addNamedQuery(
  scope: Construct,
  workGroup: athena.CfnWorkGroup,
  catalog: {
    readonly database: glue.CfnDatabase;
    readonly table: glue.CfnTable;
  },
  definition: AnalyticsQueryDefinition,
): void {
  const query = new athena.CfnNamedQuery(scope, definition.id, {
    database: ANALYTICS_DATABASE_NAME,
    name: definition.name,
    queryString: definition.query,
    workGroup: ANALYTICS_WORKGROUP_NAME,
  });
  query.addResourceDependency(workGroup);
  query.addResourceDependency(catalog.database);
  query.addResourceDependency(catalog.table);
}
