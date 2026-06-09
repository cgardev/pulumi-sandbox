import { execFileSync } from "node:child_process";
import { warn } from "../terminal.js";

export interface DockerExecOptions {
  /**
   * Warn and return `false` instead of throwing when the command fails.
   * This is the right mode for post-boot configuration hooks: the service
   * that actually needs the configuration will surface a clear error at its
   * own layer, while a throw here would wedge destroy and refresh flows.
   * Default: `true`.
   */
  warnOnly?: boolean;
}

/**
 * Runs a command inside a running container via `docker exec`, for
 * imperative post-boot configuration that no provider covers — unlocking an
 * admin API, creating a seed user, flipping a development-only setting.
 * Returns whether the command succeeded.
 *
 * Commands must be idempotent: readiness chains re-execute on every Pulumi
 * operation, so the same configuration may run against an already-configured
 * container.
 */
export function dockerExec(containerName: string, command: readonly string[], options: DockerExecOptions = {}): boolean {
  try {
    execFileSync("docker", ["exec", containerName, ...command], { stdio: "pipe" });
    return true;
  } catch (error) {
    const detail =
      (error as { stderr?: Buffer }).stderr?.toString().trim() || (error as Error).message;
    if (options.warnOnly ?? true) {
      warn(`docker exec in ${containerName} failed: ${detail}`);
      return false;
    }
    throw error;
  }
}
