import type { automation } from "@pulumi/pulumi";

/**
 * Pulumi treats every resource as independent, but a sandbox often manages
 * the very container that hosts a provider's backing service — a Keycloak
 * server with realms managed through `@pulumi/keycloak`, a database with
 * schemas managed through `@pulumi/postgresql`. When that container goes
 * away (a destroy plan, or a developer killing it by hand), the dependent
 * resources are physically wiped with it, yet Pulumi still holds them in
 * state and will try to initialize the unreachable provider before doing
 * anything else — refresh, update, and destroy all abort at provider
 * configuration.
 *
 * The cure is state surgery: drop the provider and everything it manages
 * from the checkpoint, so plans only touch resources whose providers are
 * reachable, and the next update recreates the purged resources against the
 * freshly booted service.
 *
 * Matching is by the resource's `provider` reference rather than
 * `deletedWith`, because the engine does not persist `deletedWith` into the
 * state JSON — the `provider` field is always there, in the form
 * `<provider-urn>::<provider-id>`.
 */

interface DeploymentResource {
  urn: string;
  provider?: string;
}

interface DeploymentBody {
  resources?: DeploymentResource[];
  pendingOperations?: Array<{ resource: DeploymentResource }>;
}

/** What a purge removed from the checkpoint. */
export interface ProviderPurge {
  /** URNs of the matched provider resources. */
  providerUrns: string[];
  /** Resources removed, providers included. */
  removedResources: number;
  /** Pending operations removed alongside them. */
  removedPendingOperations: number;
}

/**
 * Removes the named provider — and every resource that references it — from
 * a deployment body, in place. Returns what was removed so callers can log
 * it or skip the state write when nothing matched.
 *
 * Provider resources live at URNs of the form
 * `urn:pulumi:<stack>::<project>::pulumi:providers:<type>::<name>`; the
 * match is on the type prefix and the resource name, never on the stack or
 * project, so the same purge works against any backend layout.
 */
export function removeProviderFromDeployment(deployment: unknown, providerName: string): ProviderPurge {
  const body = deployment as DeploymentBody;
  const providerUrns = new Set(
    (body.resources ?? [])
      .filter((resource) => isProviderUrn(resource.urn, providerName))
      .map((resource) => resource.urn),
  );

  const purge: ProviderPurge = {
    providerUrns: [...providerUrns],
    removedResources: 0,
    removedPendingOperations: 0,
  };
  if (providerUrns.size === 0) {
    return purge;
  }

  const managedByPurgedProvider = (resource: DeploymentResource): boolean => {
    if (providerUrns.has(resource.urn)) {
      return true;
    }
    const reference = resource.provider;
    return reference !== undefined && [...providerUrns].some((urn) => reference.startsWith(`${urn}::`));
  };

  if (body.resources) {
    const before = body.resources.length;
    body.resources = body.resources.filter((resource) => !managedByPurgedProvider(resource));
    purge.removedResources = before - body.resources.length;
  }
  if (body.pendingOperations) {
    const before = body.pendingOperations.length;
    body.pendingOperations = body.pendingOperations.filter((operation) => !managedByPurgedProvider(operation.resource));
    purge.removedPendingOperations = before - body.pendingOperations.length;
  }
  return purge;
}

function isProviderUrn(urn: string, providerName: string): boolean {
  const segments = urn.split("::");
  return segments[2]?.startsWith("pulumi:providers:") === true && segments[3] === providerName;
}

/**
 * Exports the stack's state, removes the named provider and its dependents,
 * and imports the filtered state back — only when something actually
 * matched, so healthy stacks never see a state write.
 */
export async function purgeProviderFromState(stack: automation.Stack, providerName: string): Promise<ProviderPurge> {
  const exported = await stack.exportStack();
  const purge = removeProviderFromDeployment(exported.deployment, providerName);
  if (purge.removedResources + purge.removedPendingOperations > 0) {
    await stack.importStack(exported);
  }
  return purge;
}
