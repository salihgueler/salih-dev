/**
 * Browser-side WebMCP tool registration.
 *
 * Feature: webmcp
 *
 * Registers read-only tools on `document.modelContext` so an in-browser agent
 * can find Salih's posts, talks, and events by calling declared tools instead
 * of scraping the page. It is a progressive enhancement: in a browser without
 * WebMCP this does nothing at all, and the page is unchanged.
 *
 * Data comes from the baked `/api/webmcp-index.json` (fetched lazily on the
 * first tool call, then reused), and every answer is produced by the pure
 * queries in `./queries.ts`. Agent input is treated as untrusted: each value is
 * re-checked at runtime regardless of the declared schema, because the
 * platform does not promise schema validation.
 */

import {
  findPost,
  listEvents,
  listPosts,
  listTalks,
  normalize,
  searchSite,
  siteOverview,
  speakerKit,
  type ContentType,
} from "./queries";
import type { SiteIndex } from "./site-index";

const INDEX_PATH = "/api/webmcp-index.json";
const MAX_MARKDOWN_CHARS = 60_000;
const CONTENT_TYPES: readonly ContentType[] = ["post", "talk", "event"];

let indexPromise: Promise<SiteIndex> | null = null;

/** Fetches the index once per page; a failed fetch is retried on the next call. */
function loadIndex(signal: AbortSignal): Promise<SiteIndex> {
  indexPromise ??= fetch(INDEX_PATH, { signal, credentials: "omit" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Index request failed (${response.status})`);
      return (await response.json()) as SiteIndex;
    })
    .catch((error: unknown) => {
      indexPromise = null;
      throw error;
    });
  return indexPromise;
}

/** Today's date in UTC, the same clock the home page classifies events with. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function contentTypes(value: unknown): ContentType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const types = CONTENT_TYPES.filter((type) => value.includes(type));
  return types.length > 0 ? types : undefined;
}

const limitSchema = {
  type: "integer",
  minimum: 1,
  maximum: 50,
  description: "Maximum number of results (default 10, at most 50).",
} as const;

const readOnly = { readOnlyHint: true } as const;

async function registerContentTools(context: WebMCP.ModelContext): Promise<void> {
  await context.registerTool({
    name: "get_site_overview",
    title: "Site overview",
    description:
      "Summarize salih.dev: where Salih Güler is right now, how many blog posts, talks, and events it lists, his next event, the latest post, and the exact category, tag, topic, and event-type values the other tools accept as filters. Call this first when you are unsure which filter values exist.",
    inputSchema: { type: "object", properties: {} },
    annotations: readOnly,
    execute: async (_input, { signal }) => siteOverview(await loadIndex(signal), today()),
  });

  await context.registerTool({
    name: "search_site",
    title: "Search posts, talks, and events",
    description:
      "Full-text search across Salih Güler's blog posts, conference talks, and speaking events. Every word in the query must match. Returns the type, title, canonical URL, date, and a short snippet for each hit, best match first.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Words to look for, for example 'flutter amplify' or 'agents'.",
        },
        types: {
          type: "array",
          items: { type: "string", enum: ["post", "talk", "event"] },
          description: "Restrict results to these content types. Omit to search all three.",
        },
        limit: limitSchema,
      },
      required: ["query"],
    },
    annotations: readOnly,
    execute: async (input, { signal }) => {
      const query = optionalString(input.query);
      if (query === undefined) throw new Error("query must be a non-empty string");
      return {
        results: searchSite(await loadIndex(signal), {
          query,
          types: contentTypes(input.types),
          limit: optionalNumber(input.limit),
        }),
      };
    },
  });

  await context.registerTool({
    name: "list_blog_posts",
    title: "List blog posts",
    description:
      "List Salih Güler's published blog posts, newest first. Optionally narrow by category, tag (exact values from get_site_overview), or words in the title, tags, and description. Each post has its canonical URL and a Markdown URL with the full text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to match in the post." },
        category: { type: "string", description: "Exact category name." },
        tag: { type: "string", description: "Exact tag name." },
        limit: limitSchema,
      },
    },
    annotations: readOnly,
    execute: async (input, { signal }) => {
      const posts = listPosts(await loadIndex(signal), {
        query: optionalString(input.query),
        category: optionalString(input.category),
        tag: optionalString(input.tag),
        limit: optionalNumber(input.limit),
      });
      return { count: posts.length, posts };
    },
  });

  await context.registerTool({
    name: "read_blog_post",
    title: "Read a blog post",
    description:
      "Get one blog post by its slug or URL. Returns its metadata and, unless includeMarkdown is false, the full post as Markdown so you can answer questions about it or quote it with a link to the canonical URL.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "The post slug (from list_blog_posts) or its salih.dev URL.",
        },
        includeMarkdown: {
          type: "boolean",
          description: "Include the full Markdown body (default true).",
        },
      },
      required: ["slug"],
    },
    annotations: readOnly,
    execute: async (input, { signal }) => {
      const slug = optionalString(input.slug);
      if (slug === undefined) throw new Error("slug must be a non-empty string");
      const post = findPost(await loadIndex(signal), slug);
      if (post === null) return { found: false, slug };
      if (optionalBoolean(input.includeMarkdown) === false) return { found: true, post };

      // Same-origin path of the Markdown alternate; the canonical URL stays in `post`.
      const response = await fetch(new URL(post.markdownUrl).pathname, {
        signal,
        credentials: "omit",
        headers: { Accept: "text/markdown" },
      });
      if (!response.ok) return { found: true, post, markdownError: response.status };
      const markdown = await response.text();
      return {
        found: true,
        post,
        markdown: markdown.slice(0, MAX_MARKDOWN_CHARS),
        truncated: markdown.length > MAX_MARKDOWN_CHARS,
      };
    },
  });

  await context.registerTool({
    name: "list_talks",
    title: "List past talks",
    description:
      "List conference and community talks Salih Güler has given, newest first, each with the event, date, location, slide deck URL, recording URL when one exists, and source code URL when one exists. Optionally narrow by topic, event type (exact values from get_site_overview), year, whether a recording exists, or words in the title and event.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to match in the talk or event." },
        topic: { type: "string", description: "Exact topic tag, for example 'Flutter'." },
        eventType: { type: "string", description: "Exact event type, for example 'Conference'." },
        year: { type: "integer", description: "Only talks given in this year." },
        hasRecording: {
          type: "boolean",
          description: "true for talks with a video recording, false for talks without one.",
        },
        limit: limitSchema,
      },
    },
    annotations: readOnly,
    execute: async (input, { signal }) => {
      const talks = listTalks(await loadIndex(signal), {
        query: optionalString(input.query),
        topic: optionalString(input.topic),
        eventType: optionalString(input.eventType),
        year: optionalNumber(input.year),
        hasRecording: optionalBoolean(input.hasRecording),
        limit: optionalNumber(input.limit),
      });
      return { count: talks.length, talks };
    },
  });

  await context.registerTool({
    name: "list_events",
    title: "List speaking events",
    description:
      "List the conferences and events where Salih Güler speaks or runs workshops. 'upcoming' (the default) lists events that have not ended yet, soonest first; 'past' lists finished events, most recent first; 'all' lists both. Each event has its dates, city, country, role, and event website.",
    inputSchema: {
      type: "object",
      properties: {
        when: {
          type: "string",
          enum: ["upcoming", "past", "all"],
          description: "Which events to list (default 'upcoming').",
        },
        query: { type: "string", description: "Words to match in the event name, city, or country." },
        limit: limitSchema,
      },
    },
    annotations: readOnly,
    execute: async (input, { signal }) => {
      const when =
        input.when === "past" || input.when === "all" || input.when === "upcoming"
          ? input.when
          : undefined;
      const events = listEvents(
        await loadIndex(signal),
        { when, query: optionalString(input.query), limit: optionalNumber(input.limit) },
        today(),
      );
      return { today: today(), count: events.length, events };
    },
  });

  await context.registerTool({
    name: "get_speaker_kit",
    title: "Speaker kit",
    description:
      "Get what an event organizer needs to invite Salih Güler as a speaker: his role and bio, focus areas, the topics he has spoken on with talk counts, his most recent talks with slide and recording URLs, the events he is already booked for, and how to contact him. Use this when someone wants to invite him, check his availability, or write a speaker introduction.",
    inputSchema: { type: "object", properties: {} },
    annotations: readOnly,
    execute: async (_input, { signal }) => speakerKit(await loadIndex(signal), today()),
  });
}

/**
 * On the Talks page, lets the agent drive the visible filter so the person
 * watching sees the same talks the agent is talking about. It clicks the real
 * filter button, so the page's own controller, status message, and
 * `aria-pressed` state stay the single source of truth.
 */
async function registerTalksPageTool(context: WebMCP.ModelContext): Promise<void> {
  const filter = document.querySelector<HTMLElement>("[data-talks-filter]");
  if (filter === null) return;

  await context.registerTool({
    name: "show_talks_on_page",
    title: "Filter the Talks page",
    description:
      "Apply one of the Talks page's own filters so the visitor sees only matching talks. Pass a topic or event type label exactly as the page shows it (get_site_overview lists them), or 'All talks' to reset. Changes only what is shown on this page.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Filter label, for example 'Flutter' or 'All talks'." },
      },
      required: ["filter"],
    },
    execute: (input) => {
      const wanted = optionalString(input.filter);
      if (wanted === undefined) throw new Error("filter must be a non-empty string");

      const buttons = [
        ...filter.querySelectorAll<HTMLButtonElement>("[data-talk-filter-option]"),
      ];
      const available = buttons.map((button) => (button.textContent ?? "").trim());
      const button = buttons.find(
        (candidate) => normalize(candidate.textContent ?? "") === normalize(wanted),
      );
      if (filter.hidden || button === undefined) {
        return { applied: false, reason: "No filter with that label on this page.", available };
      }

      button.click();
      const result = document.querySelector<HTMLElement>("[data-talks-result]");
      const noMatch = document.querySelector<HTMLElement>("[data-talks-no-match]");
      const visible = document.querySelectorAll("[data-talk-card]:not([hidden])").length;
      return {
        applied: true,
        filter: (button.textContent ?? "").trim(),
        visibleTalks: visible,
        message: (result?.hidden === false ? result.textContent : noMatch?.textContent)?.trim() ?? "",
      };
    },
  });
}

/** Registers every tool this page offers. A no-op without WebMCP support. */
export async function registerWebMcpTools(): Promise<void> {
  const context = document.modelContext;
  if (context === undefined) return;

  try {
    await registerContentTools(context);
    await registerTalksPageTool(context);
  } catch (error: unknown) {
    // A registration failure must never break the page for the human visitor.
    console.warn("WebMCP tool registration failed", error);
  }
}
