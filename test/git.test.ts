import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findGitRoot } from "../src/index.js";

describe("findGitRoot", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "git-root-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds the repository root from a nested directory", () => {
    fs.mkdirSync(path.join(root, ".git"));
    const nested = path.join(root, "a", "b");
    fs.mkdirSync(nested, { recursive: true });

    expect(findGitRoot(nested)).toBe(root);
  });

  it("recognizes a .git pointer file, as used by worktrees and submodules", () => {
    fs.writeFileSync(path.join(root, ".git"), "gitdir: /somewhere/else\n");

    expect(findGitRoot(root)).toBe(root);
  });

  it("returns undefined outside a repository", () => {
    expect(findGitRoot(root)).toBeUndefined();
  });
});
