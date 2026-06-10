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
  const postgres = new docker.RemoteImage("postgres", { name: "postgres:18" });

  new docker.Container("database", {
    image: postgres.imageId,
    name: context.physicalName("database"),
    ports: [{ internal: 5432, external: 25432 }],
    envs: ["POSTGRES_USER=dev", "POSTGRES_PASSWORD=dev", "POSTGRES_DB=shop"],
  });
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

The complete, runnable version of this program — including the real-world
flags the snippet above leaves out — is
[`examples/getting-started`](examples/getting-started); the other
[examples](examples) scale the same loop up to one database per service, a
Keycloak realm, and a containerized development workspace.

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
- Plugins that project the sandbox onto developer tooling: IntelliJ data
  sources for the provisioned databases, Chrome bookmarks for the exposed
  consoles.

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

## Plugins

The `plugins/` modules generate artifacts for the tools around the sandbox.
They never touch Pulumi — pass them resolved outputs, typically from a
`deepResolve(...).apply(...)` confined to create runs:

```typescript
import { writeIntellijDataSources } from "@cgardev/pulumi-sandbox/plugins/intellij";
import { writeChromeBookmarks } from "@cgardev/pulumi-sandbox/plugins/bookmarks";

writeIntellijDataSources(".idea", [
  { name: "orders", jdbcUrl: "jdbc:postgresql://localhost:25432/orders", userName: "dev", password: "dev" },
]);

writeChromeBookmarks("generated", [
  { name: "Mail catcher", url: "http://localhost:25080", group: "Tools" },
  { name: "Identity console", url: "http://localhost:25081", group: "Tools" },
], "Shop Sandbox");
```

The IntelliJ plugin writes both halves of a data source
(`dataSources.xml` and `dataSources.local.xml`) with UUIDs derived from the
data-source name, so the IDE's introspection cache survives sandbox resets.
Passing a `password` embeds it in the JDBC URL — IntelliJ then connects
without prompting, which is only acceptable for throwaway sandbox
credentials. The bookmarks plugin renders a `bookmarks.html` importable via
`chrome://bookmarks` → Import bookmarks.

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

Each of these is a deliberate trade-off, not an oversight. Knowing the
reasoning makes the way out obvious.

### `destroy` deletes your data

`destroy` removes named volumes; database contents and caches go with them.
That is what makes `reset` trustworthy — a sandbox that preserved data
across resets would hand you stale state precisely when you asked for a
clean environment. Two consequences for how you write the program: anything
the sandbox needs on every boot (schemas, seed users, realms) belongs in
the program itself, where `create` rebuilds it; anything that must survive
(fixtures you edit by hand, a download cache that is expensive to refill)
belongs in a bind-mounted directory, which Pulumi never owned and therefore
never deletes.

### The default secrets passphrase is well known

Pulumi encrypts stack secrets with a passphrase, and this library defaults
it to the literal string `sandbox`. A random per-machine passphrase would
be security theater: it would have to be stored next to the state it
protects, and the secrets in question are throwaway development credentials
for services on localhost. What the well-known default buys is the
zero-configuration promise — clone, `create`, no prompt. The moment state
leaves the developer machine the math changes: when you point `backendUrl`
at shared storage, set `passphrase` (or the `PULUMI_CONFIG_PASSPHRASE`
environment variable) to a real secret.

### `.sandbox/` grows over time

The file backend keeps every checkpoint, plus history and backups, and
never prunes them. That history is what makes recovery from interrupted
runs possible, so the library does not clean it behind your back. The cost
is disk space, nothing else; the directory is git-ignored and machine
local. After a `destroy`, deleting `.sandbox/` entirely is always safe and
gives a clean slate.

### `onReady` hooks must be idempotent

`readyWhenHttp` lives inside the resource graph, and Pulumi re-evaluates
the graph on every update — so once its gate resolves, the probe and its
`onReady` hook run again on each subsequent `create`. There is no reliable
"first boot only" signal that survives both an in-place update and a
container recreated out of band, so rather than pretending to have one the
library makes the contract explicit: write hooks that are no-ops against an
already-configured service. In practice this is easy — `dockerExec`
shrugging off an "already exists" error is the common case. Previews never
probe and never run hooks, because a preview must not stall on a stopped
container or cause side effects.

## API reference

Grouped by what you are trying to do. A typical program touches `sandbox()`,
`EnvironmentFile`, `deepResolve`, and perhaps `readyWhenHttp`; the rest is
exported for the day you build tooling *around* the sandbox instead of
inside it.

