# Development workspace

A containerized development environment defined as code instead of
docker-compose:

- the repository bind-mounted at `/workspace`
- the user's home on a persistent volume (tool logins survive recreations)
- every generated directory (`build/`, `.gradle/`, `node_modules/`) masked by
  a container-local volume, discovered automatically from rule definitions —
  add a module to the repository and its masks appear on the next `create`
- a custom `shell` command that attaches an interactive shell

```bash
# from the repository root, once
pnpm install && pnpm build

# from this directory
pnpm sandbox:create     # pull the image, start the workspace
pnpm sandbox:shell      # attach a shell (pass another one: pnpm sandbox:shell /bin/sh)
pnpm sandbox:destroy    # remove the container and its volumes
```

> `destroy` removes the named volumes — container-local caches and the home
> directory included. The repository on the bind mount is untouched.
