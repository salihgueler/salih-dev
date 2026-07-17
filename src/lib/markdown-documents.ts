import type { CollectionEntry } from "astro:content";

import { site } from "../config/site";
import {
  formatDate,
  getPublishedPosts,
  postUrl,
  slugify,
} from "./content";

export async function markdownForPath(pathname: string): Promise<string | null> {
  const path = normalizePath(pathname);
  const posts = await getPublishedPosts();

  if (path === "/") return homeDocument(posts);
  if (path === "/blog/") return archiveDocument("Blog", site.description, posts);
  if (path === "/about/") return aboutDocument();
  if (path === "/contact/") return contactDocument();

  const postMatch = path.match(/^\/blog\/([^/]+)\/$/);
  if (postMatch) {
    const post = posts.find((entry) => entry.id === decodeURIComponent(postMatch[1]));
    return post ? postDocument(post) : null;
  }

  const categoryMatch = path.match(/^\/categories\/([^/]+)\/$/);
  if (categoryMatch) {
    const category = decodeURIComponent(categoryMatch[1]);
    const matches = posts.filter(
      (post) => slugify(post.data.category) === category,
    );
    const title = matches[0]?.data.category ?? category.replaceAll("-", " ");
    return matches.length
      ? archiveDocument(`Category: ${title}`, `Posts filed under ${title}.`, matches)
      : null;
  }

  const tagMatch = path.match(/^\/tags\/([^/]+)\/$/);
  if (tagMatch) {
    const tag = decodeURIComponent(tagMatch[1]);
    const matches = posts.filter((post) =>
      post.data.tags.some((value) => slugify(value) === tag),
    );
    const title =
      matches
        .flatMap((post) => post.data.tags)
        .find((value) => slugify(value) === tag) ?? tag.replaceAll("-", " ");
    return matches.length
      ? archiveDocument(`Tag: ${title}`, `Posts tagged ${title}.`, matches)
      : null;
  }

  return null;
}

function homeDocument(posts: CollectionEntry<"blog">[]): string {
  const conferences = [
    ...site.conferences.upcoming.map(
      (conference) =>
        `- ${conference.href ? `[${conference.name}](${conference.href})` : conference.name}${conference.role ? ` (${conference.role})` : ""}, ${conference.location} — ${conference.date}`,
    ),
    ...site.conferences.recent.map(
      (conference) =>
        `- ${conference.href ? `[${conference.name}](${conference.href})` : conference.name}${conference.role ? ` (${conference.role})` : ""}, ${conference.location} — ${conference.date}`,
    ),
  ];

  return [
    `# ${site.name}`,
    "",
    site.description,
    "",
    `Currently based in ${site.location.city}, ${site.location.country}.`,
    "",
    "## Latest posts",
    "",
    postList(posts),
    "",
    "## Conferences",
    "",
    conferences.join("\n"),
    "",
  ].join("\n");
}

function aboutDocument(): string {
  return [
    `# About ${site.name}`,
    "",
    site.bio.short,
    "",
    ...site.bio.long.flatMap((paragraph) => [paragraph, ""]),
    "## Areas of focus",
    "",
    ...site.focusAreas.map((area) => `- ${area}`),
    "",
  ].join("\n");
}

function contactDocument(): string {
  const socialLinks = site.socials.map(
    (social) => `- [${social.label}](${social.href})`,
  );

  return [
    `# Contact ${site.name}`,
    "",
    ...(site.email
      ? [`Email: [${site.email}](mailto:${site.email})`, ""]
      : []),
    "## Social profiles",
    "",
    socialLinks.join("\n"),
    "",
  ].join("\n");
}

function archiveDocument(
  title: string,
  description: string,
  posts: CollectionEntry<"blog">[],
): string {
  return [`# ${title}`, "", description, "", postList(posts), ""].join("\n");
}

function postList(posts: CollectionEntry<"blog">[]): string {
  return posts
    .map((post) =>
      [
        `## [${post.data.title}](${new URL(postUrl(post), site.url)})`,
        "",
        `${formatDate(post.data.pubDate)} · ${post.data.category}`,
        "",
        post.data.description,
        "",
        `> Summary: ${post.data.aiSummary}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function postDocument(post: CollectionEntry<"blog">): string {
  const body = replaceYouTubeDirectives(post.body ?? "");
  const tags = post.data.tags.map((tag) => `#${tag}`).join(", ");
  const sources = [
    ...(post.data.originalUrl
      ? [{ name: "DEV Community", url: post.data.originalUrl }]
      : []),
    ...post.data.sources,
  ];

  return [
    `# ${post.data.title}`,
    "",
    post.data.description,
    "",
    `Published: ${formatDate(post.data.pubDate)}`,
    post.data.updatedDate
      ? `Updated: ${formatDate(post.data.updatedDate)}`
      : null,
    `Category: ${post.data.category}`,
    `Tags: ${tags}`,
    ...sources.map(
      (source) => `Also published on ${source.name}: ${source.url}`,
    ),
    "",
    `> Summary: ${post.data.aiSummary}`,
    "",
    body.trim(),
    "",
    `Canonical: ${new URL(postUrl(post), site.url)}`,
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function replaceYouTubeDirectives(markdown: string): string {
  return markdown.replace(
    /::youtube\{id="([A-Za-z0-9_-]{11})"(?:\s+title="([^"]+)")?\}/g,
    (_, id: string, title?: string) =>
      `[${title ?? "Watch video"}](https://www.youtube.com/watch?v=${id})`,
  );
}

function normalizePath(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}
