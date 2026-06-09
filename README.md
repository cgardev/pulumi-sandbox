# pulumi-sandbox

[![ci](https://github.com/cgardev/pulumi-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/cgardev/pulumi-sandbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pulumi-sandbox)](https://www.npmjs.com/package/pulumi-sandbox)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Local development sandboxes as code.**

Write a plain [Pulumi](https://www.pulumi.com) program describing the local
infrastructure your application needs — containers, databases, message
brokers, identity servers — and get a complete, per-developer sandbox
lifecycle around it. No backend account, no YAML, no glue scripts.

```typescript
// src/sandbox.ts
import * as docker from "@pulumi/docker";
import { sandbox } from "pulumi-sandbox";

await sandbox({ name: "shop" }, (context) => {
  const image = new docker.RemoteImage("postgres", { name: "postgres:18", keepLocally: true });

  new docker.Container("database", {
    image: image.imageId,
    name: context.physicalName("database"),
    ports: [{ internal: 5432, external: 25432 }],
    envs: ["POSTGRES_USER=dev", "POSTGRES_PASSWORD=dev", "POSTGRES_DB=shop"],
    mustRun: true,
  }, { deleteBeforeReplace: true });
});
```

```bash
node src/sandbox.ts create     # provision (or update) the sandbox
node src/sandbox.ts destroy    # tear it down
node src/sandbox.ts            # interactive menu
```

That is the entire setup. State lives in a git-ignored `.sandbox/` directory
on the local `file://` backend; with Node.js 24+ the TypeScript entry point
runs directly, no build step involved.

## Why not docker-compose?

A compose file describes containers. A sandbox program describes an
*environment*: it can wait for a server to boot before configuring realms
inside it, generate credentials and render them into the `.env` files your
applications load, derive a container per module of your repository, and
reuse every Pulumi provider in existence. With the full expressiveness of
TypeScript — loops, functions, composition — complex topologies (one database
per service, port plans, cross-service wiring) stay readable.

This library supplies everything *around* that program, so a project's
infrastructure entry point contains nothing but infrastructure.

## What you get

- **Zero-configuration state.** A self-contained `file://` backend under
  `.sandbox/` — no Pulumi account, no cloud bucket, nothing to log into.
  Point `backendUrl` at `s3://...` later if the team wants shared state.
- **Per-developer isolation.** A developer id (from `SANDBOX_DEV_ID`, an
  optional `.env` file, or the `local` default) suffixes the stack and every
  physical resource name, so two developers on one machine — or two checkouts
  given distinct `SANDBOX_DEV_ID` values — never collide.
- **A complete lifecycle.** `create`, `destroy`, `reset`, `preview`,
  `cancel`, `outputs`, `help`, an interactive menu, and your own custom
  commands — with readable output and honest exit codes.
- **A lifecycle that survives reality.** Refresh is folded into `create` and
  `destroy`, so containers killed by hand drop out of state instead of
  failing the run. Providers hosted *inside* sandbox-managed containers
  (Keycloak realms, database schemas) get state surgery on destroy and a
  purge-and-retry on create — see below.
- **Developer-experience helpers.** `EnvironmentFile` renders ordered,
  grouped `.env` files; `deepResolve` turns a tree of Pulumi outputs into one
  concrete value; `readyWhenHttp` gates providers on a service actually
  booting; `findGitRoot` anchors paths; `pulumi-sandbox/docker` adds
  `attachShell`, `dockerExec`, and rule-driven mask-volume discovery.
- **A tiny, generic core.** ESM, fully typed, zero runtime dependencies, and
  `@pulumi/pulumi` as the only peer dependency. The library has no knowledge
  of any particular database, build tool, or identity server — your program
  and your rules carry the specifics.

## Requirements

- Node.js >= 24
- The [Pulumi CLI](https://www.pulumi.com/docs/install/) on the PATH (no account needed)
- Docker, when the program manages containers

```bash
pnpm add pulumi-sandbox @pulumi/pulumi
# plus the providers your program uses, e.g. for containers:
pnpm add @pulumi/docker
```

## The lifecycle

| Action     | What happens                                                                                  |
|:-----------|:----------------------------------------------------------------------------------------------|
| `create`   | `up` with refresh folded in; on failure, purge container-hosted provider state and retry once |
| `destroy`  | Purge container-hosted provider state, then `destroy` with refresh folded in                  |
| `reset`    | `destroy` followed by `create`, in one process                                                |
| `preview`  | Diffed preview of what `create` would change                                                  |
| `cancel`   | Release a stuck state lock left by an interrupted run                                         |
| `outputs`  | Print the stack outputs as JSON                                                               |
| *(none)*   | Interactive menu over all of the above                                                        |

A concurrent-update collision is reported as a hint to run `cancel`, never as
a stack trace — and a `reset` whose destroy half hits the lock stops instead
of silently proceeding.

## The context

The program receives a context describing the run:

```typescript
await sandbox({ name: "shop" }, (context) => {
  context.devId;                       // "jdoe" — the resolved developer id
  context.stackName;                   // "shop-jdoe"
  context.physicalName("orders-db");   // "shop-orders-db-jdoe"
  context.action;                      // the lifecycle operation executing the program
});
```

`physicalName` keeps container, network, and volume names collision-free per
developer. `action` is the operation currently executing the program —
`create` or `preview` — and gates side effects like writing generated
artifacts. The program only runs for operations that need the resource
graph; a `destroy` works from the recorded state and never executes it, so
programs need no destroy-time guards.

Returning a record from the program publishes it as stack outputs:

```typescript
await sandbox({ name: "shop" }, () => {
  return { adminUrl: "http://localhost:25080" };
});
```

## Container-hosted providers

Some providers manage resources *inside* a container the sandbox itself
runs — realms inside a Keycloak container, schemas inside a database
container. Pulumi treats those resources as independent of the container, so
when the container disappears (a destroy, or a developer's `docker rm`), any
refresh, update, or destroy aborts while initializing a provider whose
service no longer exists.

Declare such providers and the lifecycle handles the rest:

```typescript
await sandbox(
  { name: "shop", containerHostedProviders: ["identity"] },
  () => {
    const identity = new IdentityServer(/* keycloak container + sidecar */);

    const provider = new keycloak.Provider("identity", {
      url: identity.readyUrl,  // configures itself only after boot
      // ...
    });
    new keycloak.Realm("shop", { realm: "shop" }, {
      provider,
      retainOnDelete: true,            // safety net for partial destroys
      deletedWith: identity.container, // documents the dependency
    });
  },
);
```

On `destroy`, the provider and everything it manages are removed from state
before the plan runs — the container teardown wipes them physically, so
nothing needs to talk to the doomed service. On `create`, a failed update
triggers the same purge and a single retry, which recovers sandboxes whose
containers were removed out-of-band. The mechanism is generic: any provider
resource name can be listed, and `purgeProviderFromState` is exported for
custom flows.

## Rendering configuration for applications

Sandboxes exist so applications can run against them. `EnvironmentFile`
accumulates variables in ordered, blank-line-separated groups; `deepResolve`
collapses any tree of Pulumi outputs into one concrete value, so generated
credentials land in the same file as static ports:

```typescript
import { EnvironmentFile, deepResolve } from "pulumi-sandbox";

const environment = new EnvironmentFile([
  { ORDERS_DATABASE_URL: ordersDatabase.connectionUri },
  { SMTP_HOST: "localhost", SMTP_PORT: 25025 },
]);

if (context.action === "create") {
  deepResolve({ secret: ordersApi.clientSecret }).apply(({ secret }) => {
    environment.add({ OIDC_CLIENT_SECRET: secret });
    environment.write("generated/orders.env");
  });
}
```

An `undefined` or `null` value throws immediately with the offending key —
a loud failure beats a poisoned environment file.

## Custom commands

Verbs beyond the lifecycle dispatch before any Pulumi machinery starts, so
they stay instant:

```typescript
import { attachShell } from "pulumi-sandbox/docker";

await sandbox(
  {
    name: "workspace",
    commands: {
      shell: {
        description: "Open a shell inside the workspace container",
        run: ({ physicalName, argv }) => attachShell(physicalName("dev"), { shell: argv[0] }),
      },
    },
  },
  program,
);
```

## Examples

| Example                                        | Shows                                                                                   |
|:-----------------------------------------------|:----------------------------------------------------------------------------------------|
| [`getting-started`](examples/getting-started)  | One database, one generated `.env` — the minimal loop                                   |
| [`multi-service`](examples/multi-service)      | Databases per service, mail catcher, Keycloak realm via a container-hosted provider     |
| [`dev-workspace`](examples/dev-workspace)      | A containerized development environment with rule-discovered mask volumes and a `shell` command |

## State layout and portability

```
.sandbox/             # add to .gitignore
├── state/            # the file:// backend: checkpoints, history, backups
└── work/<project>/   # the generated Pulumi project and per-stack settings
```

By default `.sandbox/` lives in the package containing the entry script —
anchored there rather than to the working directory, so invoking the sandbox
from anywhere targets the same state. Override the location with `homeDir`.

Secrets on the local backend are encrypted with a well-known default
passphrase (`sandbox`) to keep the zero-configuration promise — local
sandboxes hold throwaway development credentials. Override `passphrase` or
set `PULUMI_CONFIG_PASSPHRASE` when pointing at a shared backend.

The `file://` URL is built in the one form Pulumi's DIY backend accepts on
both Windows and POSIX (`fileBackendUrl`), so the same entry point works for
the whole team.

## API overview

Core (`pulumi-sandbox`):

- `sandbox(options, program)` — the complete entry point: dispatch, lifecycle, error rendering
- `createSandbox(options, program)` / `Sandbox` — programmatic control, the underlying `automation.Stack` included
- `EnvironmentFile`, `deepResolve`, `waitForHttp`, `readyWhenHttp`, `findGitRoot`
- `resolveDevId`, `parseEnvFile`, `readEnvFile`, `booleanFlag`
- `purgeProviderFromState`, `removeProviderFromDeployment`
- `fileBackendUrl`, `resolveDirectories`, `ensureDirectories`
- `SandboxError`, `SandboxConfigurationError`, `SandboxLockError`, `EnvironmentFileError`

Docker utilities (`pulumi-sandbox/docker`, host-side, no `@pulumi/docker` required):

- `attachShell(containerName, options)` — interactive `docker exec`
- `dockerExec(containerName, command, options)` — idempotent post-boot configuration
- `discoverMaskVolumes(root, { containerRoot, rules })` — rule-driven discovery of directories to mask with container-local volumes

## Development

```bash
pnpm install
pnpm build      # compile to dist/
pnpm check      # type-check sources and tests
pnpm test       # vitest
```

## License

[MIT](LICENSE)
