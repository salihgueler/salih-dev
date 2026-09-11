import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

export const CONTENT_KEY = "site/content.v1.json";
export const MAX_CONTENT_BYTES = 64 * 1024;

export function isExpectedEditor(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
): boolean {
  const expected = process.env.CONTENT_EDITOR_ARN;
  const actual = event.requestContext.authorizer.iam.userArn;
  const allowed = Boolean(expected && actual === expected);
  console.log(
    JSON.stringify({
      action: "authorize-content-editor",
      allowed,
      callerArn: actual,
      requestId: event.requestContext.requestId,
    }),
  );
  return allowed;
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    body: JSON.stringify(body),
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
    statusCode,
  };
}

export function requestBody(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
): string | null {
  if (event.body === undefined) return null;
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

export function requestHeader(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(event.headers).find(
    ([key]) => key.toLowerCase() === target,
  )?.[1];
}
