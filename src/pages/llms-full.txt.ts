import type { APIRoute } from "astro";

import { getPublishedPosts } from "../lib/content";
import { contentSignal } from "../lib/discovery";
import { markdownForPath } from "../lib/markdown-documents";

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const documents = await Promise.all([
    markdownForPath("/"),
    markdownForPath("/about/"),
    markdownForPath("/contact/"),
    ...posts.map((post) => markdownForPath(`/blog/${post.id}/`)),
  ]);

  return new Response(
    documents
      .filter((document): document is string => document !== null)
      .join("\n\n---\n\n"),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Signal": contentSignal,
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
};
