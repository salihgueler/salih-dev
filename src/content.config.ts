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
  }),
});

export const collections = { blog };
