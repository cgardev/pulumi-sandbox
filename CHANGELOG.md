# Changelog

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
