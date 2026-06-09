import path from "node:path";
import fs from "node:fs";
import { automation } from "@pulumi/pulumi";
import { ACTION_DESCRIPTIONS, LIFECYCLE_ACTIONS, isLifecycleAction, type LifecycleAction } from "./actions.js";
import { ensureDirectories, fileBackendUrl, resolveDirectories } from "./backend.js";
import { SandboxConfigurationError, SandboxLockError } from "./errors.js";
import { resolveDevId } from "./identity.js";
import { runInteractiveMenu } from "./interactive.js";
import { cancelStack, createStack, destroyStack, previewStack, printOutputs, type StackHost } from "./lifecycle.js";
import { bold, cyan, dim, fail, heading, succeed } from "./terminal.js";

const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Default passphrase for the local secrets provider — see {@link SandboxOptions.passphrase}. */
export const DEFAULT_PASSPHRASE = "sandbox";

export interface SandboxOptions {
  /**
   * Project name. It becomes the Pulumi project, prefixes the stack name,
   * and seeds {@link SandboxContext.physicalName} — lowercase letters,
   * digits, and dashes.
   */
  name: string;

  /** Explicit developer id; usually left unset and resolved from the environment. */
  devId?: string | undefined;

  /**
   * Refuse to fall back to the `local` developer id. Set this when the team
   * shares a remote backend and accidental stack collisions must be
   * impossible.
   */
  requireDevId?: boolean | undefined;

  /**
   * Optional `KEY=value` file (typically a git-ignored `.env`) consulted for
   * `SANDBOX_DEV_ID` when the environment variable is not set.
   */
  envFile?: string | undefined;

  /**
   * Pulumi backend URL. Defaults to a self-contained `file://` backend under
   * {@link SandboxOptions.homeDir} — no cloud account, no login. Point it at
   * `s3://...` (or any other DIY backend) to share state remotely.
   */
  backendUrl?: string | undefined;

  /**
   * Directory holding sandbox state and the Pulumi work directory. Defaults
   * to `.sandbox` in the package containing the entry script (the nearest
   * directory with a `package.json`, falling back to the entry script's
   * directory) — anchored there rather than to the working directory, so
   * invoking the sandbox from anywhere targets the same state. Add it to
   * `.gitignore`.
   */
  homeDir?: string | undefined;

  /**
   * Passphrase for Pulumi's secrets provider. Local sandboxes hold
   * throwaway development credentials, so a well-known default keeps the
   * zero-configuration promise; override it (or set
   * `PULUMI_CONFIG_PASSPHRASE`) when the backend is shared.
   */
  passphrase?: string | undefined;

  /**
   * Names of provider resources whose backing service lives in a container
   * this sandbox manages — for example `"identity"` when the program
   * declares `new keycloak.Provider("identity", ...)` against a Keycloak
   * container it also creates. These providers get state surgery during
   * destroy (and on create retries), so tearing down or recreating the
   * container never requires talking to the service it hosted.
   */
  containerHostedProviders?: readonly string[] | undefined;

  /**
   * Additional command line verbs, dispatched before any Pulumi machinery
   * is initialized — ideal for fast utilities like opening a shell inside a
   * running container.
   */
  commands?: Record<string, SandboxCommand> | undefined;

  /** Command line arguments; defaults to `process.argv.slice(2)`. */
  argv?: readonly string[] | undefined;
}

/**
 * The program's view of the sandbox while resources are being declared.
 *
 * The program runs for operations that need the resource graph — `create`,
 * `preview`, and the create half of `reset`. A `destroy` works from the
 * recorded state and does not execute the program, so no destroy-time
 * guards are needed in it.
 */
export interface SandboxContext {
  readonly projectName: string;
  readonly devId: string;
  readonly stackName: string;

  /**
   * The lifecycle operation currently executing the program — `create` or
   * `preview`. Use it to confine side effects like writing generated
   * artifacts to real create runs:
   *
   * ```typescript
   * if (context.action === "create") {
   *   environment.write("generated/application.env");
   * }
   * ```
   */
  readonly action: LifecycleAction;

  /**
   * Builds a developer-scoped physical resource name:
   * `physicalName("postgres")` → `myproject-postgres-jdoe`. Use it for
   * container names, volume prefixes, and anything else that must not
   * collide between developers on one machine.
   */
  physicalName(...parts: string[]): string;
}

/** The context handed to custom commands; no Pulumi machinery is involved. */
export interface SandboxCommandContext {
  readonly projectName: string;
  readonly devId: string;
  readonly stackName: string;
  /** Arguments after the command verb. */
  readonly argv: readonly string[];
  physicalName(...parts: string[]): string;
}

