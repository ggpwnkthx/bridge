# The operations of the studio

## The probes

| The route | What it answers |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok","service":"bridge","version":"0.1.0"}` — as long as the process is alive. |
| `GET /readyz` | `200 {"status":"ready"}` |

The probes are disabled with `BRIDGE_PROBES=false`.

## The logs

The logs are structured: one json document per line.

```json
{"level":"info","time":"2026-01-08T10:00:00.000Z","service":"bridge","message":"the request was answered","requestId":"…","method":"GET","path":"/w/22222222-…/api/items/articles","status":200,"durationMs":12}
{"level":"info","time":"2026-01-08T10:00:03.000Z","service":"bridge","message":"a caller logged in","requestId":"…","subject":"b1c2…"}
```

The studio never writes a token, a secret or the body of a row. The
fields of the events are the identifier of the request, the method, the
path, the status, the duration and the subject of the caller.

The identifier of the request is the one of the answer, and the one of
the backend when the studio forwards a call: the logs of the three
services of a request can be followed with it.

## The configuration

The whole list is in [`.env.example`](../.env.example). The rules that a
production environment has to satisfy:

| The variable | Why |
| --- | --- |
| `BRIDGE_WORKSPACES` | The studio serves the workspaces it is configured with and no other one. |
| `BRIDGE_GATEWAY_IDENTITY_PUBLIC_KEY` | The studio verifies the identity of the gateway with it. |
| `BRIDGE_SECURE_COOKIES=true` | The cookies of the studio are credentials. |
| `BRIDGE_REQUIRE_GATEWAY_IDENTITY=true` | The studio is only reachable through the gateway. |

A configuration that could not be used stops the process with the list of
the problems:

```
invalid configuration: BRIDGE_WORKSPACES is required in a production environment
```

## The failures

| What the caller sees | What it means | What to do |
| --- | --- | --- |
| The studio asks for a login | The session is over or it was never there. | Nothing: the browser comes back with the login. |
| `INVALID_GATEWAY_IDENTITY` | The signature of the gateway does not verify. | The key of the studio and the key of the gateway are not the same one, or the studio is reached without the gateway. |
| `GATEWAY_IDENTITY_REQUIRED` | The request did not come through the gateway. | The route of the gateway is missing, or the studio is exposed. |
| `IDENTITY_MISMATCH` | The caller of the gateway is not the one who logged in. | The two sessions belong to two callers: the browser is stale. |
| `WORKSPACE_NOT_ALLOWED` | The workspace is not one of the deployment. | Add it to `BRIDGE_WORKSPACES`. |
| `WORKSPACE_MISMATCH` | The gateway attributes the request to another workspace. | The placeholder of the route of the gateway and the path of the studio do not agree. |
| `CSRF_FAILED` | The token of the session is missing or it is wrong. | The browser is stale: reload the studio. |
| `FORBIDDEN` | The backend refused the request. | The caller may not use that collection, that field or the audit log. |
| `INVALID_QUERY` | A parameter of the query is out of the bounds. | Fix the query. |
| `NOT_FOUND` | The collection or the row does not exist for this caller. | Check the name, and the permissions of the caller. |

## The drain

The studio stops on `SIGINT` and on `SIGTERM`: it stops the listener and
it ends the process. A session in flight is lost: the browser asks for a
login again.

## The limits of the deployment

| What | The limit | Where it comes from |
| --- | --- | --- |
| The size of a page | 200 rows | The contract of the backend. |
| The number of the sorts | 3 | The contract of the backend. |
| The number of the expansions | 5 | The contract of the backend. |
| The length of the search | 256 characters | The contract of the backend. |
| The number of the groups | 1000 | The contract of the backend. |
| The lifetime of a session | 3600 seconds | `BRIDGE_SESSION_TTL_SECONDS`. |
| The lifetime of a login that is in flight | 600 seconds | The studio. |
| The number of the sessions in the process | 10 000 | The store of the sessions. |

## The known limits

- The store of the sessions is in the process: a deployment with several
  replicas needs a shared store, and the interface of the store is the
  one of `src/domains/identity/session.ts`.
- The studio does not cache: every page of rows is a call to the backend.
- The studio has no notion of a role of its own: the roles it shows are
  the roles the broker published, and the permissions it applies are the
  ones the backend answered.
