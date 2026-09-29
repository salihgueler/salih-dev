/**
 * Request-time renderer for salih.dev's dynamic routes.
 *
 * Feature: backend-served-content
 *
 * This handler is the CloudFront render origin. It wraps the Astro SSR server
 * built by the official `@astrojs/node` adapter (middleware mode) and serves the
 * dynamic routes on request: home, `/talks/`, the blog index, posts, categories
 * and tags (each with its `.md` alternate), `rss.xml`, `sitemap.xml`,
 * `llms.txt` and `llms-full.txt`. The Astro middleware bundled into that
 * server reads the content
 * bucket and renders the same `.astro` pages the static build uses, so the
 * request-time output matches the baked output for the same content while a
 * content write goes live in seconds through a scoped CloudFront invalidation.
 *
 * The Astro Node adapter exposes a Node `http`-style `handler(req, res)`. This
 * module bridges the API Gateway v2 event to a minimal `IncomingMessage` and
 * captures the `ServerResponse` writes, then returns an API Gateway result.
 * Only GET/HEAD reach this origin, so no request body is bridged. The server
 * bundle and its client assets are packaged next to this file by the CDK
 * bundling step, so the import is resolved from the deployment package.
 *
 * It is strictly read-only. The S3 reads live in the bundled Astro middleware
 * and use only `s3:GetObject` on the site content object, `talks/records/` and
 * `posts/`, plus `s3:ListBucket` scoped to `talks/records/`, `talks/decks/` and
 * `posts/`. This handler performs no AWS call itself.
 */

import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Handler,
} from "aws-lambda";

// Resolved from the deployment package: the CDK bundling step places the Astro
// SSR server built with `SALIH_DEV_SSR=1` at `./server/entry.mjs` next to this
// handler. The dynamic import keeps module evaluation (and its top-level Astro
// wiring) inside the handler's async context.
type NodeHandler = (
  req: unknown,
  res: unknown,
  next?: (error?: unknown) => void,
) => void | Promise<void>;

let serverHandler: NodeHandler | null = null;

// Resolved at runtime from the deployment package, never at type-check time: the
// CDK bundling step places the built Astro SSR server at `./server/entry.mjs`
// next to this handler, so the module does not exist in the source tree that tsc
// sees. The specifier is held in a variable so tsc does not try to resolve it as
// a static import (it has no type declarations until the SSR build produces it).
const SERVER_ENTRY_SPECIFIER = "./server/entry.mjs";

async function loadServerHandler(): Promise<NodeHandler> {
  if (serverHandler === null) {
    const entry = (await import(SERVER_ENTRY_SPECIFIER)) as {
      handler: NodeHandler;
    };
    serverHandler = entry.handler;
  }
  return serverHandler;
}

/** A minimal `IncomingMessage` the Astro Node adapter can read GET/HEAD from. */
class LambdaRequest extends Readable {
  public readonly url: string;
  public readonly method: string;
  public readonly headers: Record<string, string>;
  public readonly socket: { readonly remoteAddress: string | undefined };

  public constructor(
    method: string,
    url: string,
    headers: Record<string, string>,
    remoteAddress: string | undefined,
  ) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.socket = { remoteAddress };
  }

  public override _read(): void {
    // GET/HEAD carry no body; end the stream immediately.
    this.push(null);
  }
}

/** Captures the Astro Node adapter's response writes for the API Gateway reply. */
class LambdaResponse extends EventEmitter {
  public statusCode = 200;
  public statusMessage = "";
  public readonly req: unknown;
  private readonly chunks: Buffer[] = [];
  private readonly headers = new Map<string, string | string[]>();
  private settled = false;
  private readonly done: (result: CapturedResponse) => void;

  public constructor(req: unknown, done: (result: CapturedResponse) => void) {
    super();
    this.req = req;
    this.done = done;
  }

  public get headersSent(): boolean {
    return this.settled;
  }

  public setHeader(name: string, value: string | string[]): void {
    this.headers.set(name.toLowerCase(), value);
  }

  public getHeader(name: string): string | string[] | undefined {
    return this.headers.get(name.toLowerCase());
  }

