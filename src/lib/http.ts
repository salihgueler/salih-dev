import { canonicalUrl, contentSignal, markdownAlternatePath } from "./discovery";

export function markdownResponse(
  markdown: string,
  canonicalPath: string,
): Response {
  const alternate = markdownAlternatePath(canonicalPath);
  const links = [
    `<${canonicalUrl(canonicalPath)}>; rel="canonical"; type="text/html"`,
  ];

  if (alternate) {
    links.push(
      `<${canonicalUrl(alternate)}>; rel="alternate"; type="text/markdown"`,
    );
  }

  return new Response(markdown, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Language": "en",
      "Content-Signal": contentSignal,
      "Content-Type": "text/markdown; charset=utf-8",
      Link: links.join(", "),
      "Referrer-Policy": "strict-origin-when-cross-origin",
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function jsonResponse(
  value: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  headers.set("Content-Signal", contentSignal);
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    ...init,
    headers,
  });
}

export function unavailableProblem(
  capability: string,
  instance: string,
  detail: string,
): Response {
  return jsonResponse(
    {
      type: "https://salih.dev/problems/capability-unavailable",
      title: "Capability unavailable",
      status: 501,
      detail,
      instance,
      capability,
      available: false,
      documentation: "https://salih.dev/api/catalog.json",
    },
    {
      status: 501,
      headers: {
        "Content-Type": "application/problem+json; charset=utf-8",
      },
    },
  );
}
