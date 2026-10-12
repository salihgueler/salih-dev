/**
 * The public content index the WebMCP tools query.
 *
 * Feature: webmcp
 *
 * The static publisher bakes this index into `/api/webmcp-index.json` from the
 * same published snapshots the pages render (posts, talks, site content), and
 * the publisher re-bakes and invalidates it on every content publish, so the
 * tools never describe content the site does not show.
 *
 * Everything in this module is pure: it projects already-resolved snapshots
 * into plain JSON-serializable records and reads no file, network, or clock.
 * Event classification (upcoming vs past) is deliberately NOT baked here: the
 * index keeps the raw dates and the optional status override, and the query
 * layer classifies against the visitor's current date, so an index baked last
 * week still reports a finished event as past.
 */

import type { SiteContent, SiteEvent } from "../../config/site-content-schema";
import type { BlogPostData } from "../blog/schema";
import type { TalkCardView } from "../talks/projection";

export const SITE_INDEX_VERSION = 2;

export type IndexedPost = Readonly<{
  slug: string;
  title: string;
  description: string;
  summary: string;
  category: string;
  tags: readonly string[];
  publishedOn: string;
  updatedOn: string | null;
  url: string;
  markdownUrl: string;
}>;

export type IndexedTalk = Readonly<{
  id: string;
  title: string;
  eventName: string;
  eventUrl: string;
  date: string;
  location: string;
  eventTypes: readonly string[];
  topics: readonly string[];
  slidesUrl: string;
  videoUrl: string | null;
  sourceCodeUrl: string | null;
}>;

export type IndexedEvent = Readonly<{
  id: string;
  name: string;
  city: string;
  country: string;
  startsOn: string;
  endsOn: string;
  url: string;
  role: string | null;
  status: "upcoming" | "past" | null;
}>;

/** The static profile facts an event organizer needs, from the site config. */
export type IndexedSpeaker = Readonly<{
  role: string;
  bio: string;
  longBio: readonly string[];
  focusAreas: readonly string[];
  aboutUrl: string;
  contactUrl: string;
  profiles: readonly Readonly<{ label: string; url: string }>[];
}>;

export type SiteIndex = Readonly<{
  version: typeof SITE_INDEX_VERSION;
  site: Readonly<{
    name: string;
    url: string;
    currentLocation: Readonly<{ city: string; country: string; updatedOn: string }>;
  }>;
  speaker: IndexedSpeaker;
  posts: readonly IndexedPost[];
  talks: readonly IndexedTalk[];
  events: readonly IndexedEvent[];
}>;

/** One published post as the index builder needs it. */
export type SiteIndexPostInput = Readonly<{ id: string; data: BlogPostData }>;

/** The speaker profile as the site config holds it. */
export type SiteIndexSpeakerInput = Readonly<{
  role: string;
  bioShort: string;
  bioLong: readonly string[];
  focusAreas: readonly string[];
  socials: readonly Readonly<{ label: string; href: string }>[];
}>;

export type SiteIndexInput = Readonly<{
  siteName: string;
  siteUrl: string;
  speaker: SiteIndexSpeakerInput;
  posts: readonly SiteIndexPostInput[];
  talkCards: readonly TalkCardView[];
  siteContent: SiteContent;
}>;

/** Builds the index. Input order is preserved (posts and talks newest first). */
export function buildSiteIndex(input: SiteIndexInput): SiteIndex {
  const absolute = (path: string): string =>
    new URL(path, input.siteUrl).toString();

  return {
    version: SITE_INDEX_VERSION,
    site: {
      name: input.siteName,
      url: absolute("/"),
      currentLocation: {
        city: input.siteContent.location.city,
        country: input.siteContent.location.country,
        updatedOn: input.siteContent.location.updatedOn,
      },
    },
    speaker: {
      role: input.speaker.role,
      bio: input.speaker.bioShort,
      longBio: [...input.speaker.bioLong],
      focusAreas: [...input.speaker.focusAreas],
      aboutUrl: absolute("/about/"),
      contactUrl: absolute("/contact/"),
      profiles: input.speaker.socials.map((social) => ({
        label: social.label,
        url: social.href,
      })),
    },
    posts: input.posts.map((post) => ({
      slug: post.id,
      title: post.data.title,
      description: post.data.description,
      summary: post.data.aiSummary,
      category: post.data.category,
      tags: [...post.data.tags],
      publishedOn: isoDay(post.data.pubDate),
      updatedOn: post.data.updatedDate ? isoDay(post.data.updatedDate) : null,
      url: absolute(`/blog/${post.id}/`),
      markdownUrl: absolute(`/blog/${post.id}.md`),
    })),
    talks: input.talkCards.map((card) => ({
      id: card.id,
      title: card.title,
      eventName: card.eventName,
      eventUrl: card.eventUrl,
      date: card.date,
      location: card.location,
      eventTypes: card.tags.map((tag) => tag.label),
      topics: card.topicTags.map((tag) => tag.label),
      slidesUrl: card.slidePublicUrl,
      videoUrl: card.video?.sourceUrl ?? null,
      sourceCodeUrl: card.sourceCodeUrl,
    })),
    events: input.siteContent.events.map(indexEvent),
  };
}

function indexEvent(event: SiteEvent): IndexedEvent {
  return {
    id: event.id,
    name: event.name,
    city: event.city,
    country: event.country,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    url: event.url,
    role: event.role ?? null,
    status: event.status ?? null,
  };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
