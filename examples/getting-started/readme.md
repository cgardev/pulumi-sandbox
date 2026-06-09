# Getting started

One PostgreSQL container and a generated environment file — the smallest
sandbox that does something useful.

```bash
# from the repository root, once
pnpm install && pnpm build

# from this directory
pnpm sandbox:create     # start the database, write generated/application.env
pnpm sandbox:destroy    # remove the container
pnpm sandbox            # interactive menu
```

State lives in `.sandbox/` next to this file; no Pulumi account is involved.
