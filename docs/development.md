# The development machine

The studio is useless alone: it needs the broker, the gateway and the
backend. This document is the wiring of the four services on a
development machine.

```
the browser ──▶ Bridge ──▶ Shuttle ──▶ Depot
                    │                     │
                    └──▶ Hub ────────────┘
                    (the login, the decisions, the capabilities)
```

The runner of this repository starts the four services, the database and
the fixtures of the development machine, in one process:

```bash
bun install
bun run dev:stack
```

It needs the checkouts of the three other repositories next to this
one:

```
bridge/  depot/  hub/  shuttle/
```

and the binaries of **PostgreSQL 15 or later** (`initdb` and `pg_ctl` in
`/usr/lib/postgresql/15/bin` on Debian and Ubuntu).

## What the runner starts

| Service | Port | What it is |
| --- | --- | --- |
| PostgreSQL | 5433 | The database of the backend and of the broker. It lives in `.dev/pg`. |
| the identity provider | 5556 | The fixture of the tenant of the broker, from `shuttle/services/oidc-provider.ts`. |
| Hub | 8082 | The broker: the login of the callers, the decisions of the gateway, the capabilities of the backend. |
| Depot | 8083 | The backend: the collections, the rows, the aggregates and the audit log. |
| Shuttle | 8080 | The gateway: it signs the identity of the caller and it forwards the request. |
| Bridge | 8081 | The studio, with a reload of the server. |

The studio answers at
<http://localhost:8081/w/22222222-2222-4222-8222-222222222222/> and the
caller signs in with `alice@shuttle.test` / `alice-password`.

## What the runner writes

The state of the stack lives in `.dev` (it is ignored by git):

| The file | What it holds |
| --- | --- |
| `.dev/pg` | The data of PostgreSQL. |
| `.dev/routes.json` | The route table of the gateway: the route of the data, `/ws/{workspaceId}/` → the backend. |
| `.dev/bindings.json` | The trusted route bindings of the backend: the route of the gateway, with the file of the key of the identity. |
| `.dev/identity.key` | The derived key of the signature of the gateway, in base64. |
| `.dev/hub-signing-key.pem` | The private key with which the broker signs its tokens. |
| `.dev/cursor.key` | The key with which the backend signs its cursors. |
| `.dev/hub-context.token` | The read only credential of the access context contract. |

The secrets of the development machine are the fixtures of
[`scripts/dev-stack.ts`](../scripts/dev-stack.ts). They are not secrets
of a deployment.

## What the runner prepares

1. It starts PostgreSQL and it creates the roles of the backend
   (`data_owner`, `data_runtime`, `data_registry`, `data_delivery`,
   `data_maintenance`) and the two databases (`depot` and `hub`).
2. It applies the migrations of the backend.
3. It starts the fixture of the identity provider of the tenant.
4. It starts the broker, and it writes its fixtures through its
   administration: the tenant `dev`, the principal of `alice@shuttle.test`,
   the group `editors` and the grants of the workspace on the route
   `data-api` (`content.reader`, `content.editor`, `data.audit.read`).
5. It creates the workspace `22222222-2222-4222-8222-222222222222` in
   the registry of the backend, and it registers the collections
   `articles` and `categories` for it.
6. It starts the backend, the gateway and the studio.

The runner is idempotent: the tenant is an upsert, the workspace is an
upsert, the grants are put again. The database of a previous run is kept;
`DEV_FRESH=1 bun run dev:stack` drops it and starts from nothing.

## The smoke test

The runner answers before the flow of a caller is proven. The smoke test
drives it the way a browser does:

```bash
bun run dev:smoke
```

It logs the caller in against the broker (through the fixture of the
identity provider), reads the catalog of the workspace, reads a
collection and writes a row. It fails with the message of the service
that refused.

## The test of the interface

The smoke test proves the flow of the api. The interface of the studio
is another matter: it is the script of a browser, and it is proved in a
browser, against the same development machine:

```bash
bun run dev:ui
```

It signs a caller in the way a browser does, and it checks the shapes
the studio shows — a field that has no value is an empty field, a field
of lines is a field of lines, a field that cannot be empty does not
offer the empty choice — and it writes a record and reads it back, with
its lines and with its cleared field. It runs axe over the rows and over
the drawer of a record, and it fails on a serious violation.

It needs the browser of Playwright:

```bash
bunx playwright@1.64.1 install chromium
```

The runner of the continuous integration does the same, with the four
repositories next to each other and the database of the development
machine.

## Running the services by hand

The runner is a convenience, not a requirement. The four services can be
started one by one, with the environment of the deployment described in
[`docs/deployment.md`](deployment.md) and in the `.env.example` of each
repository. The environment of the runner is the reference of the values
that a development machine uses:

| The variable | The value of the runner |
| --- | --- |
| `BRIDGE_GATEWAY_URL` | `http://localhost:8080` (the gateway). |
| `BRIDGE_HUB_URL` | `http://localhost:8082` (the broker). |
| `BRIDGE_HUB_CLIENT_ID` / `BRIDGE_HUB_CLIENT_SECRET` | `dev-client` / `dev-client-secret-of-the-development-machine`. |
| `BRIDGE_WORKSPACES` | `22222222-2222-4222-8222-222222222222`. |
| `BRIDGE_SECURE_COOKIES` | `false`. |
| `BRIDGE_REQUIRE_GATEWAY_IDENTITY` | `false` (the browser answers the studio directly on its own port, so the request carries no signature of the gateway). |
| `SHUTTLE_OIDC_ISSUER` | `http://localhost:8082` (the broker is the provider of the gateway). |
| `SHUTTLE_ACCESS_URL` | `http://localhost:8082` (the broker answers the decisions). |
| `SHUTTLE_SESSION_URL` | `memory://local`. |
| `DATA_HUB_URL` | `http://localhost:8082` (the broker answers the capabilities). |
| `DATA_SHUTTLE_BINDINGS_FILE` | `.dev/bindings.json`. |

The broker is a client of itself in this shape: the gateway and the
studio are both clients of the tenant `dev`, and the tenant registers
the two urls of the callback (`http://localhost:8080/auth/callback` and
`http://localhost:8081/auth/callback`).

## The identity of the gateway

The gateway signs the identity of every request it forwards, and the
**backend** verifies that signature with the derived key of the
deployment (`HMAC-SHA256(SHUTTLE_SESSION_SECRET, "shuttle-identity-signature-v1")`).
The studio is a client of the gateway in this shape, and it is reached
by the browser directly, so it does not verify a signature of its own
here. A deployment that puts the studio behind the gateway gives it the
key and sets `BRIDGE_REQUIRE_GATEWAY_IDENTITY=true`: the rules are in
[`docs/deployment.md`](deployment.md) and in
[`docs/spec.md`](spec.md) §4.
