import * as docker from "@pulumi/docker";
import * as pulumi from "@pulumi/pulumi";

interface PostgresDatabaseArgs {
  /** Physical container name; doubles as the in-network hostname. */
  containerName: string;
  /** Database created on first start. */
  database: string;
  /** Host port published for applications and IDE tools on the developer machine. */
  hostPort: number;
}

/**
 * A development database: pinned image, fixed container name, a published
 * host port, and a ready-made connection string. The sandbox declares one
 * per service — separate containers rather than a shared server, so
 * resetting one service's data never touches another's.
 */
export class PostgresDatabase extends pulumi.ComponentResource {
  readonly containerName: string;
  readonly hostPort: number;

  /** `postgresql://dev:dev@localhost:<hostPort>/<database>` — for host-side consumers. */
  readonly connectionUri: string;

  constructor(name: string, args: PostgresDatabaseArgs, opts?: pulumi.ComponentResourceOptions) {
    super("example:multi-service:PostgresDatabase", name, {}, opts);

    const image = new docker.RemoteImage(
      `${name}-image`,
      { name: "postgres:18", keepLocally: true },
      { parent: this },
    );

    new docker.Container(
      name,
      {
        image: image.imageId,
        name: args.containerName,
        hostname: args.containerName,
        ports: [{ internal: 5432, external: args.hostPort }],
        envs: ["POSTGRES_USER=dev", "POSTGRES_PASSWORD=dev", `POSTGRES_DB=${args.database}`],
        mustRun: true,
      },
      // The container name is fixed, so replacement must delete first.
      { parent: this, deleteBeforeReplace: true },
    );

    this.containerName = args.containerName;
    this.hostPort = args.hostPort;
    this.connectionUri = `postgresql://dev:dev@localhost:${args.hostPort}/${args.database}`;

    this.registerOutputs({ connectionUri: this.connectionUri });
  }
}
