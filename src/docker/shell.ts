import { spawnSync } from "node:child_process";
import { fail } from "../terminal.js";

export interface AttachShellOptions {
  /** Shell to start inside the container. Default: `/bin/bash`. */
  shell?: string;
}

/**
 * Attaches an interactive shell to a running container — the
 * `docker exec -it <container> <shell>` a developer would type by hand.
 * Returns the shell's exit code so the caller decides what to do with the
 * process.
 *
 * Pairs naturally with a custom sandbox command:
 *
 * ```typescript
 * commands: {
 *   shell: {
 *     description: "Open a shell inside the workspace container",
 *     run: ({ physicalName, argv }) => attachShell(physicalName("workspace"), { shell: argv[0] }),
 *   },
 * }
 * ```
 */
export function attachShell(containerName: string, options: AttachShellOptions = {}): number {
  const shell = options.shell ?? "/bin/bash";
  process.stdout.write(`Attaching to ${containerName} (${shell})...\n`);

  const result = spawnSync("docker", ["exec", "-it", containerName, shell], { stdio: "inherit" });

  if (result.error) {
    fail(`Failed to run docker: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    fail(`docker exec exited with ${result.status ?? "no status"}.`, [
      `Is the container running? Start it with the "create" action.`,
    ]);
  }
  return result.status ?? 0;
}
