import type { APIRoute } from "astro";

import { getPublishedPosts } from "../lib/content";
import { contentSignal } from "../lib/discovery";
import { PRERENDER_DYNAMIC_ROUTE } from "../lib/dynamic-route";
import { markdownForPath } from "../lib/markdown-documents";

export const prerender = PRERENDER_DYNAMIC_ROUTE;

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const documents = await Promise.all([
    markdownForPath("/"),
    markdownForPath("/about/"),
    markdownForPath("/contact/"),
    // The Talks Markdown document exactly once, from the same shared published
    // snapshot the archive and the `/talks/index.md` route use.
    markdownForPath("/talks/"),
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
