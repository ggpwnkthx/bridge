# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary (daily driver):** a technical operator of the platform — support, triage, or a developer hand-correcting seeded or misbehaving records. They live in the studio for extended sessions, know the collections of a workspace by name, and read the aggregates and the audit log to answer "what happened and who changed it". They are expert users who want the truth of the backend, not a simplified story of it.
- **Secondary (occasional):** a product or content operator of a customer workspace — a support agent fixing individual records. Non-technical, infrequent use; they arrive from a ticket with a record id and a wrong value.

Both audiences are served by the same interface; the studio does not fork into a "simple" and an "expert" mode.

## Product Purpose

Bridge shows the data of a workspace of Depot and lets the caller change it: the collections, the rows, the aggregates and the audit log.

It exists because operators of a headless backend need a safe, authenticated way to look at and correct real records in a running workspace without touching the database, and because "we changed the data" has to be traceable to an actor.

Success means an operator can find a record, read it, correct it, and understand exactly why the backend refused anything they tried to do — with the refusal shown as the backend's own code, message and request identifier.

## Positioning

Bridge is a **client** of the backend, like any other client of the platform: it knows the contract of version `v1` of the Depot API and nothing else.

Its mechanism is deliberately not privileged:

- Every call to Depot goes through the Shuttle gateway, which signs the identity of the caller; Bridge never signs anything itself and never reaches the database, reads a manifest, or evaluates a policy.
- The caller's token lives on Bridge's own server. The browser holds an opaque session identifier and nothing else.
- The permissions of the studio are the permissions of the backend: the collections listed are the collections the caller may use, the fields offered for editing are the fields the caller may write.

A neighboring admin panel cannot truthfully copy this: Bridge is contract-bound, gateway-signed and refusal-transparent, rather than holding a privileged database credential of its own. Its correctness is a property it can be held to, not a policy it reimplements.

## Operating Context

- **Deployed behind the gateway.** The browser reaches Bridge at `/w/{workspaceId}/`; Hub (the broker) authenticates the caller with the authorization code flow and PKCE; Shuttle (the gateway) forwards and signs. Bridge verifies that signature too and refuses a request that did not come through the gateway.
- **A working session is the unit of work:** sign in → land in a workspace → pick a collection → browse, search, sort, filter → open a record in a drawer → save or delete → read the aggregate or the audit log.
- **The development machine** needs four checkouts side by side — `bridge/ depot/ hub/ shuttle/` — and the binaries of PostgreSQL. `bun run dev:stack` starts the four services, the database and the fixtures in one process. The studio answers at `http://localhost:8081/w/{workspaceId}/`, the gateway at `:8080`, the broker at `:8082`, the backend at `:8083`; the fixture caller signs in with `alice@shuttle.test` / `alice-password`.
- **Operation:** probes at `/healthz` and `/readyz`; structured JSON logs, one document per line, never carrying a token, a secret or the body of a row.

## Capabilities and Constraints

**Capabilities confirmed by the repository:**

- Session with the caller's identity, roles and workspace; login and logout through the broker.
- Schema metadata: collections, fields (type, required, nullable, bounds, enum, label, description), readable/writable/filterable fields, relations, allowed actions, API/schema/policy-bundle versions and the query limits.
- Rows: paged listing with search, sort, filter and limit; create, read, update, delete of a single row.
- Aggregate view per collection (group by and metrics) and a paged audit log.
- A record drawer with per-field editing, and toasts for the outcome of an action.

**Constraints that are product truth, not implementation detail:**

- The studio never reaches the database, never reads a manifest of the deployment, never evaluates a policy, and never holds an operator credential.
- It never hides a refusal: the status, the code, the message and the request identifier of the backend are forwarded as they are. The studio's own codes are `AUTHENTICATION_REQUIRED`, `INVALID_WORKSPACE`, `WORKSPACE_NOT_ALLOWED`, `WORKSPACE_MISMATCH`, `IDENTITY_MISMATCH`, `INVALID_GATEWAY_IDENTITY`, `GATEWAY_IDENTITY_REQUIRED`, `CSRF_FAILED`, `ORIGIN_REFUSED`, `INVALID_QUERY`, `INVALID_REQUEST`, `NOT_FOUND`, `INTERNAL_ERROR`.
- A record is never written without the validator read from the backend; creations carry an idempotency key.
- Unknown query parameters are refused; the bounds of the studio are the bounds of the backend contract; a filter is a JSON document sent as it is.
- A change of state carries the session's CSRF token in `x-bridge-csrf`; a request with a mismatched `Origin` is refused; a production environment refuses a request without a verified gateway signature.
- The session store is in the process. A deployment with several replicas needs a shared store (the interface at `src/domains/identity/session.ts`).

**Terminology:** fixed, see Brand Commitments.

**Open decisions (not invented here):**

- The visual world of the studio is not recorded yet; there is no `DESIGN.md`.
- The prose voice of the repository has not been confirmed as a binding constraint.

## Brand Commitments

- **Name and framing, binding:** *Bridge — the studio of the headless data backend*. The word "studio" is the product's own word for itself, not a placeholder.
- **Platform vocabulary, binding and fixed:** the **broker** is Hub, the **gateway** is Shuttle, the **backend** is Depot, the **studio** is Bridge. Documentation and interface copy use these names.
- The house register of the repository's own writing is plain, declarative and unhyped ("the studio holds the token of the caller on its own server"). It is observed rather than confirmed as binding.

## Evidence on Hand

- `docs/spec.md` — the normative behavior of the studio, section by section; the code follows it.
- `docs/api.md` — the full HTTP surface: routes, requests, answers.
- `docs/architecture.md`, `docs/operations.md`, `docs/deployment.md`, `docs/development.md` — the layout of the code, the probes/logs/configuration/failures, the wiring with gateway, broker and backend, and the development machine.
- `README.md` — the shape of the studio, the commands and the configuration.
- Development fixtures (a seeded workspace and the fixture caller) available through the dev stack.

**Absent — future work must not fabricate these:** the studio is at `0.1.0` and has never run outside its own tests, with no production history; there are no customers, testimonials, benchmarks, pricing, logos, brand assets or marketing claims of any kind.

## Product Principles

1. **The contract is the authority.** The studio shows what the backend answered and nothing else; it never decides what a caller may do.
2. **Never hide a refusal.** A refusal is surfaced with its own code, message and request identifier, in full — the code is the stable part.
3. **The token stays on the server.** The browser holds an opaque session identifier; the studio is the only thing that knows the gateway.
4. **Every action is attributable.** Writes carry the caller's identity through the gateway, and the audit log is a first-class surface, not an afterthought.
5. **Plain words, no gloss.** Name the real thing: the collection, the field, the code. No euphemism for an error, no decoration on a refusal.

## Accessibility & Inclusion

**WCAG 2.1/2.2 AA is a hard requirement** for the studio.

This is a data-dense application: tables of rows, an aggregate grid, an audit log, a record drawer with typed fields, filter and search inputs, and toasts. Keyboard operability, focus management for the drawer and its overlays, and readable contrast are requirements of the product, not polish added later.

No further user needs or standards beyond AA have been established.
