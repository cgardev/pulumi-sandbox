/**
 * Base class for every error raised by the sandbox harness. Library code
 * throws typed errors and never calls `process.exit` itself; the command
 * line dispatcher in `sandbox()` converts them into friendly output and an
 * exit code, so the same functions stay usable from tests and custom tools.
 */
export class SandboxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The sandbox cannot start because the developer machine or configuration is
 * incomplete (missing developer id, Pulumi CLI not installed, invalid
 * option values). Carries remediation lines that the dispatcher prints under
 * the error message.
 */
export class SandboxConfigurationError extends SandboxError {
  /** Remediation steps shown to the developer, one line each. */
  readonly remediation: readonly string[];

  constructor(message: string, remediation: readonly string[] = [], options?: { cause?: unknown }) {
    super(message, options);
    this.remediation = remediation;
  }
}

/**
 * Another process holds the Pulumi state lock for this stack — usually a
 * previous run that was interrupted. Surfaced as a hint to run the `cancel`
 * action instead of a stack trace, and never swallowed, so a `reset` whose
 * destroy half hits the lock does not silently proceed to create.
 */
export class SandboxLockError extends SandboxError {
  readonly stackName: string;

  constructor(stackName: string) {
    super(`The stack "${stackName}" is locked by another update.`);
    this.stackName = stackName;
  }
}

/**
 * A value could not be rendered into an environment file — an `undefined` or
 * `null` slipped into the declared values, typically an unresolved Pulumi
 * output or a missing configuration entry. Failing loudly here keeps the
 * poisoned value out of the generated file.
 */
export class EnvironmentFileError extends SandboxError {}
