# Multi-service sandbox

A realistic local platform in one program:

- one PostgreSQL container per service (orders, billing)
- a mail catcher (Mailpit) for outgoing email
- a Keycloak identity server with its own database sidecar
- a realm and a service client managed through `@pulumi/keycloak`
- generated `.env` files carrying connection strings and the client secret

It demonstrates the three patterns that make container-hosted providers
workable, all driven by the library:

1. `containerHostedProviders: ["identity"]` — the lifecycle purges the
   provider's resources from state when their backing container goes away.
2. `if (context.destroying) return;` — the destroy run never registers the
   provider whose service is being torn down (the containers above the guard
   stay registered, so the destroy plan still includes them).
3. `url: identity.readyUrl` — the provider waits for the server to answer
   HTTP before configuring itself.

```bash
# from the repository root, once
pnpm install && pnpm build

# from this directory
pnpm sandbox:create     # network, 4 containers, realm, client, .env files
pnpm sandbox:destroy
pnpm sandbox:reset
```

Keycloak admin console: http://localhost:25080 (dev / dev). Mail inbox:
http://localhost:25026.
