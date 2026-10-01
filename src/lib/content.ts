import { getCollection, type CollectionEntry } from "astro:content";

import type { BlogPostData } from "./blog/schema";
import { requestTimePosts } from "./blog/posts-source";

/**
 * One published post as the pages consume it. Both a build-time collection
 * entry and a request-time post (resolved from the content bucket) satisfy this
 * shape, so the blog pages, the listings, and the Markdown serializer read
 * posts the same way in both build shapes. `body` is the raw Markdown, present
 * on both; only `[slug].astro` needs the compiled body, which it resolves
 * through the request-time override in the SSR path.
 */
export type PublishedPost = Readonly<{
  id: string;
  body?: string | undefined;
  data: BlogPostData;
}>;

/**
 * The published posts, newest first, drafts excluded. In the request-time
 * renderer this returns the request-scoped override (resolved from the content
 * bucket's `posts/` prefix); otherwise it reads the Astro `blog` collection the
 * static build bakes. Both paths sort by `pubDate` descending so the order
 * matches.
 */
export async function getPublishedPosts(): Promise<PublishedPost[]> {
  const override = requestTimePosts();
  const posts: PublishedPost[] =
    override !== null
      ? override.filter((post) => !post.data.draft)
      : (await getCollection("blog", ({ data }) => !data.draft)).map(
          (entry: CollectionEntry<"blog">) => ({
            id: entry.id,
            body: entry.body,
            data: entry.data,
          }),
        );
  return posts.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function postUrl(post: PublishedPost): string {
  return `/blog/${post.id}/`;
}

export async function getPostStaticPaths() {
  // Static build only (prerendered). Pass the REAL collection entry as props so
  // the page's build-time `render()` has the entry's render metadata; the
  // request-time renderer never calls this (the routes are prerender=false in
  // the SSR build) and resolves the post from the override instead.
  const entries = (await getCollection("blog", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
  return entries.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}

export async function getCategoryStaticPaths() {
  const posts = await getPublishedPosts();
  const categories = new Set(
    posts.map((post) => slugify(post.data.category)),
  );
  return [...categories].map((category) => ({
    params: { category },
  }));
}

export async function getTagStaticPaths() {
  const posts = await getPublishedPosts();
  const tags = new Set(
    posts.flatMap((post) => post.data.tags.map(slugify)),
  );
  return [...tags].map((tag) => ({
    params: { tag },
  }));
}
