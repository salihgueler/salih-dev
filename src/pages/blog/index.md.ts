import type { APIRoute } from "astro";

import { markdownResponse } from "../../lib/http";
import { markdownForPath } from "../../lib/markdown-documents";
import { PRERENDER_DYNAMIC_ROUTE } from "../../lib/dynamic-route";

export const prerender = PRERENDER_DYNAMIC_ROUTE;

export const GET: APIRoute = async () =>
  markdownResponse((await markdownForPath("/blog/")) ?? "", "/blog/");
