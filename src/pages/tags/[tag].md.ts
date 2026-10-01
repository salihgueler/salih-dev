import type { APIRoute } from "astro";

import { getTagStaticPaths } from "../../lib/content";
import { markdownResponse } from "../../lib/http";
import { markdownForPath } from "../../lib/markdown-documents";
import { PRERENDER_DYNAMIC_ROUTE } from "../../lib/dynamic-route";

export const prerender = PRERENDER_DYNAMIC_ROUTE;
export const getStaticPaths = getTagStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const canonicalPath = `/tags/${params.tag}/`;
  const markdown = await markdownForPath(canonicalPath);

  return markdown
    ? markdownResponse(markdown, canonicalPath)
    : new Response("Tag not found\n", { status: 404 });
};
