import * as docker from "@pulumi/docker";
import * as keycloak from "@pulumi/keycloak";
import { EnvironmentFile, deepResolve, sandbox } from "pulumi-sandbox-os";
import { IdentityServer } from "./identity-server.ts";
import { PostgresDatabase } from "./postgres-database.ts";

// Stable localhost ports, one block per service: orders 251xx, billing 252xx,
// shared services 250xx.
const PORTS = {
  identity: 25080,
  identityDatabase: 25081,
  mailSmtp: 25025,
  mailHttp: 25026,
  ordersDatabase: 25110,
  billingDatabase: 25210,
};

// Resource name of the keycloak provider declared below. Listing it as
// container-hosted tells the lifecycle to purge its resources from state
// when the container that serves them is going away — without it, destroy
// would try to log into a Keycloak that no longer exists.
const IDENTITY_PROVIDER = "identity";

await sandbox(
  {
    name: "shop",
    containerHostedProviders: [IDENTITY_PROVIDER],
  },
  (context) => {
    const network = new docker.Network("network", { name: context.physicalName("network") });

    // One database per service: resetting orders never touches billing.
    const ordersDatabase = new PostgresDatabase("orders-database", {
      containerName: context.physicalName("orders-db"),
      database: "orders",
      hostPort: PORTS.ordersDatabase,
    });

    const billingDatabase = new PostgresDatabase("billing-database", {
      containerName: context.physicalName("billing-db"),
      database: "billing",
      hostPort: PORTS.billingDatabase,
    });

    // Mail catcher: every email the services send lands in a local inbox.
    const mailImage = new docker.RemoteImage("mail-image", {
      name: "axllent/mailpit:v1.27",
      keepLocally: true,
    });
    new docker.Container(
      "mail",
      {
        image: mailImage.imageId,
        name: context.physicalName("mail"),
        hostname: context.physicalName("mail"),
        ports: [
          { internal: 1025, external: PORTS.mailSmtp },
          { internal: 8025, external: PORTS.mailHttp },
        ],
        mustRun: true,
      },
      { deleteBeforeReplace: true },
    );

    const identity = new IdentityServer("identity-server", {
      containerName: context.physicalName("identity"),
      hostPort: PORTS.identity,
      databaseHostPort: PORTS.identityDatabase,
      network,
      adminUsername: "dev",
      adminPassword: "dev",
    });

    const ordersEnvironment = new EnvironmentFile([
      { ORDERS_DATABASE_URL: ordersDatabase.connectionUri },
      { SMTP_HOST: "localhost", SMTP_PORT: PORTS.mailSmtp },
    ]);
    const billingEnvironment = new EnvironmentFile([
      { BILLING_DATABASE_URL: billingDatabase.connectionUri },
      { SMTP_HOST: "localhost", SMTP_PORT: PORTS.mailSmtp },
    ]);

    // Everything below talks to the Keycloak the containers above serve.
    // During destroy the program does not run and these resources are
    // purged from state instead (see containerHostedProviders), so the
    // teardown never attempts a login against a stopping container.
    const identityProvider = new keycloak.Provider(IDENTITY_PROVIDER, {
      // The provider configures itself only once the server answers HTTP.
      url: identity.readyUrl,
      clientId: "admin-cli",
      username: "dev",
      password: "dev",
    });

    // retainOnDelete is the safety net for partial destroys that bypass the
    // lifecycle's state purge; deletedWith documents the dependency for
    // engine versions that honor it during planning.
    const realmOptions = {
      provider: identityProvider,
      retainOnDelete: true,
      deletedWith: identity.container,
    };

    const realm = new keycloak.Realm(
      "shop",
      { realm: "shop", enabled: true, sslRequired: "none" },
      realmOptions,
    );

    const ordersApi = new keycloak.openid.Client(
      "orders-api",
      {
        realmId: realm.id,
        clientId: "orders-api",
        accessType: "CONFIDENTIAL",
        standardFlowEnabled: false,
        serviceAccountsEnabled: true,
      },
      { ...realmOptions, parent: realm },
    );

    // Render the environment files once every generated credential is
    // concrete — and only on create, so previews and destroys never touch
    // the generated artifacts.
    if (context.action === "create") {
      deepResolve({ clientSecret: ordersApi.clientSecret }).apply((resolved) => {
        ordersEnvironment.add({
          OIDC_ISSUER_URL: `${identity.url}/realms/shop`,
          OIDC_CLIENT_ID: "orders-api",
          OIDC_CLIENT_SECRET: resolved.clientSecret,
        });
        ordersEnvironment.write("generated/orders.env");
        billingEnvironment.write("generated/billing.env");
      });
    }
  },
);
