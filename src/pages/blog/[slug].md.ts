import type { APIRoute } from "astro";

import { getPostStaticPaths } from "../../lib/content";
import { markdownResponse } from "../../lib/http";
import { markdownForPath } from "../../lib/markdown-documents";
import { PRERENDER_DYNAMIC_ROUTE } from "../../lib/dynamic-route";

export const prerender = PRERENDER_DYNAMIC_ROUTE;
export const getStaticPaths = getPostStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const canonicalPath = `/blog/${params.slug}/`;
  const markdown = await markdownForPath(canonicalPath);

  return markdown
    ? markdownResponse(markdown, canonicalPath)
    : new Response("Post not found\n", { status: 404 });
};
