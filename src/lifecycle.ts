import { automation } from "@pulumi/pulumi";
import { SandboxLockError } from "./errors.js";
import { purgeProviderFromState } from "./state-surgery.js";
import { colorMode, detail, step, warn } from "./terminal.js";

/** Everything the lifecycle operations need to act on a stack. */
export interface StackHost {
  stack: automation.Stack;
  stackName: string;
  /**
   * Names of provider resources whose backing service runs in a container
   * this sandbox manages — see {@link purgeProviderFromState} for why these
   * need special treatment.
   */
  containerHostedProviders: readonly string[];
}

function streamOptions(): { onOutput: (data: string) => void; color: "always" | "never" } {
  return {
    onOutput: (data) => process.stdout.write(data),
    color: colorMode(),
  };
}

/**
 * Creates or updates the stack with a single `up --refresh`: one operation
 * reconciles state with reality (containers killed by hand drop out) and
 * applies the program.
 *
 * There is deliberately no separate pre-refresh: refresh initializes every
 * provider in state, so a container-hosted provider whose container is gone
 * would abort the run before the update gets a chance to recreate it. If the
 * combined operation still fails, the container-hosted providers are purged
 * from state and the update retried once — after the purge, refresh only
 * sees providers it can reach, and the program re-registers the purged
 * resources against the freshly created container.
 */
export async function createStack(host: StackHost): Promise<void> {
  step("Refreshing and updating the stack");
  try {
    await host.stack.up({ ...streamOptions(), refresh: true });
  } catch (error) {
    rethrowLockError(error, host.stackName);
    if (host.containerHostedProviders.length === 0) {
      throw error;
    }
    warn("The update failed; assuming a container-hosted service is gone, purging its state, and retrying once.");
    await purgeContainerHostedProviders(host);
    try {
      await host.stack.up({ ...streamOptions(), refresh: true });
    } catch (retryError) {
      rethrowLockError(retryError, host.stackName);
      throw retryError;
    }
  }
}

/**
 * Destroys the stack. Container-hosted providers are purged from state
 * first, so the destroy plan never asks an unreachable service to delete
 * resources its own container teardown wipes physically; `refresh: true`
 * then reconciles whatever survives the purge against reality before
 * deleting it.
 */
export async function destroyStack(host: StackHost): Promise<void> {
  await purgeContainerHostedProviders(host);
  step("Refreshing and destroying the stack");
  try {
    await host.stack.destroy({ ...streamOptions(), refresh: true });
  } catch (error) {
    rethrowLockError(error, host.stackName);
    throw error;
  }
}

/** Previews what {@link createStack} would change, with a full diff. */
export async function previewStack(host: StackHost): Promise<void> {
  step("Previewing changes");
  try {
    await host.stack.preview({ ...streamOptions(), diff: true });
  } catch (error) {
    rethrowLockError(error, host.stackName);
    throw error;
  }
}

/** Releases a stuck state lock left behind by an interrupted operation. */
export async function cancelStack(host: StackHost): Promise<void> {
  step("Releasing the state lock");
  await host.stack.cancel();
}

/** Prints the stack outputs as a JSON object. */
export async function printOutputs(host: StackHost): Promise<void> {
  const outputs = await host.stack.outputs();
  const plain = Object.fromEntries(Object.entries(outputs).map(([key, output]) => [key, output.value]));
  process.stdout.write(`${JSON.stringify(plain, undefined, 2)}\n`);
}

async function purgeContainerHostedProviders(host: StackHost): Promise<void> {
  for (const providerName of host.containerHostedProviders) {
    const purge = await purgeProviderFromState(host.stack, providerName);
    const removed = purge.removedResources + purge.removedPendingOperations;
    if (removed > 0) {
      detail(`Purged ${removed} state entries tied to provider "${providerName}".`);
    }
  }
}

function rethrowLockError(error: unknown, stackName: string): void {
  if (error instanceof automation.ConcurrentUpdateError) {
    throw new SandboxLockError(stackName);
  }
}
