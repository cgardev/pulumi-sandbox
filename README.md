# Pulumi Sandbox

[![ci](https://github.com/cgardev/pulumi-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/cgardev/pulumi-sandbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40cgardev%2Fpulumi-sandbox)](https://www.npmjs.com/package/@cgardev/pulumi-sandbox)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Local development sandboxes as code.

> Unofficial project, not affiliated with or endorsed by Pulumi Corporation.
> Pulumi is a trademark of Pulumi Corporation.

You write a plain [Pulumi](https://www.pulumi.com) program describing what your
application needs on a developer machine. This library wraps it in a complete,
per-developer sandbox lifecycle:

```typescript
// src/sandbox.ts
import * as docker from "@pulumi/docker";
import { sandbox } from "@cgardev/pulumi-sandbox";

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

State lives in a git-ignored `.sandbox/` directory, on Pulumi's local file
backend. There is no account to create and nothing to log into. On Node.js 24
or newer the TypeScript entry point runs as-is, without a build step.

## Why

Every project that manages its development environment through Pulumi's
Automation API ends up writing the same harness: an entry script that parses
`create` and `destroy` from argv, a file backend with the URL quirk that
makes it work on Windows, per-developer stack names so two people on one
machine don't fight over container names, and some recovery path for the day
a colleague deletes a container by hand and Pulumi state stops matching
reality. I had copied that glue between three repositories before pulling it
out into this library.

The program stays plain Pulumi. The library only provides what goes around it.

## Why not docker-compose?

A compose file describes containers. A sandbox program can also wait for
Keycloak to finish booting before creating realms in it, render the generated
client secret into the `.env` file your application loads, and derive a
container for every module it finds in your repository. And since it is
TypeScript, a topology with one database per service and a port plan is a
function and a loop rather than a wall of YAML.

## What it does

- Lifecycle CLI: `create`, `destroy`, `reset`, `preview`, `cancel`,
  `outputs`, `help`, and an interactive menu when no action is given. You can
  register your own verbs as well.
- Self-contained local state under `.sandbox/`. Point `backendUrl` at
  `s3://...` later if the team wants shared state; nothing else changes.
- A developer id (`SANDBOX_DEV_ID`, falling back to `local`) suffixes the
  stack name and every physical resource name. Set `requireDevId: true` when
  a collision would actually hurt.
- Refresh is folded into create and destroy, so resources deleted behind
  Pulumi's back drop out of state instead of failing the run.
- State surgery for providers whose backing service runs in a container the
  sandbox itself manages. This is the part nobody misses until the first
  wedged stack; see below.
- Helpers for the boring parts: `EnvironmentFile`, `deepResolve`,
  `readyWhenHttp`, `findGitRoot`, and a `/docker` module with `attachShell`,
  `dockerExec` and mask-volume discovery.

The core has zero runtime dependencies. `@pulumi/pulumi` is the only peer
dependency, and the library knows nothing about any particular database,
build tool or identity server. Your program carries the specifics.

## Requirements

- Node.js >= 24
- The [Pulumi CLI](https://www.pulumi.com/docs/install/) on the PATH (no account needed)
- Docker, when the program manages containers

```bash
pnpm add @cgardev/pulumi-sandbox @pulumi/pulumi
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

If another process holds the state lock you get a hint to run `cancel`, not a
stack trace. A `reset` that hits the lock during its destroy half stops
there; it does not continue into create as if nothing happened.

## The context

The program receives a context describing the run:

```typescript
await sandbox({ name: "shop" }, (context) => {
  context.devId;                       // "jdoe", the resolved developer id
  context.stackName;                   // "shop-jdoe"
  context.physicalName("orders-db");   // "shop-orders-db-jdoe"
  context.action;                      // the lifecycle operation executing the program
});
```

`physicalName` is what keeps container, network and volume names from
colliding between developers. `context.action` is either `create` or
`preview`, and is mostly useful for confining side effects (like writing
generated files) to real create runs. The program only executes for
operations that need the resource graph. A `destroy` works from recorded
state and never runs it, so destroy-time guards are unnecessary.

Returning a record from the program publishes it as stack outputs:

```typescript
await sandbox({ name: "shop" }, () => {
  return { adminUrl: "http://localhost:25080" };
});
```

## Container-hosted providers

Some providers manage resources that live inside a container the sandbox
itself runs: realms inside a Keycloak container, schemas inside a database
container. Pulumi has no idea the realm dies with the container. Once the
container is gone, every refresh, update and destroy aborts while
initializing a provider whose service no longer exists, and the stack is
wedged.

Declare such providers and the lifecycle deals with it:

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

On destroy, the provider and everything it manages are removed from state
before the plan runs. The container teardown wipes the actual data anyway,
so nothing needs to talk to the doomed service. On create, a failed update
purges the same providers and retries once, which recovers sandboxes whose
containers were removed out of band. Any provider resource name can be
listed, and `purgeProviderFromState` is exported if you need the raw
operation.

## Generating configuration for applications

A sandbox is only useful once an application runs against it.
`EnvironmentFile` accumulates variables in ordered, blank-line-separated
groups, and `deepResolve` collapses a tree of Pulumi outputs into one
concrete value, so generated credentials end up in the same file as static
ports:

```typescript
import { EnvironmentFile, deepResolve } from "@cgardev/pulumi-sandbox";

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

Passing `undefined`, `null`, or an unresolved Pulumi output throws with the
offending key. A poisoned value in a generated `.env` costs far more
debugging time than an exception at render time.

## Custom commands

Verbs beyond the lifecycle dispatch before any Pulumi machinery starts, so
they are instant:

```typescript
import { attachShell } from "@cgardev/pulumi-sandbox/docker";

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
| [`getting-started`](examples/getting-started)  | One database and one generated `.env`; the minimal loop                                 |
| [`multi-service`](examples/multi-service)      | Databases per service, mail catcher, Keycloak realm via a container-hosted provider     |
| [`dev-workspace`](examples/dev-workspace)      | A containerized development environment with rule-discovered mask volumes and a `shell` command |

## Where state lives

```
.sandbox/             # add to .gitignore
├── state/            # the file:// backend: checkpoints, history, backups
└── work/<project>/   # the generated Pulumi project and per-stack settings
```

By default `.sandbox/` sits in the package containing the entry script, not
in the current working directory, so invoking the sandbox from anywhere
targets the same state. Override the location with `homeDir`.

The `file://` URL is built in the one form Pulumi's DIY backend accepts on
both Windows and POSIX (`fileBackendUrl`). The same entry point works for
the whole team.

## Caveats

- `destroy` removes named volumes. Database contents and caches go with
  them. Bind-mounted directories survive.
- Secrets on the local backend are encrypted with a well-known default
  passphrase (`sandbox`). Acceptable for throwaway development credentials;
  set `passphrase` or `PULUMI_CONFIG_PASSPHRASE` before pointing the backend
  anywhere shared.
- The state directory accumulates history and backups over time. After a
  destroy you can delete `.sandbox/` entirely for a clean slate.
- `readyWhenHttp` probes run again on every update once their gate resolves,
  so `onReady` hooks must be idempotent. Previews skip the probes.

## API overview

Core (`@cgardev/pulumi-sandbox`):

- `sandbox(options, program)` — the complete entry point: dispatch, lifecycle, error rendering
- `createSandbox(options, program)` / `Sandbox` — programmatic control, the underlying `automation.Stack` included
- `EnvironmentFile`, `deepResolve`, `waitForHttp`, `readyWhenHttp`, `findGitRoot`
- `resolveDevId`, `parseEnvFile`, `readEnvFile`, `booleanFlag`
- `purgeProviderFromState`, `removeProviderFromDeployment`
- `fileBackendUrl`, `resolveDirectories`, `ensureDirectories`
- `SandboxError`, `SandboxConfigurationError`, `SandboxLockError`, `EnvironmentFileError`

Docker utilities (`@cgardev/pulumi-sandbox/docker`, host-side, no `@pulumi/docker` required):

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
