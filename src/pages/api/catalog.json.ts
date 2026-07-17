import type { APIRoute } from "astro";

import { capabilities } from "../../lib/capabilities";
import { jsonResponse } from "../../lib/http";

export const GET: APIRoute = () =>
  jsonResponse({
    name: "salih.dev public API catalog",
    version: "1.0.0",
    baseUrl: "https://salih.dev",
    authentication: "none",
    openapi: "https://salih.dev/api/openapi.json",
    capabilities,
  });
