/**
 * The blog post frontmatter schema, standalone.
 *
 * Feature: backend-served-content
 *
 * This lives apart from `src/content.config.ts` so it can be imported without
 * pulling the `astro:content` / `astro/loaders` virtual modules those files
 * evaluate at load time. The Astro `blog` collection imports this schema, and so
 * does the request-time post source (`s3-posts.ts`) and the plain-node unit
 * tests, which is why it must depend only on `astro/zod` (a real package) and
 * nothing Astro-virtual.
 */

import { z } from "astro/zod";

export const blogPostSchema = z.object({
  title: z.string(),
  description: z.string(),
  pubDate: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  hero: z.object({
    src: z.string(),
    alt: z.string(),
    credit: z.string(),
    creditUrl: z.url(),
  }),
  aiSummary: z.string(),
  canonical: z.url().optional(),
  originalUrl: z.url().optional(),
  sources: z
    .array(
      z.object({
        name: z.string(),
        url: z.url(),
      }),
    )
    .default([]),
  draft: z.boolean().default(false),
});

/** The validated shape of one blog post's frontmatter. */
export type BlogPostData = z.output<typeof blogPostSchema>;
