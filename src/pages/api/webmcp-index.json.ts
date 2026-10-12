import type { APIRoute } from "astro";

import { getSiteContent } from "../../config/site-content";
import { site } from "../../config/site";
import { getPublishedPosts } from "../../lib/content";
import { jsonResponse } from "../../lib/http";
import { getPublishedTalksSnapshot } from "../../lib/talks/gateway-astro";
import { projectTalkArchive } from "../../lib/talks/projection";
import { buildSiteIndex } from "../../lib/webmcp/site-index";

// Static on purpose: the publisher re-bakes this file and invalidates "/*" on
// every content publish, so it tracks the same published snapshots as the
// pages without a render-origin route. Event timing is computed in the browser
// against the visitor's date, so a baked copy never reports a finished event
// as upcoming.
export const GET: APIRoute = async () => {
  const [posts, talks] = await Promise.all([
    getPublishedPosts(),
    getPublishedTalksSnapshot(),
  ]);

  return jsonResponse(
    buildSiteIndex({
      siteName: site.name,
      siteUrl: site.url,
      speaker: {
        role: site.role,
        bioShort: site.bio.short,
        bioLong: site.bio.long,
        focusAreas: site.focusAreas,
        socials: site.socials,
      },
      posts,
      talkCards: projectTalkArchive(talks).cards,
      siteContent: getSiteContent(),
    }),
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
};
