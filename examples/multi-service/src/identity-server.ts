import * as docker from "@pulumi/docker";
import * as pulumi from "@pulumi/pulumi";
import { readyWhenHttp } from "pulumi-sandbox-os";

interface IdentityServerArgs {
  /** Physical container name; doubles as the in-network hostname. */
  containerName: string;
  /** Host port for the admin console and the OpenID endpoints. */
  hostPort: number;
  /** Host port for the dedicated database, for IDE inspection. */
  databaseHostPort: number;
  /** Network shared with the database sidecar. */
  network: docker.Network;
  adminUsername: string;
  adminPassword: string;
}

/**
 * A Keycloak server with its own PostgreSQL sidecar. Realms and clients are
 * managed by `@pulumi/keycloak` on top of it — the provider consumes
 * {@link IdentityServer.readyUrl}, so it never configures itself before the
 * server has finished booting.
 */
export class IdentityServer extends pulumi.ComponentResource {
  readonly container: docker.Container;
  readonly url: string;

  /** Resolves to {@link IdentityServer.url} once the server answers HTTP. */
  readonly readyUrl: pulumi.Output<string>;

  constructor(name: string, args: IdentityServerArgs, opts?: pulumi.ComponentResourceOptions) {
    super("example:multi-service:IdentityServer", name, {}, opts);
    const childOptions: pulumi.CustomResourceOptions = { parent: this, deleteBeforeReplace: true };

    const databaseHostname = `${args.containerName}-db`;

    const postgresImage = new docker.RemoteImage(
      `${name}-postgres-image`,
      { name: "postgres:18", keepLocally: true },
      { parent: this },
    );

    const database = new docker.Container(
      `${name}-postgres`,
      {
        image: postgresImage.imageId,
        name: databaseHostname,
        hostname: databaseHostname,
        networksAdvanced: [{ name: args.network.name }],
        ports: [{ internal: 5432, external: args.databaseHostPort }],
        envs: ["POSTGRES_USER=dev", "POSTGRES_PASSWORD=dev", "POSTGRES_DB=keycloak"],
        mustRun: true,
      },
      childOptions,
    );

    const image = new docker.RemoteImage(
      `${name}-image`,
      { name: "quay.io/keycloak/keycloak:26.3", keepLocally: true },
      { parent: this },
    );

    this.container = new docker.Container(
      name,
      {
        image: image.imageId,
        name: args.containerName,
        hostname: args.containerName,
        networksAdvanced: [{ name: args.network.name }],
        ports: [{ internal: 8080, external: args.hostPort }],
        envs: [
          `KC_BOOTSTRAP_ADMIN_USERNAME=${args.adminUsername}`,
          `KC_BOOTSTRAP_ADMIN_PASSWORD=${args.adminPassword}`,
          "KC_DB=postgres",
          // In-network address: the sidecar's hostname and its internal port.
          `KC_DB_URL=jdbc:postgresql://${databaseHostname}:5432/keycloak`,
          "KC_DB_USERNAME=dev",
          "KC_DB_PASSWORD=dev",
          "KC_HTTP_ENABLED=true",
        ],
        command: ["start-dev"],
        restart: "on-failure",
        mustRun: true,
      },
      { ...childOptions, dependsOn: database },
    );

    this.url = `http://localhost:${args.hostPort}`;
    this.readyUrl = readyWhenHttp(this.container.id, this.url, {
      // Any HTTP status proves the server is up; Keycloak answers the root
      // path long before an authenticated endpoint would return 200.
      expect: "any-response",
    });

    this.registerOutputs({ url: this.url });
  }
}