/** A custom command line verb registered through {@link SandboxOptions.commands}. */
export interface SandboxCommand {
  /** One-line description shown by `help`. */
  description: string;
  /** Runs the command; a returned number becomes the process exit code. */
  run(context: SandboxCommandContext): number | void | Promise<number | void>;
}

/** Values returned by the program; they become the stack outputs. */
export type SandboxOutputs = Record<string, unknown>;

/** The infrastructure program: a plain Pulumi inline program with a sandbox context. */
export type SandboxProgram = (context: SandboxContext) => SandboxOutputs | void | Promise<SandboxOutputs | void>;

/**
 * A fully wired sandbox: the Pulumi stack (file backend, work directory,
 * passphrase) plus the lifecycle operations. Most programs never construct
 * one directly — {@link sandbox} builds it and dispatches the command line —
 * but it is the entry point for programmatic control and tests.
 */
export class Sandbox {
  readonly projectName: string;
  readonly devId: string;
  readonly stackName: string;

  /** The underlying automation stack, for operations the lifecycle does not cover. */
  readonly stack: automation.Stack;

  readonly #host: StackHost;
  readonly #state: { action: LifecycleAction };

  /** @internal Use {@link createSandbox}. */
  constructor(
    identity: SandboxIdentity,
    stack: automation.Stack,
    state: { action: LifecycleAction },
    containerHostedProviders: readonly string[],
  ) {
    this.projectName = identity.projectName;
    this.devId = identity.devId;
    this.stackName = identity.stackName;
    this.stack = stack;
    this.#state = state;
    this.#host = { stack, stackName: identity.stackName, containerHostedProviders };
  }

