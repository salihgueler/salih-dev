import type { APIRoute } from "astro";

import { jsonResponse } from "../../../lib/http";

export const GET: APIRoute = () =>
  jsonResponse({
    name: "salih.dev",
    description: "Public personal website and blog.",
    version: "1.0.0",
    status: "unavailable",
    available: false,
    transports: [],
    reason:
      "No MCP server is operated. Pages register read-only WebMCP tools in the browser instead (see webmcp.json), and public content is available through HTML, Markdown negotiation, RSS, and llms.txt.",
    alternatives: [
      "https://salih.dev/.well-known/webmcp.json",
      "https://salih.dev/index.md",
      "https://salih.dev/llms.txt",
      "https://salih.dev/api/catalog.json",
    ],
  });
