import assert from "node:assert/strict";
import test from "node:test";

import type { APIGatewayProxyEventV2WithIAMAuthorizer } from "aws-lambda";

import { handleModeration } from "../functions/comment-moderation";
import { handleComments, type CommentsDeps } from "../functions/comments";
import type { PublicApiEvent } from "../functions/public-api-shared";

const VID = "528050ac-b123-46e7-b903-8ce4e7972a90";
const ID = "20261001T120000Z-0000abcd";

function event(overrides: Partial<PublicApiEvent> = {}): PublicApiEvent {
  return {
    rawPath: "/api/comments/my-post",
    headers: {},
    cookies: [`vid=${VID}`],
    body: JSON.stringify({ name: "Ada", body: "Nice post." }),
    isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
    ...overrides,
  };
}

type Sent = string[];

/** A fake DynamoDB client: records command names, answers the store's reads. */
function deps(
  options: { flag?: boolean; exists?: boolean; limited?: boolean; fail?: boolean; notifyFails?: boolean } = {},
): CommentsDeps & { sent: Sent; notified: number } {
  const sent: Sent = [];
  const result = {
    sent,
    notified: 0,
    flagOn: async () => options.flag ?? true,
    postExists: async () => options.exists ?? true,
    notify: async () => {
      result.notified += 1;
      if (options.notifyFails) throw new Error("sns down");
    },
    store: {
      tableName: "t",
      now: () => Date.UTC(2026, 9, 1, 12),
      client: {
        send: (async (command: { constructor: { name: string } }) => {
          const name = command.constructor.name;
          sent.push(name);
          if (options.fail) throw new Error("ddb down");
          if (name === "UpdateItemCommand" && options.limited) {
            const { ConditionalCheckFailedException } = await import("@aws-sdk/client-dynamodb");
            throw new ConditionalCheckFailedException({ message: "limit", $metadata: {} });
          }
          if (name === "QueryCommand") {
            return {
              Items: [
                { sk: { S: `c#${ID}` }, name: { S: "Ada" }, body: { S: "Hi" }, createdAt: { S: "2026-10-01T12:00:00.000Z" } },
              ],
            };
          }
          return {};
        }) as never,
      },
    },
  };
  return result;
}

test("a valid comment is stored as pending, answers 202 and notifies", async () => {
  const d = deps();
  const result = await handleComments(event(), d);
  assert.equal(result.statusCode, 202);
  assert.deepEqual(JSON.parse(String(result.body)), { status: "pending" });
  assert.deepEqual(d.sent, ["UpdateItemCommand", "PutItemCommand"]);
  assert.equal(d.notified, 1);
});

test("a failed notification does not fail the submission", async () => {
  const d = deps({ notifyFails: true });
  assert.equal((await handleComments(event(), d)).statusCode, 202);
});

test("GET returns only what the approved query returns", async () => {
  const result = await handleComments(
    event({ requestContext: { http: { method: "GET" } }, body: undefined }),
    deps(),
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(String(result.body)), {
    comments: [{ id: ID, name: "Ada", body: "Hi", createdAt: "2026-10-01T12:00:00.000Z" }],
  });
});

test("the flag off is a 404 for GET and POST, with no store calls", async () => {
  for (const method of ["GET", "POST"]) {
    const d = deps({ flag: false });
    const result = await handleComments(event({ requestContext: { http: { method } } }), d);
    assert.equal(result.statusCode, 404, method);
    assert.deepEqual(d.sent, [], method);
  }
});

test("the honeypot looks like success and stores nothing", async () => {
  const d = deps();
  const result = await handleComments(
    event({ body: JSON.stringify({ body: "buy now", website: "http://spam" }) }),
    d,
  );
  assert.equal(result.statusCode, 202);
  assert.deepEqual(d.sent, []);
  assert.equal(d.notified, 0);
});

test("over the hourly limit is a 429 and stores nothing", async () => {
  const d = deps({ limited: true });
  const result = await handleComments(event(), d);
  assert.equal(result.statusCode, 429);
  assert.deepEqual(d.sent, ["UpdateItemCommand"]);
});

