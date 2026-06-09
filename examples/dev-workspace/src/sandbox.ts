import * as docker from "@pulumi/docker";
import { findGitRoot, sandbox } from "@cgardev/pulumi-sandbox";
import { attachShell, discoverMaskVolumes, type MaskRule } from "@cgardev/pulumi-sandbox/docker";

// A containerized development workspace: the repository is bind-mounted at
// /workspace, while everything the build generates lives on container-local
// volumes layered over that bind — so nothing platform-specific ever
// round-trips through the host filesystem. Attach with `pnpm sandbox:shell`.

const REPOSITORY_ROOT = findGitRoot();
if (REPOSITORY_ROOT === undefined) {
  throw new Error("This sandbox bind-mounts the repository and must run inside a git checkout.");
}

// What this repository generates locally, described as rules: the library
// walks the tree and produces one mask volume per match, with no list of
// modules to maintain.
const MASK_RULES: MaskRule[] = [
  { prefix: "build", markers: ["build.gradle.kts", "settings.gradle.kts"], mask: ["build"] },
  {
    prefix: "gradle",
    markers: ["settings.gradle.kts"],
    mask: [".gradle"],
    // Gradle composite builds: every includeBuild("...") root caches too.
    expand: (_markerPath, content) =>
      [...content.matchAll(/includeBuild\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1] as string),
  },
  { prefix: "node-modules", markers: ["package.json"], mask: ["node_modules"] },
];

await sandbox(
  {
    name: "workspace",
    commands: {
      shell: {
        description: "Open a shell inside the running workspace container",
        run: ({ physicalName, argv }) =>
          attachShell(physicalName("dev"), argv[0] === undefined ? {} : { shell: argv[0] }),
      },
    },
  },
  (context) => {
    const containerName = context.physicalName("dev");

    const image = new docker.RemoteImage("workspace-image", {
      name: "mcr.microsoft.com/devcontainers/base:ubuntu",
      keepLocally: true,
    });

    // The user's home persists across recreations (shell history, tool
    // logins), plus one mask volume per generated directory in the tree.
    const masks = [
      { key: "home", containerPath: "/home/vscode" },
      ...discoverMaskVolumes(REPOSITORY_ROOT, { containerRoot: "/workspace", rules: MASK_RULES }),
    ];

    const volumes = masks.map((mask) => {
      const volume = new docker.Volume(`volume-${mask.key}`, { name: `${containerName}--${mask.key}` });
      return { volumeName: volume.name, containerPath: mask.containerPath };
    });

    new docker.Container(
      "workspace",
      {
        image: image.imageId,
        name: containerName,
        hostname: containerName,
        volumes: [{ hostPath: REPOSITORY_ROOT, containerPath: "/workspace" }, ...volumes],
        // Reach services on the developer machine as host.docker.internal.
        hosts: [{ host: "host.docker.internal", ip: "host-gateway" }],
        workingDir: "/workspace",
        command: ["sleep", "infinity"],
        restart: "unless-stopped",
        mustRun: true,
      },
      { deleteBeforeReplace: true },
    );
  },
);
