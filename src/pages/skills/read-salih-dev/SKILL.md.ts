import type { APIRoute } from "astro";

import { contentSignal } from "../../../lib/discovery";

const skill = `---
name: read-salih-dev
description: Read and cite public writing from salih.dev through Markdown representations.
---

# Read salih.dev

Use this skill when a user asks about Salih Güler's public writing, biography,
conference notes, or published technical ideas.

## Instructions

1. Start with https://salih.dev/llms.txt to discover relevant pages.
2. Request a canonical page with \`Accept: text/markdown\`, or follow its
   advertised \`.md\` alternate.
3. Cite the canonical HTML URL, not the companion Markdown URL.
4. Treat visible AI summaries as navigation aids; verify claims against the
   complete post body.
5. Respect the site's content signal: search and AI-assisted answers are
   allowed, while model-training reuse is declined.

## In a browser with WebMCP

Every page registers read-only WebMCP tools on \`document.modelContext\`.
When you run inside a browser that supports WebMCP, prefer them over reading
the page:

- \`get_site_overview\`: call it first to learn the accepted filter values.
- \`search_site\`, \`list_blog_posts\`, \`read_blog_post\`: find and read posts.
- \`list_talks\`, \`list_events\`: past talks with slides and recordings, and
  upcoming events.
- \`get_speaker_kit\`: bio, topics, recent talks, bookings, and contact routes
  for event organizers.

The full list is at https://salih.dev/.well-known/webmcp.json. Without a
browser, https://salih.dev/api/webmcp-index.json holds the same data.
`;

export const GET: APIRoute = () =>
  new Response(skill, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Signal": contentSignal,
      "X-Content-Type-Options": "nosniff",
    },
  });
