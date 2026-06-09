import path from "node:path";
import fs from "node:fs";

/**
 * A named volume layered over a bind mount, identified by a stable key. The
 * key is meant to be combined with a per-developer volume prefix into the
 * physical volume name.
 */
export interface MaskVolume {
  /** Stable, human-readable identifier derived from the rule and the repository path. */
  key: string;
  /** Where the volume mounts inside the container. */
  containerPath: string;
}

/**
 * Declares which directories a project tree generates locally and must
 * therefore be masked. A rule fires in every walked directory containing one
 * of its marker files; the rule's `mask` entries (and whatever `expand`
 * derives from the marker's content) become container-local volumes.
 *
 * The library has no knowledge of any build tool — rules carry all of it.
 * A JVM-and-Node repository, for example, is fully described by:
 *
 * ```typescript
 * const rules: MaskRule[] = [
 *   { prefix: "build", markers: ["build.gradle.kts", "settings.gradle.kts"], mask: ["build"] },
 *   { prefix: "gradle", markers: ["settings.gradle.kts"], mask: [".gradle"] },
 *   { prefix: "node-modules", markers: ["package.json"], mask: ["node_modules"] },
 * ];
 * ```
 */
export interface MaskRule {
  /** Prefix for the volume keys this rule produces. */
  prefix: string;

  /** File names whose presence marks a directory as governed by this rule. */
  markers: readonly string[];

  /** Directories to mask, relative to the marked directory. */
  mask: readonly string[];

  /**
   * Optional expansion hook: derives additional directories to mask from the
   * content of the matched marker file — for build systems whose
   * configuration references sibling project roots. Returned paths are
   * resolved against the marker's directory.
   */
  expand?: (markerPath: string, content: string) => readonly string[];
}

export interface DiscoverMaskVolumesOptions {
  /** Where the repository is bind-mounted inside the container, e.g. `/workspace`. */
  containerRoot: string;

  /** The rules describing which directories to mask. */
  rules: readonly MaskRule[];

  /**
   * Directory names never descended into, on top of the masked directories
   * themselves and dot-directories (always skipped).
   */
  prune?: readonly string[];
}

/**
 * Walks a repository and returns one container-local mask volume for every
 * directory the given rules mark as locally generated — directories whose
 * contents must not round-trip between the host bind mount and the
 * container, which is essential when host and container run different
 * platforms (a Windows host building inside a Linux container, for example).
 *
 * Detection keys off the marker files — which exist from the first
 * checkout — never off the masked directories themselves, so a directory
 * that does not exist yet is still masked: docker creates the empty volume
 * on first start and the first in-container build writes there, never back
 * to the host. Add a module to the repository and its masks appear on the
 * next `create`, with no list to maintain.
 */
export function discoverMaskVolumes(rootDirectory: string, options: DiscoverMaskVolumesOptions): MaskVolume[] {
  const root = path.resolve(rootDirectory);
  const masked = new Set(options.rules.flatMap((rule) => rule.mask.map((leaf) => path.basename(leaf))));
  const prune = new Set([...masked, ...(options.prune ?? [])]);
  const volumes: MaskVolume[] = [];
  const seen = new Set<string>();

  const mask = (prefix: string, absoluteDirectory: string, leaf: string): void => {
    const relative = path.relative(root, path.resolve(absoluteDirectory, leaf));
    const containerPath = path.posix.join(options.containerRoot, relative.replace(/\\/g, "/"));
    if (seen.has(containerPath)) {
      return;
    }
    seen.add(containerPath);
    volumes.push({ key: `${prefix}--${slug(path.dirname(relative))}`, containerPath });
  };

  const walk = (absoluteDirectory: string): void => {
    for (const rule of options.rules) {
      const markerPath = firstExisting(absoluteDirectory, rule.markers);
      if (markerPath === undefined) {
        continue;
      }
      for (const leaf of rule.mask) {
        mask(rule.prefix, absoluteDirectory, leaf);
      }
      if (rule.expand) {
        const content = fs.readFileSync(markerPath, "utf-8");
        for (const expanded of rule.expand(markerPath, content)) {
          for (const leaf of rule.mask) {
            mask(rule.prefix, path.resolve(absoluteDirectory, expanded), leaf);
          }
        }
      }
    }

    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && !prune.has(entry.name) && !entry.name.startsWith(".")) {
        walk(path.join(absoluteDirectory, entry.name));
      }
    }
  };

  walk(root);
  return volumes;
}

function slug(relativeDirectory: string): string {
  const normalized = relativeDirectory.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized === "" || normalized === "." ? "root" : normalized.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
}

function firstExisting(directory: string, names: readonly string[]): string | undefined {
  return names.map((name) => path.join(directory, name)).find((candidate) => fs.existsSync(candidate));
}
