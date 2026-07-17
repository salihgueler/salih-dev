import type { APIRoute } from "astro";

import { unavailableCapabilities } from "../../lib/capabilities";
import { jsonResponse, unavailableProblem } from "../../lib/http";

export const GET: APIRoute = ({ params, url }) => {
  const requested = params.capability ?? "";
  const key = requested.replace(/\.json$/, "");
  const capability = unavailableCapabilities.get(key);

  if (!capability) {
    return jsonResponse(
      {
        type: "https://salih.dev/problems/not-found",
        title: "Discovery document not found",
        status: 404,
        instance: url.pathname,
      },
      { status: 404 },
    );
  }

  return unavailableProblem(capability.id, url.pathname, capability.note);
};
