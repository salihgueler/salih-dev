import { getCollection, type CollectionEntry } from "astro:content";

export async function getPublishedPosts(): Promise<CollectionEntry<"blog">[]> {
  const posts = await getCollection("blog", ({ data }) => !data.draft);
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

export function postUrl(post: CollectionEntry<"blog">): string {
  return `/blog/${post.id}/`;
}

export async function getPostStaticPaths() {
  const posts = await getPublishedPosts();
  return posts.map((post) => ({
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
