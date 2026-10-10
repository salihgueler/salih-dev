/**
 * The WebMCP tools this site registers, for discovery documents.
 *
 * Feature: webmcp
 *
 * `/.well-known/webmcp.json` and the capability catalog publish this list so a
 * crawler can learn what an agent will find on the page without running it.
 * The full schemas live with the registrations in `register-tools.ts`; a unit
 * test keeps the two name lists identical.
 */

export type WebMcpToolSummary = Readonly<{
  name: string;
  title: string;
  /** "all" = registered on every page; otherwise the one path that registers it. */
  pages: "all" | `/${string}`;
  readOnly: boolean;
}>;

export const WEBMCP_TOOLS: readonly WebMcpToolSummary[] = [
  { name: "get_site_overview", title: "Site overview", pages: "all", readOnly: true },
  { name: "search_site", title: "Search posts, talks, and events", pages: "all", readOnly: true },
  { name: "list_blog_posts", title: "List blog posts", pages: "all", readOnly: true },
  { name: "read_blog_post", title: "Read a blog post", pages: "all", readOnly: true },
  { name: "list_talks", title: "List past talks", pages: "all", readOnly: true },
  { name: "list_events", title: "List speaking events", pages: "all", readOnly: true },
  { name: "show_talks_on_page", title: "Filter the Talks page", pages: "/talks/", readOnly: false },
];
