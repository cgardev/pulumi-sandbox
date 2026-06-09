/**
 * pulumi-sandbox — local development sandboxes as code.
 *
 * Write a plain Pulumi inline program describing the infrastructure your
 * application needs on a developer machine; this library supplies everything
 * around it: a self-contained local backend, per-developer stack isolation,
 * a complete lifecycle command line, recovery from half-dead environments,
 * and the helpers that turn resolved outputs into environment files.
 */

export { sandbox, createSandbox, Sandbox, DEFAULT_PASSPHRASE } from "./sandbox.js";
export type {
  SandboxOptions,
  SandboxProgram,
  SandboxOutputs,
  SandboxContext,
  SandboxCommand,
  SandboxCommandContext,
} from "./sandbox.js";

export { LIFECYCLE_ACTIONS, ACTION_DESCRIPTIONS, isLifecycleAction } from "./actions.js";
export type { LifecycleAction } from "./actions.js";

export { fileBackendUrl, resolveDirectories, ensureDirectories } from "./backend.js";
export type { SandboxDirectories } from "./backend.js";

export {
  resolveDevId,
  parseEnvFile,
  readEnvFile,
  booleanFlag,
  DEV_ID_VARIABLE,
  DEFAULT_DEV_ID,
} from "./identity.js";
export type { DevIdOptions } from "./identity.js";

export { EnvironmentFile } from "./environment-file.js";
export type { EnvironmentValue, EnvironmentValues } from "./environment-file.js";

export { deepResolve } from "./outputs.js";
export type { DeepResolved } from "./outputs.js";

export { waitForHttp, readyWhenHttp } from "./readiness.js";
export type { HttpProbeOptions, ReadyWhenHttpOptions } from "./readiness.js";

export { findGitRoot } from "./git.js";

export { purgeProviderFromState, removeProviderFromDeployment } from "./state-surgery.js";
export type { ProviderPurge } from "./state-surgery.js";

export { SandboxError, SandboxConfigurationError, SandboxLockError, EnvironmentFileError } from "./errors.js";
