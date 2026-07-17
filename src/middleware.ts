import { defineMiddleware } from "astro:middleware";

import {
  canonicalUrl,
  contentSignal,
  explicitlyPrefersMarkdown,
  markdownAlternatePath,
} from "./lib/discovery";
import { markdownResponse } from "./lib/http";
import { markdownForPath } from "./lib/markdown-documents";

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;

  if (explicitlyPrefersMarkdown(context.request.headers.get("Accept"))) {
    const markdown = await markdownForPath(pathname);
    if (markdown) return markdownResponse(markdown, pathname);
  }

  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("Content-Signal", contentSignal);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const alternate = markdownAlternatePath(pathname);
  const contentType = headers.get("Content-Type") ?? "";
  if (alternate && response.ok && contentType.includes("text/html")) {
    headers.set("Vary", mergeVary(headers.get("Vary"), "Accept"));
    headers.append(
      "Link",
      `<${canonicalUrl(pathname)}>; rel="canonical"; type="text/html"`,
    );
    headers.append(
      "Link",
      `<${canonicalUrl(alternate)}>; rel="alternate"; type="text/markdown"`,
    );
    headers.append(
      "Link",
      `<${canonicalUrl("/api/catalog.json")}>; rel="service-desc"; type="application/json"`,
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});

function mergeVary(current: string | null, value: string): string {
  const values = new Set(
    (current ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  return [...values].join(", ");
}
