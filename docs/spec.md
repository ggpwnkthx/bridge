# The behavior of the studio

This document is the normative behavior of Bridge. It says what the
studio does, what it refuses and what it never does. The code follows it
and the tests of the repository prove the parts of it that are named in
them.

The vocabulary is the one of the platform:

- the **broker** is [Hub](https://github.com/ggpwnkthx/hub): it
  authenticates the callers and it publishes their identity,
- the **gateway** is [Shuttle](https://github.com/ggpwnkthx/shuttle): it
  authenticates the browser, it signs the identity of the caller and it
  forwards the request,
- the **backend** is [Depot](https://github.com/ggpwnkthx/depot): it owns
  the workspaces, the collections, the records, the policies and the
  audit history.

## 1. The role of the studio

The studio is a **client** of the backend, like any other client of the
platform.

1. The studio reads the collections, the fields and the permissions of a
   workspace through the API of the backend.
2. The studio writes the rows that the caller may write, through the same
   API.
3. The studio never reaches the database, never reads a manifest of the
   deployment and never evaluates a policy.
4. The studio never holds a credential of an operator: it holds the token
   of the caller and nothing else.
5. The studio never signs an identity: the gateway signs it and the
   backend verifies that signature.

The permissions of the studio are the permissions of the backend: the
collections it lists are the collections the caller may use, and the
fields it offers to edit are the fields the caller may write. The studio
hides what the caller may not do, and it never hides a refusal: the code
of the error is shown as it is.

## 2. The configuration

The studio is configured by its environment, and the environment is read
once, at the start of the process.

1. A configuration that could not be used stops the process: it is never
   applied in part.
2. A production environment needs the workspaces it serves and the key
   with which the identity of the gateway is verified.
3. The workspaces are the identifiers of the workspaces of the backend.
   The studio refuses a workspace that is not one of them.
4. The redirect uri of the login is `{BRIDGE_PUBLIC_URL}/auth/callback`.
5. The `Secure` attribute of the cookies of the studio is set in a
   production environment, and it may be unset in a development one.

## 3. The broker

The studio authenticates its callers against the broker with the
authorization code flow and PKCE.

1. The studio reads the discovery of the broker and it uses the
   authorization, the token, the user info and the keys endpoints of it.
2. The request of the authorization carries the state, the nonce and the
   challenge of the proof key. The verifier never leaves the server of the
   studio.
3. The state, the nonce and the verifier are held in the server, and the
   state is used once: a second callback with the same state is refused.
4. The token of the identity is verified with the keys of the broker: the
   issuer, the audience and the nonce have to match. The claims of the
   profile and the subject of the token have to be the same principal.
5. The studio holds the token of the caller in its own server. The
   browser holds an opaque identifier of a session and nothing else.
6. The studio asks for the scopes of its configuration, and it does not
   ask for a scope it does not use.

## 4. The gateway

The studio is deployed behind the gateway, and it verifies the identity
that the gateway writes into the headers of the request.

1. The signature is a JWS with a detached payload. The studio rebuilds
   the payload from the request and from the identity headers, and it
   verifies the signature with the library.
2. The versions `v5` (an `ES256` signature with the public key of the
   deployment) and `v4` (an `HS256` signature with the derived key) are
   understood. A version that is not known is refused.
3. A deployment that gave a key to the studio refuses a request whose
   signature does not verify, and a production environment refuses a
   request that carries no signature at all.
4. The subject of the gateway and the subject of the session have to be
   the same: the caller of the gateway is the one who logged in.
5. When the deployment binds the workspace, the workspace of the
   identity of the gateway has to be the workspace of the studio: the
   gateway decides which workspace a caller uses.

## 5. The sessions

### 5.1 The lifetime

1. A session lives for the lifetime of its configuration, and it is
   forgotten when it is over.
2. A session holds the token of the caller, the profile of the caller and
   the token that protects the changes of the state.
3. The store of the sessions is in the process. A deployment with several
   replicas needs a shared store, and the interface of the store is the
   one of [`src/domains/identity/session.ts`](../src/domains/identity/session.ts).

### 5.2 The cookies

1. The cookie of the session is `bridge_session`, it is `httpOnly`, it is
   `sameSite=Lax` and it is `secure` in a production environment.
2. The cookie of a login that is in flight is `bridge_login`, and it has
   the same attributes.
3. A change of the state carries the token of the session in the header
   `x-bridge-csrf`, and the studio refuses a request that does not carry
   it or that carries the wrong one.
4. A request that carries an `Origin` is refused when the origin is not
   the origin of the studio.

## 6. The data backend

1. Every call of the studio to the backend goes through the gateway, with
   the token of the caller as a bearer token.
2. The studio speaks the contract of the version `v1` of the backend: the
   paths, the envelopes and the codes of the errors are the ones of that
   contract.
3. The studio never changes a code of an error: it forwards the code, the
   message and the identifier of the request of the backend as they are.
4. The validator of a record is carried from the answer of the backend to
   the request that writes it: the studio never writes a record without
   the validator it read.
5. A creation carries a key of idempotence. The key of the browser is
   used when it carries one, and the studio makes one of its own
   otherwise.

## 7. The queries

1. The studio parses the parameters of a query of the browser before it
   calls the backend, and it refuses the parameters it does not know.
2. The bounds of the studio are the bounds of the contract of the
   backend: the size of a page, the number of the fields, the number of
   the sorts, the number of the expansions and the length of the search.
3. The filter is a json document, and it is sent to the backend as it
   is: the backend refuses the filter it does not understand.

## 8. The http surface

### 8.1 The assets

1. The studio serves one document and the assets of it. The document
   holds the frame of the application and the workspace of the path; the
   script of the browser reads everything else from the api.
2. The script of the browser is written in TypeScript and it is bundled
   into one file by the build of the repository.
3. The studio never writes a value of a row as markup: the script builds
   every element of the interface with the document itself.

### 8.2 The answers

1. An answer of a success carries its data and, when the contract of the
   backend has one, its metadata.
2. An answer of a failure carries the code of the error, a message and
   the identifier of the request. The code is the stable part.
3. The codes of the studio are `AUTHENTICATION_REQUIRED`,
   `INVALID_WORKSPACE`, `WORKSPACE_NOT_ALLOWED`, `WORKSPACE_MISMATCH`,
   `IDENTITY_MISMATCH`, `INVALID_GATEWAY_IDENTITY`,
   `GATEWAY_IDENTITY_REQUIRED`, `CSRF_FAILED`, `ORIGIN_REFUSED`,
   `INVALID_QUERY`, `INVALID_REQUEST`, `NOT_FOUND` and
   `INTERNAL_ERROR`.
4. A refusal of the backend is a refusal of the studio: the status and
   the code of the backend are forwarded.

### 8.3 The routes

| The path | The method | What it answers |
| --- | --- | --- |
| `/healthz`, `/readyz` | `GET` | The probes of the deployment. |
| `/login` | `GET` | The redirect to the broker. |
| `/auth/callback` | `GET` | The end of the login, and the redirect to the studio. |
| `/logout` | `POST` | The end of the session. |
| `/w/{workspaceId}/` | `GET` | The studio. |
| `/w/{workspaceId}/api/session` | `GET` | The identity of the caller. |
| `/w/{workspaceId}/api/schema` | `GET` | The metadata of the collections. |
| `/w/{workspaceId}/api/schema/{collection}` | `GET` | The metadata of one collection. |
| `/w/{workspaceId}/api/items/{collection}` | `GET`, `POST` | A page of the rows, and the creation of one. |
| `/w/{workspaceId}/api/items/{collection}/{id}` | `GET`, `PATCH`, `DELETE` | One row, its change and its deletion. |
| `/w/{workspaceId}/api/aggregate/{collection}` | `GET` | The groups of an aggregate. |
| `/w/{workspaceId}/api/audit` | `GET` | A page of the audit log. |
| `/assets/*` | `GET` | The assets of the studio. |

## 9. The process

### 9.1 The logs

The logs are structured: every line is a json document with a level, a
time, a message and the fields of the event. The studio never writes a
token, a secret or the body of a row in a log.

### 9.2 The server

The studio is a Bun server. It answers the probes of the deployment, it
drains on a signal of the process, and it never starts a listener with a
configuration that could not be used.