### Entry points

`sandbox(options, program)` — the complete entry point, and for most
projects the only import. It resolves the developer identity, dispatches
the command line (lifecycle actions, custom commands, `help`, or the
interactive menu when no action is given), and renders every failure as a
friendly message with remediation steps and a non-zero exit code. Your
entry script is one call:

```typescript
await sandbox({ name: "shop" }, (context) => {
  // plain Pulumi resources
});
```

`createSandbox(options, program)` → `Sandbox` — the same fully wired stack
with no command line attached. Use it where code drives the lifecycle
instead of a developer typing verbs: integration tests, CI smoke runs, a
larger task runner that embeds the sandbox. The instance has `create()`,
`destroy()`, `reset()`, `preview()`, and `cancel()` methods, and exposes
the underlying `automation.Stack` for operations the lifecycle does not
cover:

```typescript
const instance = await createSandbox({ name: "shop" }, program);
await instance.create();
try {
  await runSmokeTests();
} finally {
  await instance.destroy();
}
```

### Turning outputs into application configuration

The resource graph knows the ports, endpoints, and generated credentials;
your application reads a flat `.env` file. These two close that gap — the
worked example is in
[Generating configuration for applications](#generating-configuration-for-applications).

`deepResolve(value)` — collapses a plain structure with Pulumi outputs
nested anywhere inside (objects, arrays, promises) into a single output of
the fully concrete shape. It exists because collecting a dozen values from
different resources with raw `apply` calls turns into a pyramid; with
`deepResolve` you assemble the structure once and consume it in one
closure. Class instances and circular references are rejected with the
offending path named, since Pulumi would otherwise flatten them silently.

`EnvironmentFile` — an ordered, incrementally built `.env` file. Each
`add({ ... })` call starts a blank-line-separated group; re-adding a key
overwrites it in place, so the file layout stays stable across runs. An
empty string renders as a commented-out `# KEY=` line — present for
discoverability, inactive for the loader. Passing `undefined`, `null`, or
an unresolved output throws immediately with the offending key: a loud
failure at render time beats debugging an application that read a poisoned
value. `write(path)` creates parent directories and writes the file;
`values()` returns the same effective variables as an object for in-process
use.

### Waiting for services to boot

`readyWhenHttp(gate, url, options)` — returns an output that resolves to
`url` only after the endpoint behind it responds, gated on another resource
(typically the container serving the endpoint) being scheduled first.
Anything consuming the returned output — a provider, a dependent resource —
is therefore held back until the service has actually booted. The optional
`onReady` hook is the place for imperative post-boot configuration; pair it
with `dockerExec`. Previews resolve immediately, without probing and
without side effects.

`waitForHttp(url, options)` — the raw probe underneath: polls until the
endpoint responds or the timeout elapses (default 180 seconds, every 2
seconds) and returns whether it became ready. It deliberately never throws —
on timeout it warns and returns `false`, so flows that race a disappearing
container (destroy, refresh) degrade to a warning instead of wedging. By
default any HTTP status counts as ready, even a 403, because a status line
proves the server is up — which is all a boot probe needs; pass
`expect: "ok"` to require a 2xx.

### Developer identity and configuration files

`resolveDevId(options)` — the exact resolution the sandbox itself performs:
the explicit option, then the `SANDBOX_DEV_ID` environment variable, then
the optional `envFile`, then `"local"` — or an error when `require: true`.
Exported so external tooling (a script that computes container names, a
cleanup job) can agree with the sandbox about whose resources it is
touching. The constants `DEV_ID_VARIABLE` and `DEFAULT_DEV_ID` are exported
alongside it.

`readEnvFile(path)` / `parseEnvFile(content)` — minimal `KEY=value`
parsing: blank lines and `#` comments are skipped, the first `=` splits key
from value, both sides are trimmed. No quoting, no interpolation —
deliberately less than dotenv, so sandbox configuration files stay
trivially predictable. `readEnvFile` returns `undefined` for a missing
file, keeping "not configured" distinguishable from "empty".

`booleanFlag(value, defaultValue)` — interprets `true`/`false`, `1`/`0`,
`yes`/`no`, and `on`/`off` case-insensitively; anything else, including a
missing value, yields the default. For feature toggles read from the
environment or an `envFile`.

### State surgery

The high-level switch is the `containerHostedProviders` option (see
[Container-hosted providers](#container-hosted-providers)); these are the
raw operations underneath it, exported for custom recovery tooling.

`purgeProviderFromState(stack, providerName)` — exports the stack's state,
removes the named provider and every resource it manages, and imports the
result back. The import only happens when something actually matched, so a
healthy stack never sees a state write. Returns a summary of what was
removed.

`removeProviderFromDeployment(deployment, providerName)` — the pure,
in-memory half: mutates an exported deployment body in place and also drops
every dangling reference (dependencies, parents, `deletedWith`) to the
purged resources, because the engine refuses to import a deployment that
mentions missing resources. Useful for testing recovery logic and for
inspecting state offline.

### Paths and plumbing

`fileBackendUrl(absoluteDirectory)` — builds the one `file://` URL form
that Pulumi's DIY backend accepts on both Windows and POSIX. Node's own
`pathToFileURL` produces `file:///D:/...`, which the backend mis-parses on
Windows into `file:///D:/D:/...`; this helper exists so nobody has to
rediscover that bug.

`resolveDirectories(homeDir, projectName)` / `ensureDirectories(dirs)` —
compute and create the `.sandbox/` layout: `state/` shared per home,
`work/<project>/` scoped per project. Exported for tools that need to
locate sandbox state — a cleanup script, a disk usage report — without
hardcoding the layout.

`findGitRoot(startDirectory?)` — walks upward until a `.git` entry appears
and returns that directory, or `undefined` outside a repository. Both
`.git` directories and `.git` pointer files count, so worktrees and
submodules work. The natural anchor for artifacts that belong at the
repository root — the `.idea` directory the IntelliJ plugin writes to, for
example.

### Errors

Every library error extends `SandboxError`, and the library throws instead
of ever calling `process.exit` itself — so the same functions behave under
tests and inside larger tools, and `sandbox()` is the single place where
errors become terminal output and an exit code. When embedding, catch the
subtypes: `SandboxConfigurationError` (the machine or the options are
incomplete; carries `remediation` lines to show the developer),
`SandboxLockError` (another process holds the state lock; resolved by the
`cancel` action), and `EnvironmentFileError` (a value could not be rendered
into an environment file).

### Docker utilities — `@cgardev/pulumi-sandbox/docker`

Host-side helpers that shell out to the `docker` CLI. Nothing here imports
Pulumi, and `@pulumi/docker` is not required.

`attachShell(containerName, options)` — the interactive
`docker exec -it <container> <shell>` a developer would type by hand,
returning the shell's exit code. Built to back a custom `shell` command —
see [Custom commands](#custom-commands).

`dockerExec(containerName, command, options)` — runs a command inside a
running container, for the post-boot configuration no provider covers:
unlocking an admin API, creating a seed user, flipping a development-only
setting. On failure it warns and returns `false` instead of throwing
(override with `warnOnly: false`), because these calls usually run inside
readiness chains where a throw would wedge destroy and refresh. Commands
must be idempotent — see the `onReady` caveat above.

`discoverMaskVolumes(root, { containerRoot, rules })` — for containerized
development environments where the repository is bind-mounted into the
container: walks the tree and applies caller-supplied rules ("a directory
containing `package.json` gets its `node_modules` masked") to produce the
container-local volumes that keep host build artifacts and container build
artifacts separate. Rule-driven precisely so the library stays ignorant of
any particular build tool — your rules carry that knowledge.

### Plugins — `@cgardev/pulumi-sandbox/plugins/*`

Generators for the tools around the sandbox. They consume resolved outputs
and never import Pulumi; the worked example is in [Plugins](#plugins).

`plugins/intellij` — `writeIntellijDataSources(ideaDir, definitions)`
writes both halves of an IntelliJ data source (`dataSources.xml` and
`dataSources.local.xml`) for the Postgres databases the sandbox provisions.
UUIDs are derived deterministically from each data-source name, so the
IDE's introspection cache survives regeneration; an optional password is
embedded into the JDBC URL so IntelliJ connects without prompting.
`renderDataSourcesXml` and `renderDataSourcesLocalXml` return the same
documents as strings.

`plugins/bookmarks` — `writeChromeBookmarks(outputDir, entries,
rootFolder?)` renders the consoles and dashboards the sandbox exposes as a
`bookmarks.html` in the Netscape bookmark format Chrome imports
(`chrome://bookmarks` → Import bookmarks), with entries grouped into
sub-folders. `renderChromeBookmarksHtml` returns the document as a string.

## Development

```bash
pnpm install
pnpm build      # compile to dist/
pnpm check      # type-check sources and tests
pnpm test       # vitest
```

## License

[MIT](LICENSE)
