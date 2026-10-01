/**
 * Unit tests for the AppConfig flag-read helper.
 *
 * Feature: render-rollout-flag.
 *
 * The load-bearing property is fail-safe: any error, timeout, non-200, or
 * malformed body returns false (the off path). These stub `fetch` so no live
 * agent is needed.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  flagConfigFromEnv,
  getFlag,
  getRenderFlag,
  READER_COUNTS_FLAG_KEY,
  RENDER_FLAG_KEY,
  type FlagConfig,
  type FlagReadDeps,
} from "./flags.ts";

const config: FlagConfig = {
  application: "salih-dev",
  environment: "production",
  profile: "render-flags",
};

function depsReturning(body: unknown, ok = true): FlagReadDeps {
  return {
    timeoutMs: 300,
    fetch: (async () =>
      new Response(JSON.stringify(body), {
        status: ok ? 200 : 500,
      })) as unknown as typeof fetch,
  };
}

/**
 * The body a single-flag read (`?flag=renderFromBackend`) returns: the flag's
 * attributes at the top level, e.g. `{"_variant":"author","enabled":true}`.
 * Captured from the real AppConfig Agent (2.0.25759) on 2026-10-01.
 */
function agentBody(attrs: Record<string, unknown>): Record<string, unknown> {
  return { _variant: "author", ...attrs };
}

test("returns true when the agent reports the flag enabled", async () => {
  const on = await getRenderFlag(
    "v1",
    config,
    depsReturning(agentBody({ enabled: true })),
  );
  assert.equal(on, true);
});

test("returns false when the agent reports the flag disabled", async () => {
  const off = await getRenderFlag(
    "v1",
    config,
    depsReturning(agentBody({ enabled: false })),
  );
  assert.equal(off, false);
});

test("returns false on a non-200 response", async () => {
  const off = await getRenderFlag(
    "v1",
    config,
    depsReturning(agentBody({ enabled: true }), false),
  );
  assert.equal(off, false);
});

test("returns false when fetch throws (network error)", async () => {
  const deps: FlagReadDeps = {
    timeoutMs: 300,
    fetch: (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch,
  };
  assert.equal(await getRenderFlag("v1", config, deps), false);
});

test("returns false on a timeout (aborted fetch)", async () => {
  const deps: FlagReadDeps = {
    timeoutMs: 5,
    fetch: ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as unknown as typeof fetch,
  };
  assert.equal(await getRenderFlag("v1", config, deps), false);
});

test("returns false on a malformed (non-JSON) body", async () => {
  const deps: FlagReadDeps = {
    timeoutMs: 300,
    fetch: (async () =>
      new Response("not json", { status: 200 })) as unknown as typeof fetch,
  };
  assert.equal(await getRenderFlag("v1", config, deps), false);
});

test("returns false when enabled is not a boolean", async () => {
  assert.equal(
    await getRenderFlag("v1", config, depsReturning(agentBody({ enabled: "yes" }))),
    false,
  );
});

test("returns false when the flag key is absent from the body", async () => {
  assert.equal(
    await getRenderFlag("v1", config, depsReturning({ someOtherFlag: { enabled: true } })),
    false,
  );
});

test("returns false for the whole-profile shape (flag nested under its key)", async () => {
  // Only a read WITHOUT ?flag= nests attributes under the flag key. The helper
  // always sends ?flag=, so a nested body is not the shape it asked for and
  // must not be read as on.
  assert.equal(
    await getRenderFlag(
      "v1",
      config,
      depsReturning({ [RENDER_FLAG_KEY]: { _variant: "author", enabled: true } }),
    ),
    false,
  );
});

test("returns false when the flag config is missing", async () => {
  assert.equal(
    await getRenderFlag("v1", null, depsReturning(agentBody({ enabled: true }))),
    false,
  );
});

test("sends the vid in the Context header and the flag query", async () => {
  let seenUrl = "";
  let seenContext: string | null = "";
  const deps: FlagReadDeps = {
    timeoutMs: 300,
    fetch: (async (url: string, init?: { headers?: Record<string, string> }) => {
      seenUrl = url;
      seenContext = init?.headers?.Context ?? null;
      return new Response(JSON.stringify({ _variant: "author", enabled: true }), { status: 200 });
    }) as unknown as typeof fetch,
  };
  await getRenderFlag("abc-123", config, deps);
  assert.match(seenUrl, /localhost:2772/);
  assert.match(seenUrl, new RegExp(`flag=${RENDER_FLAG_KEY}`));
  assert.equal(seenContext, "vid=abc-123");
});

test("omits the Context header when vid is empty", async () => {
  let hadContext = true;
  const deps: FlagReadDeps = {
    timeoutMs: 300,
    fetch: (async (_url: string, init?: { headers?: Record<string, string> }) => {
      hadContext = init?.headers?.Context !== undefined;
      return new Response(JSON.stringify({ enabled: false }), { status: 200 });
    }) as unknown as typeof fetch,
  };
  await getRenderFlag("", config, deps);
  assert.equal(hadContext, false);
});

test("flagConfigFromEnv reads the three coordinates or returns null", () => {
  assert.deepEqual(
    flagConfigFromEnv({
      APPCONFIG_APPLICATION: "a",
      APPCONFIG_ENVIRONMENT: "e",
      APPCONFIG_PROFILE: "p",
    } as NodeJS.ProcessEnv),
    { application: "a", environment: "e", profile: "p" },
  );
  assert.equal(
    flagConfigFromEnv({ APPCONFIG_APPLICATION: "a" } as NodeJS.ProcessEnv),
    null,
  );
});

test("getFlag reads the named flag, not renderFromBackend", async () => {
  let seenUrl = "";
  const deps: FlagReadDeps = {
    timeoutMs: 300,
    fetch: (async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify(agentBody({ enabled: true })), {
        status: 200,
      });
    }) as unknown as typeof fetch,
  };
  assert.equal(await getFlag(READER_COUNTS_FLAG_KEY, "v1", config, deps), true);
  assert.match(seenUrl, /\?flag=readerCounts$/);
});

test("a flag missing from the deployed configuration (agent 404) is off", async () => {
  const deps: FlagReadDeps = {
    timeoutMs: 300,
    fetch: (async () =>
      new Response("flag not found", { status: 404 })) as unknown as typeof fetch,
  };
  assert.equal(await getFlag(READER_COUNTS_FLAG_KEY, "v1", config, deps), false);
});
