import * as docker from "@pulumi/docker";
import { EnvironmentFile, sandbox } from "pulumi-sandbox-os";

// The smallest useful sandbox: one database container plus the environment
// file an application needs to reach it. Run `node src/sandbox.ts create`,
// point the application at generated/application.env, and start coding.
await sandbox({ name: "getting-started" }, (context) => {
  const image = new docker.RemoteImage("postgres-image", {
    name: "postgres:18",
    keepLocally: true,
  });

  new docker.Container(
    "database",
    {
      image: image.imageId,
      name: context.physicalName("database"),
      ports: [{ internal: 5432, external: 25432 }],
      envs: ["POSTGRES_USER=dev", "POSTGRES_PASSWORD=dev", "POSTGRES_DB=application"],
      mustRun: true,
    },
    // The container name is fixed, so replacement must delete first.
    { deleteBeforeReplace: true },
  );

  // Generated artifacts belong to create runs only — previews and destroys
  // should never rewrite them.
  if (context.action === "create") {
    new EnvironmentFile([
      { DATABASE_URL: "postgresql://dev:dev@localhost:25432/application" },
    ]).write("generated/application.env");
  }
});
