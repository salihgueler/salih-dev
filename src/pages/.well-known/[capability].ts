import type { APIRoute } from "astro";

import { unavailableCapabilities } from "../../lib/capabilities";
import { jsonResponse, unavailableProblem } from "../../lib/http";

export function getStaticPaths() {
  return [...unavailableCapabilities.entries()]
    .filter(([, capability]) => {
      const relativePath = capability.endpoint.replace("/.well-known/", "");
      return !relativePath.includes("/") && relativePath !== "webmcp.json";
    })
    .map(([capability, details]) => ({
      params: {
        capability: details.endpoint.endsWith(".json")
          ? `${capability}.json`
          : capability,
      },
    }));
}

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
