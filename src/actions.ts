/** Lifecycle verbs understood by every sandbox. */
export const LIFECYCLE_ACTIONS = ["create", "destroy", "reset", "preview", "cancel", "outputs"] as const;

export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

/** One-line description per lifecycle verb, shared by `help` and the interactive menu. */
export const ACTION_DESCRIPTIONS: Record<LifecycleAction, string> = {
  create: "Provision the sandbox, or update it to match the program",
  destroy: "Tear down every resource the sandbox manages",
  reset: "Destroy, then create — a clean slate in one command",
  preview: "Show what create would change, without changing it",
  cancel: "Release a stuck state lock left by an interrupted run",
  outputs: "Print the stack outputs as JSON",
};

export function isLifecycleAction(verb: string): verb is LifecycleAction {
  return (LIFECYCLE_ACTIONS as readonly string[]).includes(verb);
}
