import { unified } from "@astrojs/markdown-remark";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import remarkDirective from "remark-directive";

import remarkYouTube from "./src/lib/remark-youtube";

export default defineConfig({
  site: "https://salih.dev",
  output: "static",
  integrations: [sitemap()],
  markdown: {
    processor: unified({
      gfm: true,
      remarkPlugins: [remarkDirective, remarkYouTube],
    }),
    shikiConfig: {
      theme: "github-light",
      wrap: true,
    },
  },
});
