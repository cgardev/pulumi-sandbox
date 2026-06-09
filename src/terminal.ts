/**
 * Minimal terminal presentation layer for the lifecycle dispatcher. Colors
 * are applied only when standard output is an interactive terminal and the
 * `NO_COLOR` convention is respected, so logs captured in files or CI stay
 * clean. This module is internal to the library on purpose: programs should
 * not depend on its exact output.
 */

const colorEnabled =
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";

function style(open: number, close: number): (text: string) => string {
  return (text) => (colorEnabled ? `\u001B[${open}m${text}\u001B[${close}m` : text);
}

export const bold = style(1, 22);
export const dim = style(2, 22);
export const red = style(31, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
export const cyan = style(36, 39);

/** Whether the Pulumi CLI should be asked for colored output. */
export function colorMode(): "always" | "never" {
  return colorEnabled ? "always" : "never";
}

/** Opening line of every run: project, stack, and the action about to run. */
export function heading(project: string, stackName: string, action: string): void {
  process.stdout.write(`\n${bold(cyan(project))} ${dim("·")} stack ${bold(stackName)} ${dim("·")} ${action}\n\n`);
}

/** A lifecycle step about to start, e.g. "refreshing and updating the stack". */
export function step(message: string): void {
  process.stdout.write(`${cyan("›")} ${message}\n`);
}

/** A successfully completed lifecycle action. */
export function succeed(message: string): void {
  process.stdout.write(`\n${green("✔")} ${message}\n`);
}

/** A non-fatal problem the run recovered from or chose to ignore. */
export function warn(message: string): void {
  process.stdout.write(`${yellow("⚠")} ${message}\n`);
}

/** A fatal problem, followed by optional remediation lines. */
export function fail(message: string, remediation: readonly string[] = []): void {
  process.stderr.write(`\n${red("✖")} ${bold(message)}\n`);
  for (const line of remediation) {
    process.stderr.write(`  ${line}\n`);
  }
  if (remediation.length > 0) {
    process.stderr.write("\n");
  }
}

/** Secondary detail under a heading or step. */
export function detail(message: string): void {
  process.stdout.write(`${dim(message)}\n`);
}
