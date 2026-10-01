import rss from "@astrojs/rss";
import type { APIRoute } from "astro";

import { site } from "../config/site";
import { getPublishedPosts, postUrl } from "../lib/content";
import { PRERENDER_DYNAMIC_ROUTE } from "../lib/dynamic-route";

export const prerender = PRERENDER_DYNAMIC_ROUTE;

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();

  return rss({
    title: `${site.name} — Blog`,
    description: site.description,
    site: site.url,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: postUrl(post),
      categories: [post.data.category, ...post.data.tags],
    })),
    customData: `<language>en</language>`,
  });
};
