import type { APIRoute } from "astro";

import { site } from "../config/site";
import { getPublishedPosts, postUrl, slugify } from "../lib/content";

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const categories = new Set(posts.map((post) => post.data.category));
  const tags = new Set(posts.flatMap((post) => post.data.tags));
  const entries = [
    { path: "/", lastmod: posts[0]?.data.updatedDate ?? posts[0]?.data.pubDate },
    { path: "/blog/", lastmod: posts[0]?.data.updatedDate ?? posts[0]?.data.pubDate },
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
    .map(
      (entry) => [
        "  <url>",
        `    <loc>${escapeXml(new URL(entry.path, site.url).toString())}</loc>`,
        entry.lastmod
          ? `    <lastmod>${entry.lastmod.toISOString().slice(0, 10)}</lastmod>`
          : null,
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n"),
    )
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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