  public writeHead(
    statusCode: number,
    headers?: Record<string, string | string[]>,
  ): this {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers ?? {})) {
      this.headers.set(name.toLowerCase(), value);
    }
    return this;
  }

  public write(chunk: unknown, callback?: () => void): boolean {
    if (chunk !== undefined && chunk !== null) {
      this.chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string | Uint8Array),
      );
    }
    if (typeof callback === "function") callback();
    return true;
  }

  public end(chunk?: unknown): this {
    if (chunk !== undefined && chunk !== null) this.write(chunk);
    this.finish();
    return this;
  }

  public destroy(): this {
    this.finish();
    return this;
  }

  private finish(): void {
    if (this.settled) return;
    this.settled = true;
    this.emit("finish");
    this.emit("close");
    this.done({
      statusCode: this.statusCode,
      headers: this.headers,
      body: Buffer.concat(this.chunks),
    });
  }
}

type CapturedResponse = {
  statusCode: number;
  headers: Map<string, string | string[]>;
  body: Buffer;
};

/** Header names whose values are binary-unsafe to return as a UTF-8 string. */
const BINARY_CONTENT = /^(?!text\/|application\/(json|.*\+json|xml|.*\+xml))/i;

/** Splits an API Gateway v2 event into the fields the Node request needs. */
function requestHeaders(event: APIGatewayProxyEventV2): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[name.toLowerCase()] = value;
  }
  // The origin is reached only through CloudFront; give the request a stable
  // host so Astro can build an absolute URL for canonical/alternate links.
  headers.host ??= "salih.dev";
  return headers;
}

/** Turns the captured Node response into an API Gateway v2 result. */
function toApiGatewayResult(
  captured: CapturedResponse,
): APIGatewayProxyResultV2 {
  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  for (const [name, value] of captured.headers) {
    if (name === "set-cookie") {
      cookies.push(...(Array.isArray(value) ? value : [value]));
      continue;
    }
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }

  const contentType = headers["content-type"] ?? "text/html; charset=utf-8";
  const isBinary = BINARY_CONTENT.test(contentType);

  return {
    statusCode: captured.statusCode,
    headers,
    ...(cookies.length > 0 ? { cookies } : {}),
    body: isBinary
      ? captured.body.toString("base64")
      : captured.body.toString("utf8"),
    isBase64Encoded: isBinary,
  };
}

export const handler: Handler<
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2
> = async (event) => {
  const method = event.requestContext.http.method;
  if (method !== "GET" && method !== "HEAD") {
    return { statusCode: 405, headers: { allow: "GET, HEAD" }, body: "" };
  }

  const rawPath = event.rawPath || "/";
  const url =
    event.rawQueryString !== undefined && event.rawQueryString !== ""
      ? `${rawPath}?${event.rawQueryString}`
      : rawPath;

  let nodeHandler: NodeHandler;
  try {
    nodeHandler = await loadServerHandler();
  } catch (error) {
    console.error(JSON.stringify({ route: rawPath, outcome: "load_error" }));
    return { statusCode: 500, body: "render server unavailable" };
  }

  const req = new LambdaRequest(
    method,
    url,
    requestHeaders(event),
    event.requestContext.http.sourceIp,
  );

  return new Promise<APIGatewayProxyResultV2>((resolve) => {
    const res = new LambdaResponse(req, (captured) => {
      const outcome = captured.statusCode < 500 ? "ok" : "render_error";
      console.log(JSON.stringify({ route: rawPath, outcome }));
      resolve(toApiGatewayResult(captured));
    });

    Promise.resolve(
      nodeHandler(req, res, (error?: unknown) => {
        // No Astro route matched the origin request: return a not-found the
        // edge will not cache as a success for a mistargeted path.
        if (error !== undefined && error !== null) {
          console.error(
            JSON.stringify({ route: rawPath, outcome: "middleware_error" }),
          );
          if (!res.headersSent) res.writeHead(500).end("render error");
          return;
        }
        if (!res.headersSent) res.writeHead(404).end("not found");
      }),
    ).catch(() => {
      if (!res.headersSent) {
        console.error(
          JSON.stringify({ route: rawPath, outcome: "render_error" }),
        );
        res.writeHead(502).end("render error");
      }
    });
  });
};
