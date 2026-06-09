import * as pulumi from "@pulumi/pulumi";
import { warn } from "./terminal.js";

export interface HttpProbeOptions {
  /** Give up after this long. Default: 180 seconds. */
  timeoutMs?: number | undefined;
  /** Pause between attempts. Default: 2 seconds. */
  intervalMs?: number | undefined;
  /**
   * What counts as ready. `"any-response"` (the default) accepts every HTTP
   * status — including errors like 403 — because a status line proves the
   * server is up, which is all a boot probe needs. `"ok"` additionally
   * requires a 2xx status.
   */
  expect?: "any-response" | "ok" | undefined;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 2_000;

/**
 * Polls an HTTP endpoint until it responds, the configured expectation is
 * met, or the timeout elapses. Returns whether the endpoint became ready.
 *
 * Deliberately never throws: on timeout it logs a warning and returns
 * `false`, so lifecycle flows that race a disappearing container (destroy,
 * refresh) degrade to a warning instead of wedging the run. The component
 * that actually depends on the endpoint will surface the real connection
 * error at its own layer.
 */
export async function waitForHttp(url: string, options: HttpProbeOptions = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const expect = options.expect ?? "any-response";

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(intervalMs * 5, 10_000)) });
      if (expect === "any-response" || response.ok) {
        return true;
      }
    } catch {
      // Connection refused or timed out — the server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  warn(`${url} did not respond within ${Math.round(timeoutMs / 1000)}s; continuing anyway.`);
  return false;
}

export interface ReadyWhenHttpOptions extends HttpProbeOptions {
  /**
   * Runs once the probe succeeds — the place for imperative post-boot
   * configuration (a `docker exec` against the freshly started container,
   * for example). Skipped when the probe times out. Note that the readiness
   * chain re-executes on every update that resolves the gate, so this
   * callback must be idempotent.
   */
  onReady?: (() => void | Promise<void>) | undefined;
}

/**
 * An output that resolves to `url` once the endpoint behind it responds,
 * gated on another resource being scheduled first — typically the container
 * that serves the endpoint:
 *
 * ```typescript
 * const adminUrl = readyWhenHttp(keycloakContainer.id, "http://localhost:20080");
 * new keycloak.Provider("keycloak", { url: adminUrl, ... });
 * ```
 *
 * Anything consuming the returned output (a provider, a dependent resource)
 * is therefore held back until the service has actually booted. The polling
 * happens in a plain `apply` closure — nothing is serialized into Pulumi
 * state — and the output always resolves to `url`, even on timeout, to keep
 * the graph healthy during destroy and refresh.
 *
 * Dry runs are exempt: during a preview the output resolves immediately,
 * without probing and without `onReady` — a preview must neither stall on a
 * stopped container nor execute side effects.
 */
export function readyWhenHttp(
  gate: pulumi.Input<unknown>,
  url: string,
  options: ReadyWhenHttpOptions = {},
): pulumi.Output<string> {
  return (pulumi.output(gate) as pulumi.Output<unknown>).apply(async () => {
    if (pulumi.runtime.isDryRun()) {
      return url;
    }
    const ready = await waitForHttp(url, options);
    if (ready && options.onReady) {
      await options.onReady();
    }
    return url;
  });
}
