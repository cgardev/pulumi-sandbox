import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {discoverMaskVolumes, type MaskRule} from "../src/docker/index.js";

const RULES: MaskRule[] = [
  { prefix: "build",
    markers: ["build.gradle.kts", "settings.gradle.kts"], mask: ["build"] },
  {
    prefix: "gradle",
    markers: ["settings.gradle.kts"],
    mask: [".gradle"],
    expand: (_markerPath, content) =>
      [...content.matchAll(/includeBuild\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1] as string),
  },
  { prefix: "node-modules", markers: ["package.json"], mask: ["node_modules"] },
];

describe("discoverMaskVolumes", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mask-volumes-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function file(relativePath: string, content = ""): void {
    const absolute = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }

  it("masks directories based on marker files, even before they exist", () => {
    file("backend/settings.gradle.kts");
    file("backend/module/build.gradle.kts");
    file("frontend/package.json");

    const volumes = discoverMaskVolumes(root, { containerRoot: "/workspace", rules: RULES });

    expect(volumes).toEqual(
      expect.arrayContaining([
        { key: "build--backend", containerPath: "/workspace/backend/build" },
        { key: "gradle--backend", containerPath: "/workspace/backend/.gradle" },
        { key: "build--backend-module", containerPath: "/workspace/backend/module/build" },
        { key: "node-modules--frontend", containerPath: "/workspace/frontend/node_modules" },
      ]),
    );
  });

  it("expands additional roots from the marker file content", () => {
    file("backend/settings.gradle.kts", 'includeBuild("../build-logic")\n');
    file("build-logic/settings.gradle.kts");

    const volumes = discoverMaskVolumes(root, { containerRoot: "/workspace", rules: RULES });
    const gradleMasks = volumes.filter((volume) => volume.key.startsWith("gradle--"));

    expect(gradleMasks).toEqual(
      expect.arrayContaining([
        { key: "gradle--backend", containerPath: "/workspace/backend/.gradle" },
        { key: "gradle--build-logic", containerPath: "/workspace/build-logic/.gradle" },
      ]),
    );
    expect(gradleMasks).toHaveLength(2);
  });

  it("masks the repository root with a stable key", () => {
    file("package.json");

    const volumes = discoverMaskVolumes(root, { containerRoot: "/workspace", rules: RULES });

    expect(volumes).toEqual([{ key: "node-modules--root", containerPath: "/workspace/node_modules" }]);
  });

  it("never descends into masked, pruned, or dot directories", () => {
    file("frontend/package.json");
    file("frontend/node_modules/dependency/package.json");
    file(".hidden/package.json");
    file("generated/package.json");

    const volumes = discoverMaskVolumes(root, {
      containerRoot: "/workspace",
      rules: RULES,
      prune: ["generated"],
    });

    expect(volumes).toEqual([{ key: "node-modules--frontend", containerPath: "/workspace/frontend/node_modules" }]);
  });
});
