export const ANALYTICS_DATABASE_NAME = "salih_dev_analytics";
export const ANALYTICS_TABLE_NAME = "cloudfront_access_logs";
export const ANALYTICS_WORKGROUP_NAME = "salih-dev-analytics";
export const DELIVERY_SOURCE_NAME = "salih-dev-cloudfront-access";
export const DELIVERY_DESTINATION_NAME = "salih-dev-cloudfront-s3";

export const ANALYTICS_RECORD_FIELDS = [
  "date",
  "time",
  "x-edge-location",
  "cs-method",
  "cs(Host)",
  "cs-uri-stem",
  "sc-status",
  "sc-bytes",
  "cs-bytes",
  "time-taken",
  "time-to-first-byte",
  "x-edge-result-type",
  "x-edge-response-result-type",
  "x-edge-detailed-result-type",
  "sc-content-type",
  "c-country",
  "cs-protocol-version",
  "cache-behavior-path-pattern",
];
