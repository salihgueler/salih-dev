import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

import { blogPostSchema } from "./lib/blog/schema";
import type { TalkCriterion, TalkFrontmatter } from "./lib/talks/model";
import { validateTalkCandidate } from "./lib/talks/validation";

// The same schema validates posts read from S3 at request time, so the build
// and the render Lambda accept exactly the same posts.
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: blogPostSchema,
});

/*
 * Talks collection.
 *
 * Feature: talks-section
 *
 * The schema is the first Build_Validation gate for author-managed talk
 * records. It owns two responsibilities and delegates everything else:
 *
 * 1. Shape. Zod rejects unknown frontmatter keys, missing required fields, and
 *    wrong scalar/array/boolean shapes, and applies the `draft` default.
 * 2. Meaning. Every value rule (code-point lengths, real calendar dates,
 *    credential-free HTTPS URLs, supported video providers, event-type
 *    cardinality and canonical uniqueness, safe slide paths) is delegated to
 *    the pure validators in `src/lib/talks/validation.ts` so the schema, the
 *    validated read gateway, and the property tests share one implementation.
 *
 * Every diagnostic names the acceptance criterion it violates, and the schema
 * only reads candidate values: it never normalizes or rewrites the source
 * record. Normalization happens later, in the validated read gateway.
 */

/** Placeholder record ID: schema-time diagnostics are keyed by field, and
 * Astro already reports the offending source file. */
const SCHEMA_RECORD_ID = "talk";

/** Renders one author-facing message that names the violated criterion. */
function criterionMessage(criterion: TalkCriterion, detail: string): string {
  return `[Requirement ${criterion}] ${detail}`;
}

/** Shape-level messages. Value-level messages come from the pure validators. */
const shapeMessages = {
  title: criterionMessage(
    "2.1",
    "title must be present exactly once as a single text value",
  ),
  eventName: criterionMessage(
    "2.2",
    "eventName must be present exactly once as a single text value",
  ),
  date: criterionMessage(
    "2.3",
    "date must be present exactly once as a single quoted YYYY-MM-DD text value",
  ),
  location: criterionMessage(
    "2.4",
    "location must be present exactly once as a single text value",
  ),
  eventUrl: criterionMessage(
    "2.5",
    "eventUrl must be present exactly once as a single text value",
  ),
  eventTypes: criterionMessage(
    "2.6",
    "eventTypes must be present exactly once as a list of text values",
  ),
  eventType: criterionMessage("2.6", "each eventTypes value must be text"),
  tags: criterionMessage(
    "2.11",
    "tags must be omitted or supplied once as a list of text values",
  ),
  tag: criterionMessage("2.11", "each tags value must be text"),
  slides: criterionMessage(
    "6.7",
    "slides must reference exactly one root-relative PDF path, not a list or object",
  ),
  videoUrl: criterionMessage(
    "2.8",
    "videoUrl must be omitted entirely or supplied once as a single text value",
  ),
  sourceCodeUrl: criterionMessage(
    "2.10",
    "sourceCodeUrl must be omitted entirely or supplied once as a single text value",
  ),
  draft: criterionMessage("2.9", "draft must be true or false"),
  unknownKey: criterionMessage(
    "2.9",
    "talk records may only contain the approved talk fields",
  ),
} as const;

/**
 * Collects the top-level field names that already produced a shape issue, so
 * the value-level pass does not report the same field twice.
 */
function fieldsWithShapeIssues(
  issues: readonly { readonly path?: PropertyKey[] | undefined }[],
): ReadonlySet<string> {
  const fields = new Set<string>();

  for (const issue of issues) {
    const key = issue.path?.[0];
    if (typeof key === "string") fields.add(key);
  }

  return fields;
}

const talkSchema = z
  .strictObject(
    {
      title: z.string({ error: shapeMessages.title }),
      eventName: z.string({ error: shapeMessages.eventName }),
      date: z.string({ error: shapeMessages.date }),
      location: z.string({ error: shapeMessages.location }),
      eventUrl: z.string({ error: shapeMessages.eventUrl }),
      eventTypes: z.array(z.string({ error: shapeMessages.eventType }), {
        error: shapeMessages.eventTypes,
      }),
      tags: z
        .array(z.string({ error: shapeMessages.tag }), {
          error: shapeMessages.tags,
        })
        .optional(),
      slides: z.string({ error: shapeMessages.slides }),
      videoUrl: z.string({ error: shapeMessages.videoUrl }).optional(),
      sourceCodeUrl: z
        .string({ error: shapeMessages.sourceCodeUrl })
        .optional(),
      draft: z.boolean({ error: shapeMessages.draft }).default(false),
    },
    { error: shapeMessages.unknownKey },
  )
  .superRefine(
    (candidate, ctx) => {
      const alreadyReported = fieldsWithShapeIssues(ctx.issues);

      for (const issue of validateTalkCandidate(candidate, SCHEMA_RECORD_ID)) {
        if (issue.field !== "record" && alreadyReported.has(issue.field)) {
          continue;
        }

        ctx.addIssue({
          code: "custom",
          path: issue.field === "record" ? [] : [issue.field],
          message: criterionMessage(issue.criterion, issue.message),
          continue: true,
        });
      }
    },
    // Always run the value-level pass so one build reports every invalid
    // field, not just the first class of failure the Author has to fix.
    { when: () => true },
  );

/**
 * Compile-time proof that the schema still produces the approved author-facing
 * record contract.
 */
type AssertAssignable<Expected, Actual extends Expected> = Actual;
type TalkSchemaContract = AssertAssignable<
  TalkFrontmatter,
  z.output<typeof talkSchema>
>;
export type TalkSchemaOutput = TalkSchemaContract;

const talks = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/talks" }),
  schema: talkSchema,
});

export const collections = { blog, talks };
