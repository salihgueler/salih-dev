/**
 * Tests for the request-time blog post source.
 *
 * Feature: backend-served-content
 *
 * Pure unit tests over injected stored objects: no S3, no filesystem, no
 * network. They live under `src/**` so the publisher's root test runs them
 * without importing anything from `infra/`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStoredPost,
  postIdFromKey,
  requestTimePostsFromObjects,
  type StoredPostObject,
} from "./s3-posts.js";

function validPost(id: string, title: string, pubDate: string): StoredPostObject {
  const frontmatter = [
    "---",
    `title: ${title}`,
    "description: A description.",
    `pubDate: ${pubDate}`,
    "category: Testing",
    "tags:",
    "  - alpha",
    "hero:",
    "  src: https://salih.dev/images/blog/x.webp",
    "  alt: Alt",
    "  credit: Someone",
    "  creditUrl: https://example.com/",
    "aiSummary: A summary.",
    "---",
    "",
    "# Body",
    "",
    "Some **markdown** with a [link](https://example.com/).",
    "",
  ].join("\n");
  return { key: `posts/${id}.md`, body: frontmatter };
}

test("postIdFromKey accepts a flat post key and rejects others", () => {
  assert.equal(postIdFromKey("posts/hello-world.md"), "hello-world");
  assert.equal(postIdFromKey("posts/nested/x.md"), null);
  assert.equal(postIdFromKey("posts/.md"), null);
  assert.equal(postIdFromKey("images/x.webp"), null);
  assert.equal(postIdFromKey("posts/x.txt"), null);
});

test("parseStoredPost validates frontmatter with the shared schema", () => {
  const parsed = parseStoredPost(validPost("hello", "Hello", "2026-06-18"));
  assert.ok(parsed !== null);
  assert.equal(parsed.id, "hello");
  assert.equal(parsed.data.title, "Hello");
  assert.equal(parsed.data.category, "Testing");
  assert.ok(parsed.body.includes("# Body"));
});

test("parseStoredPost rejects frontmatter missing a required field", () => {
  const bad: StoredPostObject = {
    key: "posts/bad.md",
    body: "---\ntitle: Only a title\n---\nBody\n",
  };
  assert.equal(parseStoredPost(bad), null);
});

test("requestTimePostsFromObjects renders valid posts and drops invalid ones", async () => {
  const { posts, droppedKeys } = await requestTimePostsFromObjects([
    validPost("b-post", "Beta", "2026-04-02"),
    validPost("a-post", "Alpha", "2026-06-18"),
    { key: "posts/broken.md", body: "---\ntitle: no other fields\n---\n" },
    { key: "posts/nested/x.md", body: validPost("x", "X", "2026-01-01").body },
  ]);

  assert.equal(posts.length, 2);
  assert.deepEqual(
    posts.map((p) => p.id),
    ["a-post", "b-post"],
  );
  // The body is compiled to HTML through the shared config.
  assert.ok(posts[0].renderedHtml.includes("<strong>markdown</strong>"));
  assert.ok(posts[0].renderedHtml.includes('<a href="https://example.com/">'));
  assert.deepEqual([...droppedKeys], ["posts/broken.md", "posts/nested/x.md"]);
});
