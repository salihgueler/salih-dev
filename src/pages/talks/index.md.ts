import type { APIRoute } from "astro";

import { PRERENDER_DYNAMIC_ROUTE } from "../../lib/dynamic-route";
import { markdownResponse } from "../../lib/http";
import { markdownForPath } from "../../lib/markdown-documents";

// Backend-served-content: the Talks Markdown alternate is served on request in
// the SSR build from the content bucket; the static publisher build bakes it.
// The render Lambda sets the request-scoped published snapshot before this
// route runs, so the served document matches the HTML archive.
export const prerender = PRERENDER_DYNAMIC_ROUTE;

export const GET: APIRoute = async () =>
  markdownResponse((await markdownForPath("/talks/")) ?? "", "/talks/");
