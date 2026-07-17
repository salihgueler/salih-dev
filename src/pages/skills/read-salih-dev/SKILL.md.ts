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
`;

export const GET: APIRoute = () =>
  new Response(skill, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Signal": contentSignal,
      "X-Content-Type-Options": "nosniff",
    },
  });
