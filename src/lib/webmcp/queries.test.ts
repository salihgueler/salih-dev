import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  clampLimit,
  eventTiming,
  findPost,
  listEvents,
  listPosts,
  listTalks,
  searchSite,
  siteOverview,
  speakerKit,
} from "./queries.ts";
import type { IndexedEvent, IndexedPost, IndexedTalk, SiteIndex } from "./site-index.ts";
import { WEBMCP_TOOLS } from "./tool-catalog.ts";

function post(slug: string, overrides: Partial<IndexedPost> = {}): IndexedPost {
  return {
    slug,
    title: slug,
    description: "",
    summary: "",
    category: "Mobile",
    tags: [],
    publishedOn: "2026-01-01",
    updatedOn: null,
    url: `https://salih.dev/blog/${slug}/`,
    markdownUrl: `https://salih.dev/blog/${slug}.md`,
    ...overrides,
  };
}

function talk(id: string, overrides: Partial<IndexedTalk> = {}): IndexedTalk {
  return {
    id,
    title: id,
    eventName: "Some Conf",
    eventUrl: "https://example.com/",
    date: "2026-01-01",
    location: "Berlin, Germany",
    eventTypes: ["Conference"],
    topics: [],
    slidesUrl: `https://salih.dev/talks/slides/${id}.pdf`,
    videoUrl: null,
    sourceCodeUrl: null,
    ...overrides,
  };
}

function event(id: string, startsOn: string, endsOn: string, overrides: Partial<IndexedEvent> = {}): IndexedEvent {
  return {
    id,
    name: id,
    city: "Berlin",
    country: "Germany",
    startsOn,
    endsOn,
    url: "https://example.com/",
    role: null,
    status: null,
    ...overrides,
  };
}

const index: SiteIndex = {
  version: 2,
  site: {
    name: "Salih Güler",
    url: "https://salih.dev/",
    currentLocation: { city: "Berlin", country: "Germany", updatedOn: "2026-09-15" },
  },
  speaker: {
    role: "Senior Developer Advocate at AWS",
    bio: "Short bio.",
    longBio: ["Long bio."],
    focusAreas: ["Developer experience"],
    aboutUrl: "https://salih.dev/about/",
    contactUrl: "https://salih.dev/contact/",
    profiles: [{ label: "GitHub", url: "https://github.com/salihgueler" }],
  },
  posts: [
    post("amplify-flutter-auth", {
      title: "Authentication flows on Flutter with AWS Amplify",
      tags: ["Flutter", "AWS Amplify"],
      description: "Sign in and sign up on web and mobile.",
      publishedOn: "2026-03-01",
    }),
    post("agent-tips", {
      title: "7 tips to make your AI agent more predictable",
      category: "AI",
      tags: ["Agents"],
      publishedOn: "2026-02-01",
    }),
    post("flutter-hosting", {
      title: "Hosting Flutter web apps",
      description: "Amplify Hosting and GitHub Actions.",
      tags: ["Flutter"],
      publishedOn: "2025-12-01",
    }),
  ],
  talks: [
    talk("dnd-agents", {
      title: "Building a multi-agent D&D game",
      eventName: "ZürichJS Conf",
      date: "2026-09-10",
      topics: ["Agents", "TypeScript"],
      videoUrl: "https://www.youtube.com/watch?v=abc",
    }),
    talk("flutter-games", {
      title: "Flutter games with Flame",
      date: "2025-06-01",
      topics: ["Flutter"],
      eventTypes: ["Meetup"],
    }),
  ],
  events: [
    event("past-one", "2026-09-08", "2026-09-08"),
    event("running-now", "2026-10-09", "2026-10-11"),
    event("later", "2026-11-04", "2026-11-05", { city: "Casablanca", country: "Morocco" }),
    event("soon", "2026-10-21", "2026-10-23", { city: "Athens", country: "Greece" }),
    event("forced-past", "2026-12-01", "2026-12-01", { status: "past" }),
  ],
};

const TODAY = "2026-10-10";

test("limits default to 10 and clamp to 1..50", () => {
  assert.equal(clampLimit(undefined), 10);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(500), 50);
  assert.equal(clampLimit(3.7), 3);
  assert.equal(clampLimit(Number.NaN), 10);
});

test("search requires every word and ranks title matches first", () => {
  const hits = searchSite(index, { query: "flutter amplify" });
  assert.deepEqual(
    hits.map((hit) => hit.url),
    ["https://salih.dev/blog/amplify-flutter-auth/", "https://salih.dev/blog/flutter-hosting/"],
  );
  assert.deepEqual(searchSite(index, { query: "flutter kotlin" }), []);
  assert.deepEqual(searchSite(index, { query: "   " }), []);
});

test("search matches across content types and honors the type filter", () => {
  const all = searchSite(index, { query: "agents" });
  assert.deepEqual(new Set(all.map((hit) => hit.type)), new Set(["post", "talk"]));
  const talksOnly = searchSite(index, { query: "agents", types: ["talk"] });
  assert.deepEqual(talksOnly.map((hit) => hit.title), ["Building a multi-agent D&D game"]);
  assert.equal(searchSite(index, { query: "athens" })[0]?.type, "event");
});

test("search ignores case and diacritics", () => {
  assert.equal(searchSite(index, { query: "ZURICHJS" })[0]?.title, "Building a multi-agent D&D game");
});

