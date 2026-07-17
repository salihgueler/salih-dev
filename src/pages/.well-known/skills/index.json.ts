import type { APIRoute } from "astro";

import { jsonResponse } from "../../../lib/http";

export const GET: APIRoute = () =>
  jsonResponse({
    version: "1.0.0",
    skills: [
      {
        name: "read-salih-dev",
        description:
          "Read and cite public posts from salih.dev using Markdown representations.",
        url: "https://salih.dev/skills/read-salih-dev/SKILL.md",
        status: "available",
      },
    ],
  });
