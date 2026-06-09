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
  parent?: string;
  dependencies?: string[];
  propertyDependencies?: Record<string, string[] | undefined>;
  deletedWith?: string;
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
 * Surviving resources are sanitized as well: any `dependencies`,
 * `propertyDependencies`, `parent`, or `deletedWith` reference to a purged
 * resource is dropped, because the engine refuses to import a deployment
 * that mentions missing resources.
 *
 * Provider resources live at URNs whose type segment ends in
 * `pulumi:providers:<type>` — `parentType$pulumi:providers:<type>` when the
 * provider is declared inside a component resource — followed by the
 * resource name. The match is on that type and the name, never on the stack
 * or project, so the same purge works against any backend layout.
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

  const purgedUrns = new Set(
    (body.resources ?? []).filter((resource) => managedByPurgedProvider(resource)).map((resource) => resource.urn),
  );

  if (body.resources) {
    const before = body.resources.length;
    body.resources = body.resources.filter((resource) => !purgedUrns.has(resource.urn));
    purge.removedResources = before - body.resources.length;
    for (const survivor of body.resources) {
      dropReferencesTo(survivor, purgedUrns);
    }
  }
  if (body.pendingOperations) {
    const before = body.pendingOperations.length;
    body.pendingOperations = body.pendingOperations.filter(
      (operation) => !purgedUrns.has(operation.resource.urn) && !managedByPurgedProvider(operation.resource),
    );
    purge.removedPendingOperations = before - body.pendingOperations.length;
  }
  return purge;
}

/** Removes every reference a surviving resource holds to the purged URNs. */
function dropReferencesTo(resource: DeploymentResource, purgedUrns: ReadonlySet<string>): void {
  if (resource.dependencies) {
    resource.dependencies = resource.dependencies.filter((urn) => !purgedUrns.has(urn));
  }
  if (resource.propertyDependencies) {
    for (const [property, urns] of Object.entries(resource.propertyDependencies)) {
      if (urns) {
        resource.propertyDependencies[property] = urns.filter((urn) => !purgedUrns.has(urn));
      }
    }
  }
  if (resource.parent !== undefined && purgedUrns.has(resource.parent)) {
    delete resource.parent;
  }
  if (resource.deletedWith !== undefined && purgedUrns.has(resource.deletedWith)) {
    delete resource.deletedWith;
  }
}

function isProviderUrn(urn: string, providerName: string): boolean {
  const segments = urn.split("::");
  if (segments[3] !== providerName) {
    return false;
  }
  // The type segment is `$`-joined with the parent's qualified type when the
  // provider is declared inside a component resource; the provider's own
  // type is always the last element.
  return segments[2]?.split("$").pop()?.startsWith("pulumi:providers:") === true;
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
