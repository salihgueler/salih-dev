/**
 * Reads the `renderFromBackend` feature flag from the AWS AppConfig Agent.
 *
 * Feature: render-rollout-flag (Parts 1 and 2 of the AppConfig rollout)
 *
 * The AppConfig Agent runs as a Lambda extension on `http://127.0.0.1:2772` and
 * keeps the deployed configuration in a local cache, polling AppConfig in the
 * background. A flag read is therefore a call to loopback, never a wait on the
 * AppConfig service. The extension evaluates the flag's multi-variant rules for
 * this visitor from the `vid` passed in the `Context` header, so the same
 * visitor lands in the same bucket for the whole rollout.
 *
 * The single load-bearing rule of this module is the FAIL-SAFE default: any
 * error, non-200 status, malformed body, or timeout returns `false`, which is
 * the off path (serve the baked static page). A broken flag read must never
 * take the risky on path or surface an error to a visitor, so the boring,
 * known-good behaviour is what you get when everything is on fire.
 *
 * The endpoint path and the `Context: key=value` header format are the ones the
 * AppConfig Agent documents for retrieving a feature flag with variants:
 * https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-retrieving-feature-flags.html
 * https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-code-samples-agent-read-feature-flag-with-variants.html
 */

/** The flag key this site rolls out behind. One flag covers all 16 routes. */
export const RENDER_FLAG_KEY = "renderFromBackend";

/** The flag that shows "reading now" and "read so far" on blog posts. */
export const READER_COUNTS_FLAG_KEY = "readerCounts";

/** The flag that shows comments and the comment form on blog posts. */
export const COMMENTS_FLAG_KEY = "comments";

/** The AppConfig Agent's fixed local HTTP port. */
const AGENT_PORT = 2772;

/** How long a warm flag read may take before it falls back to the off path. */
const DEFAULT_TIMEOUT_MS = 300;

/**
 * The budget for the first flag read on a new Lambda instance. That read pays
 * for the fetch client loading and the agent's first answer. In production it
 * took longer than 300 ms on the readers and comments Lambdas, so a cold
 * instance read every flag as off. Warm reads keep the short budget.
 */
const FIRST_READ_TIMEOUT_MS = 1500;

/** Whether this instance has had an answer from the agent yet. */
let warmFlagRead = false;

/**
 * The configuration coordinates the render Lambda reads the flag from. These
 * come from the Lambda's environment (set by CDK to the AppConfig application,
 * environment, and profile names). A missing coordinate returns `false` (off).
 */
export type FlagConfig = Readonly<{
  application: string;
  environment: string;
  profile: string;
}>;

/** Reads the flag coordinates from the process environment. */
export function flagConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FlagConfig | null {
  const application = env.APPCONFIG_APPLICATION;
  const environment = env.APPCONFIG_ENVIRONMENT;
  const profile = env.APPCONFIG_PROFILE;
  if (
    application === undefined ||
    application === "" ||
    environment === undefined ||
    environment === "" ||
    profile === undefined ||
    profile === ""
  ) {
    return null;
  }
  return { application, environment, profile };
}

/**
 * Reads the flag's `enabled` boolean from the AppConfig Agent response.
 *
 * A single-flag read (`?flag=FLAG_KEY`) returns that flag's attributes at the
 * TOP level of the body, for example
 *
 *   { "_variant": "author", "enabled": true }
 *
 * Only a whole-profile read (no `?flag=`) nests each flag under its key. This
 * was checked against the real agent (extension 2.0.25759) reading the live
 * `render-flags` profile, and matches the AWS sample for reading a specific
 * flag. An earlier version of this helper read `body[RENDER_FLAG_KEY].enabled`,
 * which the single-flag response never has, so the flag always read as off.
 * A body that is not an object, or whose `enabled` is not the boolean `true`,
 * is treated as off (the fail-safe default).
 */
function isEnabled(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  return (body as { enabled?: unknown }).enabled === true;
}

/**
 * Overridable seams for the fetch and clock, so the helper is unit-testable
 * without a live agent. Production passes the global `fetch`.
 */
export type FlagReadDeps = Readonly<{
  fetch: typeof fetch;
  timeoutMs: number;
  /** Budget for the first read on this instance. Defaults to `timeoutMs`. */
  firstReadTimeoutMs?: number;
}>;

const defaultDeps: FlagReadDeps = {
  fetch: (...args) => fetch(...args),
  timeoutMs: DEFAULT_TIMEOUT_MS,
  firstReadTimeoutMs: FIRST_READ_TIMEOUT_MS,
};

/** Test seam: makes the next read count as the first on this instance. */
export function resetWarmFlagReadForTests(): void {
  warmFlagRead = false;
}

/**
 * Returns whether feature flag `key` is on for this visitor.
 *
 * FAIL-SAFE: returns `false` on any error, non-200, malformed body, missing
 * config, or timeout. A flag that is not in the deployed configuration yet
 * (the agent answers 4xx) is off too, so a new flag can ship in code before
 * its first flag deployment.
 *
 * @param key the flag key in the `render-flags` profile.
 * @param vid the visitor id used as the flag's evaluation context. When empty
 *   the flag is still read (the default rule applies), so a first-request
 *   visitor without a cookie yet still gets a decision.
 */
export async function getFlag(
  key: string,
  vid: string,
  config: FlagConfig | null = flagConfigFromEnv(),
  deps: FlagReadDeps = defaultDeps,
): Promise<boolean> {
  if (config === null) return false;

  // 127.0.0.1, not localhost: the agent only listens on IPv4 (it logs that it
  // can't bind [::1]), and localhost can resolve to ::1 first.
  const url =
    `http://127.0.0.1:${AGENT_PORT}` +
    `/applications/${encodeURIComponent(config.application)}` +
    `/environments/${encodeURIComponent(config.environment)}` +
    `/configurations/${encodeURIComponent(config.profile)}` +
    `?flag=${encodeURIComponent(key)}`;

  const timeoutMs = warmFlagRead
    ? deps.timeoutMs
    : (deps.firstReadTimeoutMs ?? deps.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> =
      vid === "" ? {} : { Context: `vid=${vid}` };
    const response = await deps.fetch(url, {
      headers,
      signal: controller.signal,
    });
    warmFlagRead = true;
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return isEnabled(body);
  } catch {
    // Any failure (network error, abort/timeout, non-JSON body) is the off
    // path. The off path is the safe, known-good behaviour.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the `renderFromBackend` flag is on for this visitor. */
export function getRenderFlag(
  vid: string,
  config: FlagConfig | null = flagConfigFromEnv(),
  deps: FlagReadDeps = defaultDeps,
): Promise<boolean> {
  return getFlag(RENDER_FLAG_KEY, vid, config, deps);
}
