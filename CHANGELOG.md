# Changelog

## 0.2.0 (unreleased)

- Added plugins — modules that project the sandbox onto developer tooling,
  with no Pulumi involvement:
  - `@cgardev/pulumi-sandbox/plugins/intellij`: generates IntelliJ data
    sources (`dataSources.xml` + `dataSources.local.xml`) for the databases a
    sandbox provisions, with name-derived stable UUIDs and optional embedded
    credentials.
  - `@cgardev/pulumi-sandbox/plugins/bookmarks`: generates a Chrome-importable
    bookmarks file for the consoles and dashboards a sandbox exposes.

## 0.1.2 (2026-06-09)

- Rewrote the README: a real explanation of where the library comes from,
  honest caveats, and less mechanical prose. No code changes.

## 0.1.1 (2026-06-09)

- Renamed the package to `@cgardev/pulumi-sandbox`: the scoped name puts the
  publisher's namespace first, so no affiliation with Pulumi Corporation can
  be implied. The deprecated `pulumi-sandbox` name will not receive updates.
- Added the non-affiliation notice to the README and the package description.

## 0.1.0 (2026-06-09)

Initial release.

- `sandbox()` entry point: lifecycle dispatch (`create`, `destroy`, `reset`,
  `preview`, `cancel`, `outputs`), interactive menu, `help`, custom commands,
  friendly error rendering with honest exit codes.
- Zero-configuration local `file://` backend under `.sandbox/`, with
  per-developer stack isolation via `SANDBOX_DEV_ID`.
- Self-healing lifecycle: refresh folded into create and destroy, plus state
  surgery for container-hosted providers (purge on destroy, purge-and-retry
  on create).
- Developer-experience helpers: `EnvironmentFile`, `deepResolve`,
  `waitForHttp` / `readyWhenHttp`, `findGitRoot`.
- Docker utilities under `@cgardev/pulumi-sandbox/docker`: `attachShell`,
  `dockerExec`, and rule-driven `discoverMaskVolumes`.
