/**
 * Reads the `renderFromBackend` feature flag from the AWS AppConfig Agent.
 *
 * Feature: render-rollout-flag (Parts 1 and 2 of the AppConfig rollout)
 *
 * The AppConfig Agent runs as a Lambda extension on `http://localhost:2772` and
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

/** The AppConfig Agent's fixed local HTTP port. */
const AGENT_PORT = 2772;

/** How long a flag read may take before it falls back to the off path. */
const DEFAULT_TIMEOUT_MS = 300;

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
 * A single-flag read (`?flag=FLAG_KEY`) does NOT return `enabled` at the top
 * level: the agent nests each flag's attributes under its own key, e.g.
 *
 *   { "renderFromBackend": { "_variant": "on", "enabled": true } }
 *
 * (verified against the AppConfig Agent docs). So the flag object is read from
 * `body[RENDER_FLAG_KEY]` and its `enabled` checked there. A body that is not an
 * object, is missing the flag key, or whose `enabled` is not the boolean `true`
 * is treated as off (the fail-safe default).
 */
function isEnabled(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const flag = (body as Record<string, unknown>)[RENDER_FLAG_KEY];
  if (typeof flag !== "object" || flag === null) return false;
  return (flag as { enabled?: unknown }).enabled === true;
}

/**
 * Overridable seams for the fetch and clock, so the helper is unit-testable
 * without a live agent. Production passes the global `fetch`.
 */
export type FlagReadDeps = Readonly<{
  fetch: typeof fetch;
  timeoutMs: number;
}>;

const defaultDeps: FlagReadDeps = {
  fetch: (...args) => fetch(...args),
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

/**
 * Returns whether the `renderFromBackend` flag is on for this visitor.
 *
 * FAIL-SAFE: returns `false` on any error, non-200, malformed body, missing
 * config, or timeout. The caller treats `false` as the off path.
 *
 * @param vid the visitor id used as the flag's evaluation context. When empty
 *   the flag is still read (the default rule applies), so a first-request
 *   visitor without a cookie yet still gets a decision.
 */
export async function getRenderFlag(
  vid: string,
  config: FlagConfig | null = flagConfigFromEnv(),
  deps: FlagReadDeps = defaultDeps,
): Promise<boolean> {
  if (config === null) return false;

  const url =
    `http://localhost:${AGENT_PORT}` +
    `/applications/${encodeURIComponent(config.application)}` +
    `/environments/${encodeURIComponent(config.environment)}` +
    `/configurations/${encodeURIComponent(config.profile)}` +
    `?flag=${encodeURIComponent(RENDER_FLAG_KEY)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const headers: Record<string, string> =
      vid === "" ? {} : { Context: `vid=${vid}` };
    const response = await deps.fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return isEnabled(body);
  } catch {
    // Any failure — network error, abort/timeout, non-JSON body — is the off
    // path. The off path is the safe, known-good behaviour.
    return false;
  } finally {
    clearTimeout(timer);
  }
}
