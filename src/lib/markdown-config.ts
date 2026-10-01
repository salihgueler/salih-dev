/**
 * The single source of truth for salih.dev's Markdown rendering configuration.
 *
 * Feature: backend-served-content
 *
 * Astro compiles blog post bodies at build time through the `markdown` config
 * in `astro.config.ts`. The request-time renderer (the render Lambda) compiles
 * the same S3-sourced post bodies through `@astrojs/markdown-remark`'s
 * `createMarkdownProcessor`. Both MUST use the exact same GitHub-Flavored
 * Markdown setting, the same remark plugins (`remark-directive` for the
 * `::youtube{...}` container directive, and `remark-youtube` which turns it into
 * the embed), and the same Shiki highlighting theme, or the request-time HTML
 * would drift from the baked HTML for the same post.
 *
 * `astro.config.ts` imports {@link markdownProcessor} to build its
 * `markdown.processor`, and {@link SHIKI_CONFIG} for `markdown.shikiConfig`. The
 * request-time renderer imports {@link MARKDOWN_CONFIG} and hands it to
 * `createMarkdownProcessor`. Keeping the plugin list and Shiki config in one
 * module is what makes the two outputs provably identical (the reliability proof
 * diffs them per post).
 */

import { unified } from "@astrojs/markdown-remark";
import type { AstroMarkdownOptions } from "@astrojs/markdown-remark";
import remarkDirective from "remark-directive";

import remarkYouTube from "./remark-youtube";

/** Shiki highlighting config, shared by both build shapes. */
export const SHIKI_CONFIG = {
  theme: "github-light",
  wrap: true,
} as const;

/** The remark plugin list, shared by both build shapes. */
export const REMARK_PLUGINS = [remarkDirective, remarkYouTube];

/**
 * The `markdown.processor` Astro's static build uses. It is a pre-built
 * `unified` processor carrying the shared GFM setting and remark plugins.
 */
export const markdownProcessor = unified({
  gfm: true,
  remarkPlugins: REMARK_PLUGINS,
});

/**
 * The options the request-time renderer passes to `createMarkdownProcessor`, so
 * a post body compiled on request matches the body Astro baked for the same
 * source. `gfm`, the remark plugins, and the Shiki config are the same values
 * `astro.config.ts` applies.
 */
export const MARKDOWN_CONFIG: AstroMarkdownOptions = {
  gfm: true,
  remarkPlugins: REMARK_PLUGINS,
  shikiConfig: SHIKI_CONFIG,
};
