import path from "node:path";
import fs from "node:fs";

/**
 * Builds the `file://` URL for Pulumi's DIY (self-managed) backend from an
 * absolute directory path.
 *
 * Node's `pathToFileURL` produces a triple-slash URL (`file:///D:/...`) that
 * the DIY backend mis-parses on Windows — it re-prepends the drive, yielding
 * `file:///D:/D:/...` and a "filename ... syntax is incorrect" error. The
 * form Pulumi accepts on Windows is `file://D:/forward/slash/path`.
 * Prefixing the absolute path (with forward slashes) with `file://` gives
 * exactly that on Windows and the correct `file:///absolute/path` on POSIX,
 * where the path already starts with `/`.
 */
export function fileBackendUrl(absoluteDirectory: string): string {
  return `file://${absoluteDirectory.replace(/\\/g, "/")}`;
}

/**
 * On-disk layout of a local sandbox. Everything lives under a single home
 * directory (default `.sandbox/`, git-ignored) so a checkout can be cleaned
 * with one deletion and nothing machine-specific is ever committed.
 */
export interface SandboxDirectories {
  /** Root of the sandbox-managed files. */
  home: string;
  /** Pulumi DIY backend storage — checkpoints, history, backups, locks. */
  state: string;
  /** Pulumi work directory — the generated project and per-stack settings. */
  work: string;
}

/**
 * Resolves the directory layout under the given sandbox home directory. The
 * work directory is scoped per project so two sandboxes sharing a home never
 * fight over the generated project file; the state directory is shared, as
 * the DIY backend already namespaces checkpoints by project.
 */
export function resolveDirectories(homeDirectory: string, projectName: string): SandboxDirectories {
  const home = path.resolve(homeDirectory);
  return {
    home,
    state: path.join(home, "state"),
    work: path.join(home, "work", projectName),
  };
}

/**
 * Creates the sandbox directories. Both must exist before the Pulumi
 * workspace is constructed: the file backend needs somewhere to write its
 * checkpoint, and the work directory receives the generated project file.
 */
export function ensureDirectories(directories: SandboxDirectories): void {
  fs.mkdirSync(directories.state, { recursive: true });
  fs.mkdirSync(directories.work, { recursive: true });
}
