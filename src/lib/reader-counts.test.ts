import assert from "node:assert/strict";
import test from "node:test";

import { commentsApiPath, isBlogPostHtmlPath, readersApiPath } from "./reader-counts.ts";

test("only a blog post's HTML page gets the widget", () => {
  for (const path of [
    "/blog/7-tips-to-make-your-ai-agent-more-predictable-1ga4/",
    "/blog/my-post",
  ]) {
    assert.equal(isBlogPostHtmlPath(path), true, path);
  }
  for (const path of [
    "/blog/",
    "/blog/index.md",
    "/blog/my-post.md",
    "/blog/my-post/extra/",
    "/categories/ai/",
    "/tags/aws/",
    "/",
    "/talks/",
  ]) {
    assert.equal(isBlogPostHtmlPath(path), false, path);
  }
});

test("the heartbeat goes to the same-origin readers API", () => {
  assert.equal(readersApiPath("my-post"), "/api/readers/my-post");
});

test("comments go to the same-origin comments API", () => {
  assert.equal(commentsApiPath("my-post"), "/api/comments/my-post");
});