test("posts filter by exact tag and category, newest first", () => {
  assert.deepEqual(
    listPosts(index, { tag: "flutter" }).map((p) => p.slug),
    ["amplify-flutter-auth", "flutter-hosting"],
  );
  assert.deepEqual(listPosts(index, { category: "ai" }).map((p) => p.slug), ["agent-tips"]);
  assert.deepEqual(listPosts(index, { tag: "aws-amplify" }).map((p) => p.slug), ["amplify-flutter-auth"]);
  assert.equal(listPosts(index, { limit: 1 }).length, 1);
});

test("a post is found by slug, canonical URL, or Markdown URL", () => {
  for (const ref of [
    "agent-tips",
    "https://salih.dev/blog/agent-tips/",
    "https://salih.dev/blog/agent-tips.md",
    "/blog/agent-tips/?ref=x",
  ]) {
    assert.equal(findPost(index, ref)?.slug, "agent-tips", ref);
  }
  assert.equal(findPost(index, "missing"), null);
});

test("talks filter by topic, event type, year, and recording", () => {
  assert.deepEqual(listTalks(index, { topic: "agents" }).map((t) => t.id), ["dnd-agents"]);
  assert.deepEqual(listTalks(index, { eventType: "meetup" }).map((t) => t.id), ["flutter-games"]);
  assert.deepEqual(listTalks(index, { year: 2025 }).map((t) => t.id), ["flutter-games"]);
  assert.deepEqual(listTalks(index, { hasRecording: true }).map((t) => t.id), ["dnd-agents"]);
  assert.deepEqual(listTalks(index, { hasRecording: false }).map((t) => t.id), ["flutter-games"]);
});

test("an event is upcoming until its last day ends, unless its status says otherwise", () => {
  assert.equal(eventTiming(event("a", "2026-10-09", "2026-10-10"), TODAY), "upcoming");
  assert.equal(eventTiming(event("b", "2026-10-08", "2026-10-09"), TODAY), "past");
  assert.equal(eventTiming(event("c", "2027-01-01", "2027-01-01", { status: "past" }), TODAY), "past");
  assert.equal(eventTiming(event("d", "2020-01-01", "2020-01-01", { status: "upcoming" }), TODAY), "upcoming");
});

test("upcoming events come soonest first, past events most recent first", () => {
  assert.deepEqual(
    listEvents(index, {}, TODAY).map((e) => e.id),
    ["running-now", "soon", "later"],
  );
  assert.deepEqual(
    listEvents(index, { when: "past" }, TODAY).map((e) => e.id),
    ["forced-past", "past-one"],
  );
  assert.deepEqual(
    listEvents(index, { when: "all" }, TODAY).map((e) => e.timing),
    ["upcoming", "upcoming", "upcoming", "past", "past"],
  );
  assert.deepEqual(listEvents(index, { query: "morocco" }, TODAY).map((e) => e.id), ["later"]);
});

test("the overview reports counts, the next event, and the accepted filter values", () => {
  const overview = siteOverview(index, TODAY);
  assert.deepEqual(overview.counts, { posts: 3, talks: 2, upcomingEvents: 3, pastEvents: 2 });
  assert.equal(overview.nextEvent?.id, "running-now");
  assert.equal(overview.latestPost?.title, "Authentication flows on Flutter with AWS Amplify");
  assert.deepEqual(overview.filters.postTags, ["Flutter", "AWS Amplify", "Agents"]);
  assert.deepEqual(overview.filters.talkTopics, ["Agents", "TypeScript", "Flutter"]);
  assert.deepEqual(overview.filters.talkEventTypes, ["Conference", "Meetup"]);
});

test("the speaker kit ranks topics by talk count and lists bookings and contact routes", () => {
  const withRepeat: SiteIndex = {
    ...index,
    talks: [
      ...index.talks,
      talk("agents-again", { title: "Agents again", date: "2025-01-01", topics: ["agents"] }),
    ],
  };
  const kit = speakerKit(withRepeat, TODAY);
  assert.equal(kit.name, "Salih Güler");
  assert.equal(kit.role, "Senior Developer Advocate at AWS");
  assert.deepEqual(kit.speaking.topics, [
    { topic: "Agents", talks: 2 },
    { topic: "TypeScript", talks: 1 },
    { topic: "Flutter", talks: 1 },
  ]);
  assert.equal(kit.speaking.talkCount, 3);
  assert.equal(kit.speaking.recordedTalkCount, 1);
  assert.deepEqual(kit.speaking.eventTypes, ["Conference", "Meetup"]);
  assert.deepEqual(kit.recentTalks.map((t) => t.title), [
    "Building a multi-agent D&D game",
    "Flutter games with Flame",
    "Agents again",
  ]);
  assert.deepEqual(kit.upcomingEvents.map((e) => e.id), ["running-now", "soon", "later"]);
  assert.equal(kit.contactUrl, "https://salih.dev/contact/");
  assert.equal(kit.profiles[0]?.label, "GitHub");
});

test("the discovery catalog lists exactly the tools the page registers", async () => {
  const source = await readFile(new URL("./register-tools.ts", import.meta.url), "utf8");
  const registered = [...source.matchAll(/registerTool\(\{\s*name: "([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(registered, WEBMCP_TOOLS.map((tool) => tool.name));
});
