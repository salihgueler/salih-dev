import type { APIRoute } from "astro";

import { jsonResponse } from "../../lib/http";
import { WEBMCP_TOOLS } from "../../lib/webmcp/tool-catalog";

export const GET: APIRoute = () =>
  jsonResponse({
    name: "salih.dev",
    version: "2.0.0",
    available: true,
    registration: "document.modelContext.registerTool",
    specification: "https://webmachinelearning.github.io/webmcp/",
    note:
      "Every page registers read-only tools for Salih Güler's blog posts, talks, and speaking events when the browser supports WebMCP. Input schemas are available from document.modelContext. No tool sends data anywhere or changes anything outside the open page.",
    tools: WEBMCP_TOOLS,
    data: "https://salih.dev/api/webmcp-index.json",
    catalog: "https://salih.dev/api/catalog.json",
  });