test("invalid input is a 400 with the reason", async () => {
  const result = await handleComments(event({ body: JSON.stringify({ body: "   " }) }), deps());
  assert.equal(result.statusCode, 400);
  assert.deepEqual(JSON.parse(String(result.body)), { message: "comment is required" });
  for (const body of ["", "not json", "[]", "x".repeat(9000)]) {
    assert.equal((await handleComments(event({ body }), deps())).statusCode, 400, body.slice(0, 10));
  }
});

test("no vid, an unknown post or a bad path are rejected", async () => {
  assert.equal((await handleComments(event({ cookies: [] }), deps())).statusCode, 400);
  assert.equal((await handleComments(event(), deps({ exists: false }))).statusCode, 404);
  assert.equal((await handleComments(event({ rawPath: "/api/comments/../x" }), deps())).statusCode, 404);
  assert.equal(
    (await handleComments(event({ requestContext: { http: { method: "DELETE" } } }), deps())).statusCode,
    405,
  );
});

test("a store failure is a 500 without details", async () => {
  const result = await handleComments(event(), deps({ fail: true }));
  assert.equal(result.statusCode, 500);
  assert.deepEqual(JSON.parse(String(result.body)), { message: "comments unavailable" });
});

// --- moderation ---

const EDITOR = "arn:aws:iam::111111111111:root";

function modEvent(
  routeKey: string,
  pathParameters: Record<string, string> = {},
  callerArn = EDITOR,
): APIGatewayProxyEventV2WithIAMAuthorizer {
  return {
    routeKey,
    pathParameters,
    headers: {},
    requestContext: {
      requestId: "r1",
      authorizer: { iam: { userArn: callerArn } },
    },
  } as unknown as APIGatewayProxyEventV2WithIAMAuthorizer;
}

function modStore(found = true) {
  const sent: string[] = [];
  return {
    sent,
    deps: {
      store: {
        tableName: "t",
        now: () => Date.UTC(2026, 9, 1, 12),
        client: {
          send: (async (command: { constructor: { name: string } }) => {
            sent.push(command.constructor.name);
            if (command.constructor.name === "GetItemCommand") {
              return found
                ? { Item: { slug: { S: "my-post" }, name: { S: "Ada" }, body: { S: "Hi" }, createdAt: { S: "t" } } }
                : {};
            }
            if (command.constructor.name === "QueryCommand") return { Items: [] };
            return {};
          }) as never,
        },
      },
    },
  };
}

test("moderation refuses anyone but the editor", async () => {
  process.env.CONTENT_ALLOWED_CALLER_ARNS = EDITOR;
  const { deps: d, sent } = modStore();
  const result = await handleModeration(
    modEvent("POST /v1/comments/pending/{commentId}/approval", { commentId: ID }, "arn:aws:iam::111111111111:user/other"),
    d,
  );
  assert.equal((result as { statusCode: number }).statusCode, 403);
  assert.deepEqual(sent, []);
});

test("the editor can list, approve, reject and remove", async () => {
  process.env.CONTENT_ALLOWED_CALLER_ARNS = EDITOR;
  const cases: Array<[string, Record<string, string>, string[]]> = [
    ["GET /v1/comments/pending", {}, ["QueryCommand"]],
    ["POST /v1/comments/pending/{commentId}/approval", { commentId: ID }, ["GetItemCommand", "TransactWriteItemsCommand"]],
    ["DELETE /v1/comments/pending/{commentId}", { commentId: ID }, ["DeleteItemCommand"]],
    ["DELETE /v1/comments/{slug}/{commentId}", { slug: "my-post", commentId: ID }, ["DeleteItemCommand"]],
  ];
  for (const [route, params, expected] of cases) {
    const { deps: d, sent } = modStore();
    const result = await handleModeration(modEvent(route, params), d);
    assert.equal((result as { statusCode: number }).statusCode, 200, route);
    assert.deepEqual(sent, expected, route);
  }
});

test("approving a comment that is gone is a 404; a malformed id is a 400", async () => {
  process.env.CONTENT_ALLOWED_CALLER_ARNS = EDITOR;
  const gone = await handleModeration(
    modEvent("POST /v1/comments/pending/{commentId}/approval", { commentId: ID }),
    modStore(false).deps,
  );
  assert.equal((gone as { statusCode: number }).statusCode, 404);
  const bad = await handleModeration(
    modEvent("DELETE /v1/comments/pending/{commentId}", { commentId: "../x" }),
    modStore().deps,
  );
  assert.equal((bad as { statusCode: number }).statusCode, 400);
});
