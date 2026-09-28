import type { APIRoute } from "astro";

import { site } from "../config/site";
import { getPublishedPosts, postUrl, slugify } from "../lib/content";
import { getPublishedTalksSnapshot } from "../lib/talks/gateway";

/**
 * One sitemap URL. `lastmod` accepts a `Date` for blog records and an already
 * validated ISO calendar date for talks, whose source value is a date without a
 * time component.
 */
type SitemapEntry = Readonly<{
  path: string;
  lastmod?: Date | string;
}>;

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  // The shared snapshot, so the canonical Talks entry describes the same
  // validated records as the HTML archive and the Markdown alternate.
  const talks = await getPublishedTalksSnapshot();
  const categories = new Set(posts.map((post) => post.data.category));
  const tags = new Set(posts.flatMap((post) => post.data.tags));
  const entries: SitemapEntry[] = [
    {
      path: "/",
      lastmod: posts[0]?.data.updatedDate ?? posts[0]?.data.pubDate,
    },
    {
      path: "/blog/",
      lastmod: posts[0]?.data.updatedDate ?? posts[0]?.data.pubDate,
    },
    // Exactly one canonical Talks URL. The snapshot is newest first, so the
    // first published talk carries the archive's most recent change date, and
    // an empty collection simply omits `lastmod`.
    { path: "/talks/", lastmod: talks[0]?.date },
    { path: "/about/" },
    { path: "/contact/" },
    ...posts.map((post) => ({
      path: postUrl(post),
      lastmod: post.data.updatedDate ?? post.data.pubDate,
    })),
    ...[...categories].map((category) => ({
      path: `/categories/${slugify(category)}/`,
    })),
    ...[...tags].map((tag) => ({ path: `/tags/${slugify(tag)}/` })),
  ];

  const urls = entries
    .map((entry) => {
      const lastmod = formatLastmod(entry.lastmod);

      return [
        "  <url>",
        `    <loc>${escapeXml(new URL(entry.path, site.url).toString())}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
};

/**
 * Renders `lastmod` as a calendar date. Validated talk dates are already
 * `YYYY-MM-DD`, so they are emitted unchanged rather than round-tripped through
 * a timestamp that could shift the day by time zone.
 */
function formatLastmod(lastmod: Date | string | undefined): string | null {
  if (lastmod === undefined) return null;
  if (typeof lastmod === "string") return lastmod;

  return lastmod.toISOString().slice(0, 10);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
