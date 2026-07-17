import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    hero: z.object({
      src: z.url(),
      alt: z.string(),
      credit: z.string(),
      creditUrl: z.url(),
    }),
    aiSummary: z.string(),
    canonical: z.url().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
