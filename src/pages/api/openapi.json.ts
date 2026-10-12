import type { APIRoute } from "astro";

import { jsonResponse } from "../../lib/http";

export const GET: APIRoute = () =>
  jsonResponse({
    openapi: "3.1.0",
    info: {
      title: "salih.dev public content API",
      version: "1.0.0",
      description:
        "Read-only discovery documents and Markdown representations of public site content.",
    },
    servers: [{ url: "https://salih.dev" }],
    paths: {
      "/api/catalog.json": {
        get: {
          summary: "List public discovery capabilities",
          responses: {
            "200": {
              description: "Capability catalog",
              content: { "application/json": {} },
            },
          },
        },
      },
      "/llms.txt": {
        get: {
          summary: "Read the concise machine-oriented site guide",
          responses: {
            "200": {
              description: "Site guide",
              content: { "text/plain": {} },
            },
          },
        },
      },
      "/llms-full.txt": {
        get: {
          summary: "Read the complete public Markdown corpus",
          responses: {
            "200": {
              description: "Full public content",
              content: { "text/plain": {} },
            },
          },
        },
      },
      "/api/webmcp-index.json": {
        get: {
          summary:
            "Read the structured index of posts, talks, and events behind the WebMCP tools",
          responses: {
            "200": {
              description: "Content index",
              content: { "application/json": {} },
            },
          },
        },
      },
    },
  });
