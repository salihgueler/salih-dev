import {
  ANALYTICS_DATABASE_NAME,
  ANALYTICS_TABLE_NAME,
} from "./analytics-constants";

export type AnalyticsView =
  | "top-content"
  | "daily-traffic"
  | "edge-performance";

export interface AnalyticsQueryDefinition {
  readonly columns: readonly string[];
  readonly id: string;
  readonly maxWidgetRows: number;
  readonly name: string;
  readonly query: string;
  readonly title: string;
  readonly view: AnalyticsView;
  readonly widgetHeight: number;
  readonly widgetWidth: number;
}

export const ANALYTICS_QUERY_DEFINITIONS: readonly AnalyticsQueryDefinition[] = [
  {
    columns: ["Path", "Requests"],
    id: "TopContentQuery",
    maxWidgetRows: 10,
    name: "salih-dev-top-content",
    query:
      `SELECT uri_stem, count(*) AS requests ` +
      `FROM ${ANALYTICS_DATABASE_NAME}.${ANALYTICS_TABLE_NAME} ` +
      `WHERE method = 'GET' AND try_cast(status AS integer) BETWEEN 200 AND 399 ` +
      `AND uri_stem NOT LIKE '/_astro/%' ` +
      `GROUP BY uri_stem ORDER BY requests DESC LIMIT 50`,
    title: "Top content · Athena (cached up to 1 hour)",
    view: "top-content",
    widgetHeight: 8,
    widgetWidth: 12,
  },
  {
    columns: ["Date", "Requests", "Errors"],
    id: "DailyTrafficQuery",
    maxWidgetRows: 14,
    name: "salih-dev-daily-traffic",
    query:
      `SELECT event_date, count(*) AS requests, ` +
      `sum(CASE WHEN try_cast(status AS integer) >= 400 THEN 1 ELSE 0 END) AS errors ` +
      `FROM ${ANALYTICS_DATABASE_NAME}.${ANALYTICS_TABLE_NAME} ` +
      `GROUP BY event_date ORDER BY event_date DESC LIMIT 90`,
    title: "Daily traffic and errors · Athena (cached up to 1 hour)",
    view: "daily-traffic",
    widgetHeight: 8,
    widgetWidth: 12,
  },
  {
    columns: ["Path", "p95 response (s)", "p95 TTFB (s)"],
    id: "PerformanceQuery",
    maxWidgetRows: 10,
    name: "salih-dev-edge-performance",
    query:
      `SELECT uri_stem, round(approx_percentile(try_cast(time_taken AS double), 0.95), 3) AS p95_seconds, ` +
      `round(approx_percentile(try_cast(time_to_first_byte AS double), 0.95), 3) AS p95_ttfb_seconds ` +
      `FROM ${ANALYTICS_DATABASE_NAME}.${ANALYTICS_TABLE_NAME} WHERE method = 'GET' ` +
      `GROUP BY uri_stem ORDER BY p95_seconds DESC LIMIT 50`,
    title: "Slowest content at the edge · Athena (cached up to 1 hour)",
    view: "edge-performance",
    widgetHeight: 8,
    widgetWidth: 24,
  },
];
