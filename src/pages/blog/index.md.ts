import type { APIRoute } from "astro";

import { markdownResponse } from "../../lib/http";
import { markdownForPath } from "../../lib/markdown-documents";

export const GET: APIRoute = async () =>
  markdownResponse((await markdownForPath("/blog/")) ?? "", "/blog/");
