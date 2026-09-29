/**
 * Builds the request-time render Lambda deployment package.
 *
 * Feature: backend-served-content
 *
 * The render Lambda is the Astro SSR server built by the official
 * `@astrojs/node` adapter (middleware mode) wrapped by a thin API Gateway v2
 * handler. This script produces the package the CDK asset points at:
 *
 *   <out>/index.mjs   the handler (bundled from infra/functions/render.ts)
 *   <out>/server/     the Astro SSR server output (dist/server)
 *   <out>/client/     the prerendered static assets + error pages (dist/client)
 *
 * The `server/` and `client/` directories are kept as siblings because the
 * adapter re-derives the client directory at runtime by walking up from the
 * server entry's own path to the "server" folder segment and then resolving the
 * client directory relative to it; a bundle that flattened that structure would
 * break `resolveClientDir`. The handler imports `./server/entry.mjs`, which is
 * left external so the adapter's own chunks and the `import.meta.url` walk stay
 * intact.
 *
 * The SSR build sets `SALIH_DEV_SSR=1`, which (a) adds the Node adapter in the
 * Astro config and (b) flips the four dynamic routes' `prerender` flag to false
 * so only they are served on request; every other route is still prerendered
 * into `client/` and served from S3 by the static publisher.
 *
 * Usage: node scripts/build-render-lambda.mjs <outDir>
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const infraRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(infraRoot, "..");

const outDir = process.argv[2];
if (outDir === undefined || outDir === "") {
  throw new Error("Usage: build-render-lambda.mjs <outDir>");
}

const resolvedOut = path.resolve(outDir);
rmSync(resolvedOut, { force: true, recursive: true });
mkdirSync(resolvedOut, { recursive: true });

// The dynamic route files declare `export const prerender =
// PRERENDER_DYNAMIC_ROUTE;`. Astro only honours a literal boolean when it scans
// a route's prerender export, and that scan does not run this project's Vite
// transforms, so the flag is patched to a literal `false` on disk for the SSR
// build and restored immediately afterwards. The static publisher build reads
// the unpatched file, where the constant is `true`, and prerenders the routes.
const DYNAMIC_ROUTE_FILES = [
  "src/pages/index.astro",
  "src/pages/index.md.ts",
  "src/pages/talks/index.astro",
  "src/pages/talks/index.md.ts",
  "src/pages/blog/index.astro",
  "src/pages/blog/index.md.ts",
  "src/pages/blog/[slug].astro",
  "src/pages/blog/[slug].md.ts",
  "src/pages/categories/[category].astro",
  "src/pages/categories/[category].md.ts",
  "src/pages/tags/[tag].astro",
  "src/pages/tags/[tag].md.ts",
  "src/pages/rss.xml.ts",
  "src/pages/sitemap.xml.ts",
  "src/pages/llms.txt.ts",
  "src/pages/llms-full.txt.ts",
];
const SENTINEL = "export const prerender = PRERENDER_DYNAMIC_ROUTE;";
const SSR_LITERAL = "export const prerender = false;";

// This script edits shared source files in place (patch the sentinels, build,
// restore). CDK asset bundling can invoke it CONCURRENTLY — a test suite that
// synthesizes the stack many times runs several bundles at once — and two
// concurrent runs would interleave their patch/restore and leave a source file
// holding another run's stale copy (or a patched `false`). A cross-process lock
// serializes the whole patch->build->restore critical section so only one run
// touches the tree at a time. The lock is a directory (mkdir is atomic and
// fails if it exists); a stale lock older than the timeout is reclaimed.
const LOCK_DIR = path.join(repoRoot, ".cache", "render-build.lock");
// A render build is seconds; a lock older than STALE_MS was left by a killed
// run (CDK can terminate bundling), so reclaim it. WAIT_MS is how long a run
// waits for the lock before giving up — long enough for many serialized builds
// (a synth-heavy test run) to drain ahead of it.
const LOCK_STALE_MS = 3 * 60 * 1000;
const LOCK_WAIT_MS = 20 * 60 * 1000;

function sleepSync(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Busy-wait: this script is a short-lived build subprocess, and Atomics
    // wait on a shared buffer is the only synchronous sleep without a dep.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    break;
  }
}

function acquireLock() {
  mkdirSync(path.dirname(LOCK_DIR), { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      writeFileSync(path.join(LOCK_DIR, "pid"), String(process.pid));
      return;
    } catch {
      // Reclaim a lock left by a crashed run.
      try {
        const created = statSync(LOCK_DIR).mtimeMs;
        if (Date.now() - created > LOCK_STALE_MS) {
          rmSync(LOCK_DIR, { force: true, recursive: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > LOCK_WAIT_MS) {
        throw new Error("Timed out waiting for the render-build lock");
      }
      sleepSync(100);
    }
  }
}

function releaseLock() {
  rmSync(LOCK_DIR, { force: true, recursive: true });
}

acquireLock();

// Read and validate EVERY route first, before patching any, so a missing
// sentinel aborts the run with the whole tree still intact. Only once all four
// are known good does the patch loop run, and `restoreRoutes` (in the finally
// below) undoes exactly the ones actually patched — so a crash mid-build, or a
// SIGKILL, can never leave a route stuck at the SSR literal and break the
// static build. The lock serialises concurrent CDK synths against the same tree.
const routeSources = DYNAMIC_ROUTE_FILES.map((relative) => {
  const file = path.join(repoRoot, relative);
  const original = readFileSync(file, "utf8");
  if (!original.includes(SENTINEL)) {
    releaseLock();
    throw new Error(`Expected prerender sentinel in ${relative}`);
  }
  return { file, original };
});

const patched = [];
function restoreRoutes() {
  for (const entry of patched) {
    writeFileSync(entry.file, entry.original);
  }
}

try {
  for (const entry of routeSources) {
    writeFileSync(entry.file, entry.original.replace(SENTINEL, SSR_LITERAL));
    patched.push(entry);
  }

  // 1. Build the Astro SSR server (adapter + on-demand dynamic routes).
  execFileSync("npm", ["run", "build"], {
    cwd: repoRoot,
    env: { ...process.env, SALIH_DEV_SSR: "1" },
    stdio: "inherit",
  });
} finally {
  restoreRoutes();
  releaseLock();
}

// 2. Copy the SSR server and its client assets into the package, siblings so
//    the adapter's runtime client-directory resolution keeps working.
const distDir = path.join(repoRoot, "dist");
cpSync(path.join(distDir, "server"), path.join(resolvedOut, "server"), {
  recursive: true,
});
cpSync(path.join(distDir, "client"), path.join(resolvedOut, "client"), {
  recursive: true,
});

// 2b. The Astro server build leaves its framework/adapter dependencies as bare
//     imports (`@astrojs/internal-helpers`, the `@astrojs/node` runtime, `send`,
//     `server-destroy`, …), expecting a node_modules tree at runtime. A Lambda
//     package has none, so the server entry is re-bundled in place into a single
//     file with those dependencies inlined. It is kept at `server/entry.mjs` so
//     the adapter's `import.meta.url` walk still finds the "server" path segment
//     and resolves the sibling client directory. The AWS SDK is provided by the
//     Node 24 runtime, so it stays external and is never require()d as ESM.
const serverEntry = path.join(resolvedOut, "server", "entry.mjs");
await build({
  entryPoints: [serverEntry],
  outfile: serverEntry,
  absWorkingDir: repoRoot,
  // The copied server chunks live in the output dir, which has no node_modules;
  // resolve their bare framework imports against the repo's own install.
  nodePaths: [path.join(repoRoot, "node_modules")],
  allowOverwrite: true,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: true,
  // The AWS SDK is bundled, not left external: ESM resolution ignores
  // NODE_PATH, so a bare `@aws-sdk/client-s3` import would not resolve from the
  // package's own directory on the Lambda runtime. Bundling it as ESM (with the
  // createRequire banner) is the same recipe the upload-completion handler uses
  // and avoids ERR_REQUIRE_ESM. Only Node built-ins stay external.
  external: ["node:*"],
  banner: {
    js: "import { createRequire as __kcCreateRequire } from 'node:module'; const require = __kcCreateRequire(import.meta.url);",
  },
});

// 3. Bundle the handler as ESM. The Astro server entry is external so its own
//    chunk graph and `import.meta.url` walk are preserved; the AWS SDK the
//    bundled middleware uses is provided by the Node 24 runtime, so it is
//    external too and never require()d as an ESM-only module.
await build({
  entryPoints: [path.join(infraRoot, "functions", "render.ts")],
  outfile: path.join(resolvedOut, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: true,
  external: ["./server/entry.mjs", "@aws-sdk/*", "aws-lambda"],
  banner: {
    js: "import { createRequire as __kcCreateRequire } from 'node:module'; const require = __kcCreateRequire(import.meta.url);",
  },
});

process.stdout.write(`Render Lambda package built at ${resolvedOut}\n`);
