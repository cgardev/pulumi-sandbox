import readline from "node:readline/promises";
import { ACTION_DESCRIPTIONS, LIFECYCLE_ACTIONS, isLifecycleAction, type LifecycleAction } from "./actions.js";
import { bold, cyan, dim, warn } from "./terminal.js";

/** What the interactive menu needs from the sandbox driving it. */
export interface InteractiveHost {
  run(action: LifecycleAction): Promise<void>;
  /** Renders a failed action without ending the session. */
  reportFailure(error: unknown): void;
}

/**
 * A small menu over the lifecycle actions, used when the sandbox is invoked
 * without an action. Failed actions are reported and the menu returns, so a
 * developer can run `cancel` right after a lock error or retry a `create`
 * without restarting the process.
 */
export async function runInteractiveMenu(host: InteractiveHost): Promise<void> {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  // End-of-input (Ctrl+D, a closed pipe) must end the menu, not leave the
  // pending question unsettled forever.
  const closed = new Promise<string>((resolve) => {
    input.once("close", () => resolve("exit"));
  });
  try {
    while (true) {
      process.stdout.write("\n");
      LIFECYCLE_ACTIONS.forEach((action, index) => {
        process.stdout.write(`  ${cyan(String(index + 1))}  ${bold(action.padEnd(8))} ${dim(ACTION_DESCRIPTIONS[action])}\n`);
      });
      process.stdout.write(`  ${cyan("0")}  ${bold("exit".padEnd(8))} ${dim("Leave the menu")}\n\n`);

      const answer = (await Promise.race([input.question(`${cyan("›")} action: `), closed])).trim().toLowerCase();
      if (answer === "0" || answer === "exit" || answer === "quit" || answer === "q") {
        return;
      }

      const byNumber = /^[0-9]+$/.test(answer) ? LIFECYCLE_ACTIONS[Number(answer) - 1] : undefined;
      const action = byNumber ?? (isLifecycleAction(answer) ? answer : undefined);
      if (action === undefined) {
        warn(`"${answer}" is not an action — pick a number or name from the list.`);
        continue;
      }

      try {
        await host.run(action);
      } catch (error) {
        host.reportFailure(error);
      }
    }
  } finally {
    input.close();
  }
}
