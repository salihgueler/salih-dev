import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const requiredFiles = [
  "index.html",
  "index.md",
  "about/index.html",
  "about.md",
  "blog/index.html",
  "blog/index.md",
  "llms.txt",
  "llms-full.txt",
  "api/catalog.json",
  "api/openapi.json",
  ".well-known/agent-readiness.json",
  ".well-known/mcp/server-card.json",
  ".well-known/skills/index.json",
  ".well-known/webmcp.json",
  "skills/read-salih-dev/SKILL.md",
  "rss.xml",
  "sitemap.xml",
  "robots.txt",
];

for (const relativePath of requiredFiles) {
  await access(path.join("dist", relativePath));
}

const blogDirectory = path.join("dist", "blog");
const blogEntries = await readdir(blogDirectory, { withFileTypes: true });
const postDirectories = blogEntries.filter((entry) => entry.isDirectory());

for (const entry of postDirectories) {
  await Promise.all([
    access(path.join(blogDirectory, entry.name, "index.html")),
    access(path.join(blogDirectory, `${entry.name}.md`)),
  ]);
}

const sourceFiles = await readdir("src/content/blog");
for (const sourceFile of sourceFiles.filter((file) => file.endsWith(".md"))) {
  const markdown = await readFile(
    path.join("src/content/blog", sourceFile),
    "utf8",
  );
  if (!/^originalUrl: "https:\/\/dev\.to\//m.test(markdown)) continue;
  if (
    !/hero:\n  src: "https:\/\/salih\.dev\/images\/blog\//m.test(markdown)
  ) {
    throw new Error(
      `DEV post ${sourceFile} does not use an AWS-hosted banner URL.`,
    );
  }
}

console.log(
  `Verified ${requiredFiles.length} discovery files and ${postDirectories.length} post representation pairs.`,
);
