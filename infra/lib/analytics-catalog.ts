import { Stack } from "aws-cdk-lib";
import * as glue from "aws-cdk-lib/aws-glue";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import {
  ANALYTICS_DATABASE_NAME,
  ANALYTICS_TABLE_NAME,
} from "./analytics-constants";

export interface AnalyticsCatalog {
  readonly database: glue.CfnDatabase;
  readonly table: glue.CfnTable;
}

export function createAnalyticsCatalog(
  scope: Construct,
  bucket: s3.IBucket,
): AnalyticsCatalog {
  const stack = Stack.of(scope);
  const database = new glue.CfnDatabase(scope, "AnalyticsDatabase", {
    catalogId: stack.account,
    databaseInput: {
      description: "Aggregate, non-identifying traffic analytics for salih.dev",
      name: ANALYTICS_DATABASE_NAME,
    },
  });
  const table = new glue.CfnTable(scope, "AnalyticsTable", {
    catalogId: stack.account,
    databaseName: database.ref,
    tableInput: {
      description:
        "Selected CloudFront fields; excludes IP, cookies, query strings, user agent, and full referrer",
      name: ANALYTICS_TABLE_NAME,
      parameters: {
        "projection.day.digits": "2",
        "projection.day.range": "1,31",
        "projection.day.type": "integer",
        "projection.enabled": "true",
        "projection.hour.digits": "2",
        "projection.hour.range": "0,23",
        "projection.hour.type": "integer",
        "projection.month.digits": "2",
        "projection.month.range": "1,12",
        "projection.month.type": "integer",
        "projection.year.range": "2026,2100",
        "projection.year.type": "integer",
        "storage.location.template": `${bucket.s3UrlForObject(`AWSLogs/aws-account-id=${stack.account}/CloudFront`)}/year=\${year}/month=\${month}/day=\${day}/hour=\${hour}/`,
      },
      partitionKeys: [
        { name: "year", type: "string" },
        { name: "month", type: "string" },
        { name: "day", type: "string" },
        { name: "hour", type: "string" },
      ],
      storageDescriptor: {
        columns: [
          { name: "event_date", type: "string" },
          { name: "event_time", type: "string" },
          { name: "edge_location", type: "string" },
          { name: "method", type: "string" },
          { name: "host", type: "string" },
          { name: "uri_stem", type: "string" },
          { name: "status", type: "string" },
          { name: "response_bytes", type: "string" },
          { name: "request_bytes", type: "string" },
          { name: "time_taken", type: "string" },
          { name: "time_to_first_byte", type: "string" },
          { name: "result_type", type: "string" },
          { name: "response_result_type", type: "string" },
          { name: "detailed_result_type", type: "string" },
          { name: "content_type", type: "string" },
          { name: "country", type: "string" },
          { name: "protocol_version", type: "string" },
          { name: "cache_behavior", type: "string" },
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        location: bucket.s3UrlForObject(
          `AWSLogs/aws-account-id=${stack.account}/CloudFront/`,
        ),
        outputFormat:
          "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          parameters: {
            "mapping.cache_behavior": "cache-behavior-path-pattern",
            "mapping.content_type": "sc-content-type",
            "mapping.country": "c-country",
            "mapping.detailed_result_type": "x-edge-detailed-result-type",
            "mapping.edge_location": "x-edge-location",
            "mapping.event_date": "date",
            "mapping.event_time": "time",
            "mapping.host": "cs(Host)",
            "mapping.method": "cs-method",
            "mapping.protocol_version": "cs-protocol-version",
            "mapping.request_bytes": "cs-bytes",
            "mapping.response_bytes": "sc-bytes",
            "mapping.response_result_type": "x-edge-response-result-type",
            "mapping.result_type": "x-edge-result-type",
            "mapping.status": "sc-status",
            "mapping.time_taken": "time-taken",
            "mapping.time_to_first_byte": "time-to-first-byte",
            "mapping.uri_stem": "cs-uri-stem",
          },
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
        },
      },
      tableType: "EXTERNAL_TABLE",
    },
  });
  return { database, table };
}
