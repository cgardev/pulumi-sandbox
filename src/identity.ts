import fs from "node:fs";
import { SandboxConfigurationError } from "./errors.js";

/** Environment variable that carries the developer identity. */
export const DEV_ID_VARIABLE = "SANDBOX_DEV_ID";

/**
 * Default developer identity when none is configured. A single-developer
 * machine works out of the box; teams opt into explicit ids with
 * `require: true`.
 */
export const DEFAULT_DEV_ID = "local";

const DEV_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface DevIdOptions {
  /** Explicit developer id; takes precedence over every other source. */
  devId?: string;

  /**
   * Optional `KEY=value` file consulted when the environment variable is not
   * set — typically a git-ignored `.env` next to the infrastructure entry
   * point, so each developer configures their identity once per checkout.
   */
  envFile?: string;

  /**
   * Fail instead of falling back to {@link DEFAULT_DEV_ID}. Teams sharing a
   * remote backend set this so two developers can never collide on the
   * default stack.
   */
  require?: boolean;

  /** Environment to read from; defaults to `process.env`. */
  environment?: Record<string, string | undefined>;
}

/**
 * Resolves the developer identity that isolates stacks, containers, and
 * volumes per developer. Resolution order: the explicit `devId` option, the
 * `SANDBOX_DEV_ID` environment variable, the optional `envFile`, then
 * {@link DEFAULT_DEV_ID}.
 *
 * The id becomes part of stack names, container names, and volume names, so
 * it is restricted to lowercase letters, digits, and dashes.
 */
export function resolveDevId(options: DevIdOptions = {}): string {
  const environment = options.environment ?? process.env;

  if (options.devId !== undefined) {
    return validateDevId(options.devId.trim());
  }

  const fromEnvironment = environment[DEV_ID_VARIABLE]?.trim();
  if (fromEnvironment) {
    return validateDevId(fromEnvironment);
  }

  if (options.envFile !== undefined) {
    const fromFile = readEnvFile(options.envFile)?.[DEV_ID_VARIABLE]?.trim();
    if (fromFile) {
      return validateDevId(fromFile);
    }
  }

  if (options.require) {
    throw new SandboxConfigurationError(
      "No developer id is configured, and this sandbox requires one.",
      [
        `Set the ${DEV_ID_VARIABLE} environment variable to a short personal id (for example: jdoe),`,
        ...(options.envFile !== undefined ? [`or add "${DEV_ID_VARIABLE}=jdoe" to ${options.envFile}.`] : []),
      ],
    );
  }

  return DEFAULT_DEV_ID;
}

function validateDevId(devId: string): string {
  if (!DEV_ID_PATTERN.test(devId)) {
    throw new SandboxConfigurationError(
      `The developer id "${devId}" is not usable in stack and container names.`,
      ["Use lowercase letters, digits, and dashes, starting with a letter or digit (for example: jdoe)."],
    );
  }
  return devId;
}

/**
 * Parses `KEY=value` content in the dotenv style: blank lines and lines
 * starting with `#` are skipped, the first `=` separates key from value, and
 * both sides are trimmed. No quoting or interpolation — sandbox
 * configuration files stay trivially predictable.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator > 0) {
      values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }
  }
  return values;
}

/**
 * Reads and parses a `KEY=value` file, returning `undefined` when the file
 * does not exist so callers can distinguish "not configured" from "empty".
 */
export function readEnvFile(filePath: string): Record<string, string> | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return parseEnvFile(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Interprets a configuration value as a boolean flag. Accepts `true`,
 * `false`, `1`, `0`, `yes`, `no`, `on`, and `off` case-insensitively;
 * anything else — including a missing value — yields `defaultValue`.
 */
export function booleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return defaultValue;
}
