import type { APIRoute } from "astro";

import { site } from "../config/site";
import { getPublishedPosts, postUrl } from "../lib/content";
import { contentSignal } from "../lib/discovery";

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const lines = [
    `# ${site.name}`,
    "",
    `> ${site.description}`,
    "",
    "Use canonical HTML URLs for citations. Request any content page with",
    "`Accept: text/markdown`, or follow its advertised `.md` alternate.",
    "",
    "## Core pages",
    "",
    `- [Home](${site.url}/): Profile, current location, conferences, and latest posts`,
    `- [About](${site.url}/about/): Biography and areas of work`,
    `- [Blog](${site.url}/blog/): Complete post index`,
    `- [Full corpus](${site.url}/llms-full.txt): Combined public Markdown content`,
    `- [API catalog](${site.url}/api/catalog.json): Discovery and capability status`,
    "",
    "## Posts",
    "",
    ...posts.map(
      (post) =>
        `- [${post.data.title}](${new URL(postUrl(post), site.url)}): ${post.data.description}`,
    ),
    "",
    "## Content use",
    "",
    "- Search indexing: allowed",
    "- AI-assisted answers and user-directed retrieval: allowed",
    "- Model training: declined",
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Signal": contentSignal,
      "Cache-Control": "public, max-age=3600",
    },
  });
};
