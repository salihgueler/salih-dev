import type { APIRoute } from "astro";

import { PRERENDER_DYNAMIC_ROUTE } from "../lib/dynamic-route";
import { markdownResponse } from "../lib/http";
import { markdownForPath } from "../lib/markdown-documents";

// Backend-served-content: the home Markdown alternate is served on request in
// the SSR build so its location and events reflect the content bucket; the
// static publisher build bakes it. The render Lambda sets the request-scoped
// site content before this route runs.
export const prerender = PRERENDER_DYNAMIC_ROUTE;

export const GET: APIRoute = async () =>
  markdownResponse((await markdownForPath("/")) ?? "", "/");
