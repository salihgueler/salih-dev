/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /**
     * Whether the `readerCounts` flag is on for this visitor. Set by the
     * render middleware on request-time renders of a blog post; absent (off)
     * in the static build and on baked pages.
     */
    readerCounts?: boolean;
  }
}
