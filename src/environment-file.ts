import fs from "node:fs";
import path from "node:path";
import { EnvironmentFileError } from "./errors.js";

/**
 * A value renderable into an environment file. Strings pass through,
 * numbers and booleans are stringified, and plain objects or arrays are
 * JSON-serialized — convenient for variables that carry structured
 * configuration (service discovery maps, feature matrices).
 */
export type EnvironmentValue = string | number | boolean | object;

/** A group of related variables, rendered together and separated from other groups by a blank line. */
export type EnvironmentValues = Record<string, EnvironmentValue>;

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Line = { kind: "entry"; key: string; value: EnvironmentValue } | { kind: "separator" };

/**
 * An ordered, incrementally-built `.env` file.
 *
 * Programs accumulate variables as the infrastructure comes together — static
 * ports first, then connection strings, then values that only exist once
 * Pulumi outputs resolve — and render the file at the end:
 *
 * ```typescript
 * const env = new EnvironmentFile([{ APP_HTTP_PORT: 8080 }]);
 * env.add({ DATABASE_URL: `postgresql://localhost:${db.hostPort}/app` });
 * env.write("application/.env.local");
 * ```
 *
 * Semantics:
 * - Insertion order is preserved; each {@link add} call starts a new group
 *   separated from the previous one by a blank line.
 * - Re-adding an existing key overwrites its value in place, so the file
 *   never contains duplicate keys and the layout stays stable.
 * - An empty string renders as a commented-out `# KEY=` line — present for
 *   discoverability, inactive for the loader.
 * - `undefined` and `null` throw {@link EnvironmentFileError} immediately:
 *   they are always a sign of an unresolved output or missing configuration,
 *   and a loud failure beats a poisoned environment file.
 */
export class EnvironmentFile {
  readonly #lines: Line[] = [];
  readonly #entries = new Map<string, Extract<Line, { kind: "entry" }>>();

  constructor(groups: readonly EnvironmentValues[] = []) {
    for (const group of groups) {
      this.add(group);
    }
  }

  /**
   * Adds a group of variables, overwriting values for keys that already
   * exist and appending the rest as a new blank-line-separated group.
   */
  add(values: EnvironmentValues): this {
    const additions: Array<readonly [string, EnvironmentValue]> = [];
    for (const [key, value] of Object.entries(values)) {
      this.#validate(key, value);
      const existing = this.#entries.get(key);
      if (existing) {
        existing.value = value;
      } else {
        additions.push([key, value]);
      }
    }

    if (additions.length > 0) {
      this.addSeparator();
      for (const [key, value] of additions) {
        const entry: Extract<Line, { kind: "entry" }> = { kind: "entry", key, value };
        this.#lines.push(entry);
        this.#entries.set(key, entry);
      }
    }
    return this;
  }

  /** Starts a new group; consecutive separators collapse into one blank line. */
  addSeparator(): this {
    if (this.#lines.length > 0 && this.#lines.at(-1)?.kind !== "separator") {
      this.#lines.push({ kind: "separator" });
    }
    return this;
  }

  /** Whether a variable has been declared. */
  has(key: string): boolean {
    return this.#entries.has(key);
  }

  /** The effective variables, each rendered to its final string form. */
  values(): Record<string, string> {
    const rendered: Record<string, string> = {};
    for (const [key, entry] of this.#entries) {
      rendered[key] = renderValue(entry.key, entry.value);
    }
    return rendered;
  }

  /** Renders the file content, ending with a newline. */
  render(): string {
    const rendered = this.#lines.map((line) => {
      if (line.kind === "separator") {
        return "";
      }
      const value = renderValue(line.key, line.value);
      return value === "" ? `# ${line.key}=` : `${line.key}=${value}`;
    });
    return `${rendered.join("\n")}\n`;
  }

  /** Renders and writes the file, creating parent directories as needed. */
  write(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, this.render());
  }

  #validate(key: string, value: EnvironmentValue): void {
    if (!KEY_PATTERN.test(key)) {
      throw new EnvironmentFileError(
        `"${key}" is not a valid environment variable name (letters, digits, and underscores only).`,
      );
    }
    if (value === undefined || value === null) {
      throw new EnvironmentFileError(
        `The value for "${key}" is ${String(value)} — typically an unresolved Pulumi output or missing configuration.`,
      );
    }
  }
}

function renderValue(key: string, value: EnvironmentValue): string {
  const rendered =
    typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (rendered.includes("\n")) {
    throw new EnvironmentFileError(`The value for "${key}" contains a newline, which would corrupt the file.`);
  }
  return rendered;
}
