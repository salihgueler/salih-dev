import type { APIRoute } from "astro";

import { jsonResponse } from "../../lib/http";

export const GET: APIRoute = () =>
  jsonResponse({
    name: "salih.dev",
    version: "1.0.0",
    available: false,
    tools: [],
    reason:
      "This read-only personal site does not expose browser actions or transactional tools.",
    catalog: "https://salih.dev/api/catalog.json",
  });
