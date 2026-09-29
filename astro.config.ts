import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

import { markdownProcessor, SHIKI_CONFIG } from "./src/lib/markdown-config";

/**
 * salih.dev builds in two shapes from one source tree (backend-served-content):
 *
 * - The default static build (the publisher) prerenders every route, including
 *   the Talks and home pages, and syncs `dist/` to the site bucket exactly as
 *   before. This is what `npm run build`, `verify:build`, and CodeBuild run.
 * - The SSR build (`SALIH_DEV_SSR=1`, used only by the render Lambda's CDK
 *   bundling via `infra/scripts/build-render-lambda.mjs`) adds the official Node
 *   adapter in middleware mode. That build script patches the four dynamic
 *   routes' `prerender` export to a literal `false` on disk for the duration of
 *   the build, so only they are rendered on request; everything else is still
 *   prerendered into `dist/client/` and served from S3.
 *
 * One source, two outputs: the static publisher owns the long tail, and the
 * render Lambda owns the four request-time routes.
 */
const ssr = process.env.SALIH_DEV_SSR === "1";

export default defineConfig({
  site: "https://salih.dev",
  output: "static",
  ...(ssr ? { adapter: node({ mode: "middleware" }) } : {}),
  integrations: [sitemap()],
  markdown: {
    processor: markdownProcessor,
    shikiConfig: SHIKI_CONFIG,
  },
});
