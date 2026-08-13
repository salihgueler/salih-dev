import * as athena from "aws-cdk-lib/aws-athena";
import * as glue from "aws-cdk-lib/aws-glue";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import {
  ANALYTICS_DATABASE_NAME,
  ANALYTICS_TABLE_NAME,
  ANALYTICS_WORKGROUP_NAME,
} from "./analytics-constants";
import type { AnalyticsCatalog } from "./analytics-catalog";

interface NamedQueryProps {
  readonly name: string;
  readonly query: string;
}

export function createAnalyticsQueries(
  scope: Construct,
  bucket: s3.IBucket,
  catalog: AnalyticsCatalog,
): void {
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

  addNamedQuery(scope, "TopContentQuery", workGroup, catalog, {
    name: "salih-dev-top-content",
    query:
      `SELECT uri_stem, count(*) AS requests ` +
      `FROM ${ANALYTICS_DATABASE_NAME}.${ANALYTICS_TABLE_NAME} ` +
      `WHERE method = 'GET' AND try_cast(status AS integer) BETWEEN 200 AND 399 ` +
      `AND uri_stem NOT LIKE '/_astro/%' ` +
      `GROUP BY uri_stem ORDER BY requests DESC LIMIT 50`,
  });
  addNamedQuery(scope, "DailyTrafficQuery", workGroup, catalog, {
    name: "salih-dev-daily-traffic",
    query:
      `SELECT event_date, count(*) AS requests, ` +
      `sum(CASE WHEN try_cast(status AS integer) >= 400 THEN 1 ELSE 0 END) AS errors ` +
      `FROM ${ANALYTICS_DATABASE_NAME}.${ANALYTICS_TABLE_NAME} ` +
      `GROUP BY event_date ORDER BY event_date DESC LIMIT 90`,
  });
  addNamedQuery(scope, "PerformanceQuery", workGroup, catalog, {
    name: "salih-dev-edge-performance",
    query:
      `SELECT uri_stem, approx_percentile(try_cast(time_taken AS double), 0.95) AS p95_seconds, ` +
      `approx_percentile(try_cast(time_to_first_byte AS double), 0.95) AS p95_ttfb_seconds ` +
      `FROM ${ANALYTICS_DATABASE_NAME}.${ANALYTICS_TABLE_NAME} WHERE method = 'GET' ` +
      `GROUP BY uri_stem ORDER BY p95_seconds DESC LIMIT 50`,
  });
}

function addNamedQuery(
  scope: Construct,
  id: string,
  workGroup: athena.CfnWorkGroup,
  catalog: {
    readonly database: glue.CfnDatabase;
    readonly table: glue.CfnTable;
  },
  props: NamedQueryProps,
): void {
  const query = new athena.CfnNamedQuery(scope, id, {
    database: ANALYTICS_DATABASE_NAME,
    name: props.name,
    queryString: props.query,
    workGroup: ANALYTICS_WORKGROUP_NAME,
  });
  query.addResourceDependency(workGroup);
  query.addResourceDependency(catalog.database);
  query.addResourceDependency(catalog.table);
}
