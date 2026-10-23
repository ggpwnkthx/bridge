# Bridge

The **studio** of the headless data backend.

Bridge is a stand-alone web application that shows the data of a
workspace of [Depot](https://github.com/ggpwnkthx/depot) and lets a
caller change it: the collections, the rows, the aggregates and the audit
log. It is a **client** of the backend, like any other client: it knows
the contract of the version `v1` of the API and nothing else. It never
reaches the database, it never reads a manifest and it never decides
what a caller may do.

- **Runtime:** TypeScript on Bun 1.4.3, Hono at the HTTP boundary, honox
  for the routes and preact for the user interface.
- **Identity:** the callers authenticate against
  [Hub](https://github.com/ggpwnkthx/hub), the broker of the platform,
  with the authorization code flow and PKCE.
- **Gateway:** every call to the backend goes through
  [Shuttle](https://github.com/ggpwnkthx/shuttle), which signs the
  identity of the caller. The studio never signs anything itself.

## The shape of the studio

```
browser ──▶ Shuttle ──▶ Bridge ──▶ Shuttle ──▶ Depot
                │                      │            │
                │                      └────────────┴──▶ Hub
                │                                        (the decisions,
                │                                         the access context)
                └──▶ Hub (the login of the caller)
```

The studio is deployed **behind the gateway**: the gateway authenticates
the browser, it signs the identity of the caller, and the backend
verifies that signature. The studio verifies it too, and it refuses a
request that did not come through the gateway.

The studio holds the token of the caller on its own server: the browser
holds an opaque identifier of a session and nothing else. Every call of
the script of the browser goes to the studio, and the studio calls the
backend with the token of the caller.

## The commands

| Command | What it does |
| --- | --- |
| `bun install` | The dependencies of the studio. |
| `bun run build` | The bundle of the script of the browser. |
| `bun run start` | The studio. |
| `bun run dev` | The studio, with a reload of the server. |
| `bun run dev:client` | The bundle of the script of the browser, built again when a component changes. |
| `bun run dev:stack` | The studio **and** the broker, the gateway and the backend, in one process. |
| `bun run dev:smoke` | The login of a caller and a write, through the whole stack. |
| `bun run dev:ui` | The interface of the studio in a browser: its shapes, its writes and its accessibility. |
| `bun run typecheck` | The types of the whole repository. |
| `bun run lint` / `bun run format:check` | The style of the repository. |
| `bun test test/unit` | The rules of the domains. |
| `bun test test/contract` | The contract of the http surface. |
| `bun run test:compat` | The studio against the **baseline** of the platform: the revisions of `compatibility.json`. |
| `bun run check:compatibility` | The check of the drift of the baseline. |

## The development machine

The studio needs three services: the broker, the gateway and the backend.
The repository of the platform has a runner for the gateway and its
fixtures, and the repositories of the broker and of the backend have
their own.

The runner of this repository starts the four services, the database and
the fixtures of a development machine in one process. It needs the three
other checkouts next to this one, and the binaries of PostgreSQL:

```
bridge/  depot/  hub/  shuttle/
```

```bash
bun install
bun run dev:stack
```

The runner installs the dependencies of the four repositories when they
are not installed yet: `DEV_SKIP_INSTALL=1` says that it installs
nothing.

The studio answers at `http://localhost:8081/w/{workspaceId}`, the
gateway at `http://localhost:8080`, the broker at `http://localhost:8082`
and the backend at `http://localhost:8083`. The caller signs in with
`alice@shuttle.test` / `alice-password`. The wiring is described in
[`docs/development.md`](docs/development.md).

To run the studio alone, against services that are already up:

```bash
bun install
cp .env.example .env                       # and change the values
bun run build
bun run start
```

The build writes the script of the browser and the styles of the studio
in `dist/client`: the studio serves them at `/static/client.js` and
`/static/styles.css`.

The studio listens on `http://localhost:8081` by default. It redirects
the browser to the broker for the login, and it comes back to
`/w/{workspaceId}` when the login is complete.

## The compatibility

The studio is a client of the platform: it talks to the broker, to the
gateway and to the backend. The file `compatibility.json` owns the
revisions of the three that the studio is tested against, and the
harness of the compatibility drives the studio against them:

```bash
bun run test:compat
```

The baseline and its rules are described in
[`docs/compatibility.md`](docs/compatibility.md).

## The configuration

| The variable | What it holds |
| --- | --- |
| `BRIDGE_PUBLIC_URL` | The url the browser reaches the studio under. It is the redirect uri of the login. |
| `BRIDGE_GATEWAY_URL` | The base url of the gateway. Every call to the backend goes through it. |
| `BRIDGE_HUB_URL` | The base url of the broker. |
| `BRIDGE_HUB_CLIENT_ID` / `BRIDGE_HUB_CLIENT_SECRET` | The client of the studio at the broker. |
| `BRIDGE_WORKSPACES` | The workspaces the studio may serve. It is required in a production environment. |
| `BRIDGE_GATEWAY_IDENTITY_PUBLIC_KEY` | The public key of the gateway, for the signature `v5`. |
| `BRIDGE_REQUIRE_GATEWAY_IDENTITY` | Whether a request that did not go through the gateway is refused. |
| `BRIDGE_BIND_GATEWAY_WORKSPACE` | Whether the workspace of the gateway has to be the workspace of the studio. |

The whole list is in [`.env.example`](.env.example) and the rules are in
[`src/platform/config.ts`](src/platform/config.ts).

## The documentation

| Document | What it holds |
| --- | --- |
| [`docs/spec.md`](docs/spec.md) | The behavior of the studio, section by section. |
| [`docs/api.md`](docs/api.md) | The http surface of the studio: every route, its request and its answer. |
| [`docs/architecture.md`](docs/architecture.md) | The layout of the code and the boundaries of the domains. |
| [`docs/operations.md`](docs/operations.md) | The probes, the logs, the configuration and the failures. |
| [`docs/deployment.md`](docs/deployment.md) | The wiring of the studio with the gateway, the broker and the backend. |
| [`docs/development.md`](docs/development.md) | The development machine: the runner of the four services and its fixtures. |
| [`docs/compatibility.md`](docs/compatibility.md) | The baseline of the platform: the revisions the studio is tested against. |

## The status of the release

The studio is at `0.1.0`. It implements the contract of the version `v1`
of the backend and it passes its own gates, but it has never run outside
its own tests and it has no production history.
