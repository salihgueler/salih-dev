import type { APIRoute } from "astro";

import { capabilities } from "../../lib/capabilities";
import { jsonResponse } from "../../lib/http";

export const GET: APIRoute = () =>
  jsonResponse({
    schemaVersion: "1.0",
    site: "https://salih.dev",
    policy: {
      search: true,
      aiInput: true,
      aiTraining: false,
    },
    representations: {
      html: "https://salih.dev/",
      markdown: "https://salih.dev/index.md",
      conciseCorpus: "https://salih.dev/llms.txt",
      fullCorpus: "https://salih.dev/llms-full.txt",
    },
    capabilities,
  });
