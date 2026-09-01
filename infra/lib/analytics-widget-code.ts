import { ANALYTICS_QUERY_DEFINITIONS } from "./analytics-query-definitions";

const WIDGET_DOCUMENTATION = `\`\`\`yaml
view: top-content | daily-traffic | edge-performance
\`\`\`
Runs a privacy-filtered Athena query and returns a Markdown table. Query results
are eligible for Athena reuse for 60 minutes.`;

export function buildAnalyticsWidgetCode(): string {
  const queries = Object.fromEntries(
    ANALYTICS_QUERY_DEFINITIONS.map((definition) => [
      definition.view,
      {
        columns: definition.columns,
        maxRows: definition.maxWidgetRows,
        query: definition.query,
        title: definition.title,
      },
    ]),
  );

  return `
const {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} = require('@aws-sdk/client-athena');

const client = new AthenaClient({});
const queries = ${JSON.stringify(queries)};
const documentation = ${JSON.stringify(WIDGET_DOCUMENTATION)};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function escapeCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\\n', ' ');
}

function markdownTable(definition, rows, reused) {
  const dataRows = rows.slice(1, definition.maxRows + 1).map((row) =>
    row.Data.map((cell) => escapeCell(cell.VarCharValue)),
  );
  if (dataRows.length === 0) {
    return {
      markdown:
        '### ' + definition.title + '\\n\\n' +
        'No analytics rows yet. CloudFront standard logs can take about an hour to arrive.',
    };
  }
  const header = '| ' + definition.columns.join(' | ') + ' |';
  const divider = '| ' + definition.columns.map(() => '---').join(' | ') + ' |';
  const body = dataRows.map((row) => '| ' + row.join(' | ') + ' |').join('\\n');
  const reuse = reused ? 'Reused an Athena result from the last hour.' : 'Queried Athena now; this result can be reused for one hour.';
  return {
    markdown:
      '### ' + definition.title + '\\n\\n' +
      header + '\\n' + divider + '\\n' + body + '\\n\\n_' + reuse + '_',
  };
}

exports.handler = async (event = {}) => {
  if (event.describe) return { markdown: documentation };
  const original = event.widgetContext?.params?.original;
  const view = event.view || (typeof original === 'object' ? original.view : undefined) || 'top-content';
  const definition = queries[view];
  if (!definition) return { markdown: 'Unknown analytics view: ' + escapeCell(view) };

  try {
    const started = await client.send(new StartQueryExecutionCommand({
      QueryString: definition.query,
      QueryExecutionContext: { Database: process.env.DATABASE_NAME },
      ResultReuseConfiguration: {
        ResultReuseByAgeConfiguration: { Enabled: true, MaxAgeInMinutes: 60 },
      },
      WorkGroup: process.env.WORKGROUP_NAME,
    }));
    const executionId = started.QueryExecutionId;
    const deadline = Date.now() + 12000;
    let execution;
    while (Date.now() < deadline) {
      execution = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: executionId }));
      const state = execution.QueryExecution?.Status?.State;
      if (state === 'SUCCEEDED') break;
      if (state === 'FAILED' || state === 'CANCELLED') {
        throw new Error(execution.QueryExecution?.Status?.StateChangeReason || state);
      }
      await sleep(250);
    }
    if (execution?.QueryExecution?.Status?.State !== 'SUCCEEDED') {
      return { markdown: 'Athena is still preparing this view. Refresh the dashboard shortly.' };
    }
    const results = await client.send(new GetQueryResultsCommand({
      MaxResults: definition.maxRows + 1,
      QueryExecutionId: executionId,
    }));
    const reused = Boolean(execution.QueryExecution?.Statistics?.ResultReuseInformation?.ReusedPreviousResult);
    return markdownTable(definition, results.ResultSet?.Rows || [], reused);
  } catch (error) {
    console.error('Analytics widget query failed', error);
    return { markdown: '**Analytics query failed:** ' + escapeCell(error?.message || error) };
  }
};
`;
}
