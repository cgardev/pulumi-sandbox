import path from "node:path";
import fs from "node:fs";

/**
 * Finds the root of the git repository containing `startDirectory` (default:
 * the current working directory) by walking up until a `.git` entry appears.
 * Returns `undefined` outside a repository.
 *
 * Both a `.git` directory (regular checkout) and a `.git` file (worktrees
 * and submodules store a pointer file instead) count, so sandboxes work from
 * any kind of checkout.
 */
export function findGitRoot(startDirectory: string = process.cwd()): string | undefined {
  let current = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}
