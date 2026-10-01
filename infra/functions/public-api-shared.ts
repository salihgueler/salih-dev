import { HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

/**
 * What the public, flag-gated APIs behind CloudFront share: the readers API
 * (reader-counts) and the comments API (comments).
 *
 * The flag read and the `vid` parsing repeat src/lib/flags.ts and
 * src/lib/vid-cookie.ts on purpose. Those are ES modules and this package is
 * CommonJS, so it can import their types but not their code.
 */

/** Post ids are lowercase words, digits and hyphens (the Astro collection ids). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 200;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const FLAG_TIMEOUT_MS = 300;
const POST_CACHE_MS = 5 * 60 * 1000;

export type PublicApiEvent = Pick<
  APIGatewayProxyEventV2,
  "rawPath" | "headers" | "cookies" | "body" | "isBase64Encoded"
> & {
  requestContext: { http: { method: string } };
};

/** The `vid` from the event's cookies, or null when absent or malformed. */
export function vidFromEvent(event: PublicApiEvent): string | null {
  const parts = [
    ...(event.cookies ?? []),
    ...(event.headers?.cookie ?? "").split(";"),
  ];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("vid=")) continue;
    const value = trimmed.slice(4).trim();
    if (UUID_V4.test(value)) return value;
  }
  return null;
}

/** The post slug from `<prefix><slug>`, or null when it isn't one. */
export function slugAfterPrefix(rawPath: string, prefix: string): string | null {
  if (!rawPath.startsWith(prefix)) return null;
  const slug = rawPath.slice(prefix.length).replace(/\/$/, "");
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return null;
  return SLUG.test(slug) ? slug : null;
}

/** The request body as text, decoding base64 when API Gateway encoded it. */
export function bodyText(event: PublicApiEvent): string {
  if (event.body === undefined || event.body === "") return "";
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

/** Reads one flag from the AppConfig Agent extension. Any failure is off. */
export async function readFlagFromAgent(key: string, vid: string): Promise<boolean> {
  const application = process.env.APPCONFIG_APPLICATION ?? "";
  const environment = process.env.APPCONFIG_ENVIRONMENT ?? "";
  const profile = process.env.APPCONFIG_PROFILE ?? "";
  if (application === "" || environment === "" || profile === "") return false;
  const url =
    `http://localhost:2772/applications/${encodeURIComponent(application)}` +
    `/environments/${encodeURIComponent(environment)}` +
    `/configurations/${encodeURIComponent(profile)}` +
    `?flag=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLAG_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Context: `vid=${vid}` },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    // A single-flag read returns the flag's attributes at the top level.
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { enabled?: unknown }).enabled === true
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const postCache = new Map<string, { exists: boolean; until: number }>();
let s3Client: S3Client | null = null;

/** Whether `posts/<slug>.md` exists in the content bucket, cached for 5 minutes. */
export async function postExistsInBucket(slug: string): Promise<boolean> {
  const cached = postCache.get(slug);
  if (cached !== undefined && cached.until > Date.now()) return cached.exists;
  s3Client ??= new S3Client({});
  let exists: boolean;
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: process.env.CONTENT_BUCKET_NAME,
        Key: `posts/${slug}.md`,
      }),
    );
    exists = true;
  } catch (error) {
    if (!(error instanceof NotFound)) throw error;
    exists = false;
  }
  postCache.set(slug, { exists, until: Date.now() + POST_CACHE_MS });
  return exists;
}