  /** Runs one lifecycle action against the stack. */
  async run(action: LifecycleAction): Promise<void> {
    switch (action) {
      case "create":
        this.#state.action = "create";
        await createStack(this.#host);
        succeed(`Sandbox ${this.stackName} is ready.`);
        return;
      case "destroy":
        this.#state.action = "destroy";
        await destroyStack(this.#host);
        succeed(`Sandbox ${this.stackName} is gone.`);
        return;
      case "reset":
        await this.run("destroy");
        await this.run("create");
        return;
      case "preview":
        this.#state.action = "preview";
        await previewStack(this.#host);
        return;
      case "cancel":
        await cancelStack(this.#host);
        succeed("State lock released.");
        return;
      case "outputs":
        await printOutputs(this.#host);
        return;
    }
  }

  create(): Promise<void> {
    return this.run("create");
  }

  destroy(): Promise<void> {
    return this.run("destroy");
  }

  reset(): Promise<void> {
    return this.run("reset");
  }

  preview(): Promise<void> {
    return this.run("preview");
  }

  cancel(): Promise<void> {
    return this.run("cancel");
  }
}

interface SandboxIdentity {
  projectName: string;
  devId: string;
  stackName: string;
  physicalName(...parts: string[]): string;
}

function resolveIdentity(options: SandboxOptions): SandboxIdentity {
  if (!PROJECT_NAME_PATTERN.test(options.name)) {
    throw new SandboxConfigurationError(
      `The sandbox name "${options.name}" is not usable in stack and container names.`,
      ["Use lowercase letters, digits, and dashes, starting with a letter or digit (for example: acme-shop)."],
    );
  }
  const devId = resolveDevId({
    devId: options.devId,
    envFile: options.envFile,
    require: options.requireDevId,
  });
  return {
    projectName: options.name,
    devId,
    stackName: `${options.name}-${devId}`,
    physicalName: (...parts) => [options.name, ...parts, devId].join("-"),
  };
}

/**
 * The default sandbox home: `.sandbox` in the package containing the entry
 * script. Anchoring to the entry script rather than the working directory
 * means `node tool/sandbox.ts destroy` targets the same state from any
 * directory — a sandbox invoked from the wrong place must never conclude
 * there is nothing to destroy.
 */
function defaultHomeDirectory(): string {
  const entry = process.argv[1];
  let directory = entry !== undefined ? path.dirname(path.resolve(entry)) : process.cwd();
  let current = directory;
  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      directory = current;
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.join(directory, ".sandbox");
}

/**
 * Builds a {@link Sandbox} without dispatching any action: resolves the
 * developer identity, prepares the local backend and work directory, and
 * creates or selects the stack with the inline program wired in.
 */
export async function createSandbox(options: SandboxOptions, program: SandboxProgram): Promise<Sandbox> {
  const identity = resolveIdentity(options);

  const directories = resolveDirectories(options.homeDir ?? defaultHomeDirectory(), identity.projectName);
  ensureDirectories(directories);
  const backendUrl = options.backendUrl ?? fileBackendUrl(directories.state);
  const passphrase = options.passphrase ?? process.env.PULUMI_CONFIG_PASSPHRASE ?? DEFAULT_PASSPHRASE;

  const state: { action: LifecycleAction } = { action: "preview" };
  const context: SandboxContext = {
    projectName: identity.projectName,
    devId: identity.devId,
    stackName: identity.stackName,
    get action() {
      return state.action;
    },
    physicalName: identity.physicalName,
  };

  try {
    const stack = await automation.LocalWorkspace.createOrSelectStack(
      {
        stackName: identity.stackName,
        projectName: identity.projectName,
        program: async () => (await program(context)) ?? undefined,
      },
      {
        workDir: directories.work,
        projectSettings: {
          name: identity.projectName,
          runtime: "nodejs",
          backend: { url: backendUrl },
        },
        envVars: { PULUMI_CONFIG_PASSPHRASE: passphrase },
      },
    );
    return new Sandbox(identity, stack, state, options.containerHostedProviders ?? []);
  } catch (error) {
    throw translateWorkspaceError(error);
  }
}

/**
 * The complete sandbox entry point: resolves the action from the command
 * line, runs custom commands without touching Pulumi, drives the lifecycle
 * for the rest, and renders every failure as a friendly message plus a
 * non-zero exit code.
 *
 * ```typescript
 * await sandbox({ name: "acme-shop" }, (context) => {
 *   // plain Pulumi resources — containers, databases, providers
 * });
 * ```
 *
 * Invoked as `node infra.ts <action>` with `create | destroy | reset |
 * preview | cancel | outputs`, any custom command, `help`, or no action at
 * all for the interactive menu.
 */
export async function sandbox(options: SandboxOptions, program: SandboxProgram): Promise<void> {
  const argv = [...(options.argv ?? process.argv.slice(2))];
  const verb = argv[0] ?? "interactive";

  try {
    if (verb === "help" || verb === "--help" || verb === "-h") {
      printHelp(options);
      return;
    }

    const command =
      options.commands !== undefined && Object.hasOwn(options.commands, verb) ? options.commands[verb] : undefined;
    if (command !== undefined) {
      const exitCode = await command.run({ ...resolveIdentity(options), argv: argv.slice(1) });
      if (typeof exitCode === "number" && exitCode !== 0) {
        process.exitCode = exitCode;
      }
      return;
    }

    if (verb !== "interactive" && !isLifecycleAction(verb)) {
      throw new SandboxConfigurationError(`Unknown action "${verb}".`, [
        `Available actions: ${[...LIFECYCLE_ACTIONS, ...Object.keys(options.commands ?? {})].join(", ")} — or "help".`,
      ]);
    }

    const instance = await createSandbox(options, program);

    // The `outputs` verb keeps stdout machine-readable: nothing but JSON.
    if (verb !== "outputs") {
      heading(instance.projectName, instance.stackName, verb);
    }

    if (verb === "interactive") {
      await runInteractiveMenu({
        run: (action) => instance.run(action),
        reportFailure,
      });
      return;
    }

    await instance.run(verb);
  } catch (error) {
    reportFailure(error);
    process.exitCode = 1;
  }
}

function printHelp(options: SandboxOptions): void {
  process.stdout.write(`\n${bold(options.name)} — local development sandbox\n\n`);
  process.stdout.write(`Usage: node <entry-file> ${cyan("<action>")}\n\n`);
  for (const action of LIFECYCLE_ACTIONS) {
    process.stdout.write(`  ${bold(action.padEnd(10))} ${dim(ACTION_DESCRIPTIONS[action])}\n`);
  }
  for (const [verb, command] of Object.entries(options.commands ?? {})) {
    process.stdout.write(`  ${bold(verb.padEnd(10))} ${dim(command.description)}\n`);
  }
  process.stdout.write(`\nWithout an action, an interactive menu opens.\n`);
}

function reportFailure(error: unknown): void {
  if (error instanceof SandboxConfigurationError) {
    fail(error.message, error.remediation);
    return;
  }
  if (error instanceof SandboxLockError) {
    fail(error.message, ['Release it with the "cancel" action once you are sure no other update is running.']);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);

  // Failures of Pulumi operations arrive as a dump that repeats everything
  // already streamed live; the only new information is the error lines.
  const errorLines = [...new Set(message.split("\n").filter((line) => line.trimStart().startsWith("error:")))];
  if (errorLines.length > 0) {
    fail("The Pulumi operation failed.", errorLines);
    return;
  }
  fail(message);
}

function translateWorkspaceError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT") && message.toLowerCase().includes("pulumi")) {
    return new SandboxConfigurationError("The Pulumi CLI is not installed (or not on the PATH).", [
      "Install it from https://www.pulumi.com/docs/install/ — no Pulumi account is needed,",
      "the sandbox keeps its state in a local file backend.",
    ]);
  }
  return error;
}
