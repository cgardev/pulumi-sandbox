import { describe, expect, it } from "vitest";
import { removeProviderFromDeployment } from "../src/index.js";

const STACK = "urn:pulumi:shop-local::shop";

function deployment() {
  return {
    resources: [
      { urn: `${STACK}::pulumi:providers:docker::docker-provider` },
      {
        urn: `${STACK}::docker:index/container:Container::identity-server`,
        provider: `${STACK}::pulumi:providers:docker::docker-provider::abc123`,
      },
      { urn: `${STACK}::pulumi:providers:keycloak::keycloak` },
      {
        urn: `${STACK}::keycloak:index/realm:Realm::tenant`,
        provider: `${STACK}::pulumi:providers:keycloak::keycloak::def456`,
      },
      {
        urn: `${STACK}::keycloak:openid/client:Client::frontend`,
        provider: `${STACK}::pulumi:providers:keycloak::keycloak::def456`,
      },
      // A regular resource that happens to carry the provider's name.
      { urn: `${STACK}::docker:index/container:Container::keycloak` },
    ],
    pendingOperations: [
      {
        resource: {
          urn: `${STACK}::keycloak:index/realm:Realm::pending-realm`,
          provider: `${STACK}::pulumi:providers:keycloak::keycloak::def456`,
        },
      },
      { resource: { urn: `${STACK}::docker:index/container:Container::pending-container` } },
    ],
  };
}

describe("removeProviderFromDeployment", () => {
  it("removes the provider and every resource that references it", () => {
    const body = deployment();
    const purge = removeProviderFromDeployment(body, "keycloak");

    expect(purge.providerUrns).toEqual([`${STACK}::pulumi:providers:keycloak::keycloak`]);
    expect(purge.removedResources).toBe(3);
    expect(purge.removedPendingOperations).toBe(1);
    expect(body.resources.map((resource) => resource.urn)).toEqual([
      `${STACK}::pulumi:providers:docker::docker-provider`,
      `${STACK}::docker:index/container:Container::identity-server`,
      `${STACK}::docker:index/container:Container::keycloak`,
    ]);
    expect(body.pendingOperations).toHaveLength(1);
  });

  it("keeps a non-provider resource whose name matches the provider name", () => {
    const body = deployment();
    removeProviderFromDeployment(body, "keycloak");

    expect(
      body.resources.some((resource) => resource.urn === `${STACK}::docker:index/container:Container::keycloak`),
    ).toBe(true);
  });

  it("reports an empty purge when the provider is not in state", () => {
    const body = deployment();
    const before = structuredClone(body);
    const purge = removeProviderFromDeployment(body, "absent");

    expect(purge).toEqual({ providerUrns: [], removedResources: 0, removedPendingOperations: 0 });
    expect(body).toEqual(before);
  });

  it("tolerates a deployment without resources", () => {
    const purge = removeProviderFromDeployment({}, "keycloak");

    expect(purge.removedResources).toBe(0);
  });

  it("matches providers declared inside component resources", () => {
    const body = {
      resources: [
        { urn: `${STACK}::app:identity:IdentityServer$pulumi:providers:keycloak::keycloak` },
        {
          urn: `${STACK}::keycloak:index/realm:Realm::tenant`,
          provider: `${STACK}::app:identity:IdentityServer$pulumi:providers:keycloak::keycloak::def456`,
        },
      ],
    };
    const purge = removeProviderFromDeployment(body, "keycloak");

    expect(purge.removedResources).toBe(2);
    expect(body.resources).toHaveLength(0);
  });

  it("drops references surviving resources hold to purged ones", () => {
    const realmUrn = `${STACK}::keycloak:index/realm:Realm::tenant`;
    const survivorUrn = `${STACK}::docker:index/container:Container::application`;
    const body = {
      resources: [
        { urn: `${STACK}::pulumi:providers:keycloak::keycloak` },
        {
          urn: realmUrn,
          provider: `${STACK}::pulumi:providers:keycloak::keycloak::def456`,
        },
        {
          urn: survivorUrn,
          dependencies: [realmUrn, `${STACK}::docker:index/network:Network::network`],
          propertyDependencies: { envs: [realmUrn] },
          deletedWith: realmUrn,
        },
      ],
    };
    removeProviderFromDeployment(body, "keycloak");

    const survivor = body.resources.find((resource) => resource.urn === survivorUrn);
    expect(survivor).toEqual({
      urn: survivorUrn,
      dependencies: [`${STACK}::docker:index/network:Network::network`],
      propertyDependencies: { envs: [] },
    });
  });

  it("does not purge dependents of a different provider with a similar reference", () => {
    const body = {
      resources: [
        { urn: `${STACK}::pulumi:providers:keycloak::keycloak` },
        {
          urn: `${STACK}::keycloak:index/realm:Realm::other`,
          provider: `${STACK}::pulumi:providers:keycloak::keycloak-second::xyz`,
        },
      ],
    };
    const purge = removeProviderFromDeployment(body, "keycloak");

    expect(purge.removedResources).toBe(1);
    expect(body.resources).toHaveLength(1);
  });
});
