import type { APIRoute } from "astro";

import { getCategoryStaticPaths } from "../../lib/content";
import { markdownResponse } from "../../lib/http";
import { markdownForPath } from "../../lib/markdown-documents";

export const getStaticPaths = getCategoryStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const canonicalPath = `/categories/${params.category}/`;
  const markdown = await markdownForPath(canonicalPath);

  return markdown
    ? markdownResponse(markdown, canonicalPath)
    : new Response("Category not found\n", { status: 404 });
};
