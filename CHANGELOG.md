# Changelog

## 0.1.0 (unreleased)

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
- Docker utilities under `pulumi-sandbox-os/docker`: `attachShell`,
  `dockerExec`, and rule-driven `discoverMaskVolumes`.
