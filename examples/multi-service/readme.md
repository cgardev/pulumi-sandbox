# Multi-service sandbox

A realistic local platform in one program:

- one PostgreSQL container per service (orders, billing)
- a mail catcher (Mailpit) for outgoing email
- a Keycloak identity server with its own database sidecar
- a realm and a service client managed through `@pulumi/keycloak`
- generated `.env` files carrying connection strings and the client secret

It demonstrates the two patterns that make container-hosted providers
workable, both driven by the library:

1. `containerHostedProviders: ["identity"]` — the lifecycle purges the
   provider's resources from state when their backing container goes away,
   so teardown never needs to talk to the service the container hosted.
2. `url: identity.readyUrl` — the provider waits for the server to answer
   HTTP before configuring itself.

```bash
# from the repository root, once
pnpm install && pnpm build

# from this directory
pnpm sandbox:create     # network, 5 containers, realm, client, .env files
pnpm sandbox:destroy
pnpm sandbox:reset
```

Keycloak admin console: http://localhost:25080 (dev / dev). Mail inbox:
http://localhost:25026.
