# The http surface of the studio

Every route of the studio, its request and its answer. The behavior
behind them is in [`spec.md`](spec.md).

The bodies are JSON. The errors are
`{"error":{"code":"…","message":"…"},"requestId":"…"}`, and the codes of
the studio are listed in §8.2 of the specification.

Every answer carries the header `x-request-id`.

---

## The probes

| Route | Answer |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok","service":"bridge","version":"0.1.0"}` |
| `GET /readyz` | `200 {"status":"ready"}` |

The probes are disabled when `BRIDGE_PROBES` is `false`.

---

## The login

### `GET /login`

The redirect to the broker. The query `workspace` names the workspace
the browser comes back to.

```bash
curl -sS -D - -o /dev/null http://studio.example.com/login
```

```
HTTP/1.1 302 Found
location: https://hub.example.com/oauth/authorize?client_id=bridge&…
set-cookie: bridge_login=…; Path=/; SameSite=Lax; HttpOnly; Max-Age=600
```

The request carries the state, the nonce and the challenge of the proof
key (`code_challenge_method=S256`).

### `GET /auth/callback`

The end of the login. The broker sends the browser back with the code
and the state.

```bash
curl -sS -D - -o /dev/null \
  'http://studio.example.com/auth/callback?code=…&state=…' \
  -H 'cookie: bridge_login=…'
```

```
HTTP/1.1 302 Found
location: /w/22222222-2222-4222-8222-222222222222/
set-cookie: bridge_session=…; Path=/; SameSite=Lax; HttpOnly; Max-Age=3600
```

A login that was not completed, or that was refused, answers `302` with
`?error=…` on the path of the studio.

### `POST /logout`

The end of the session. The answer is `204` and the cookie of the
session is deleted.

---

## The studio

### `GET /w/{workspaceId}`

The document of the studio. The workspace of the path is written into
the document, and the server has already checked that the studio may
serve it.

The answer is `403 WORKSPACE_NOT_ALLOWED` for a workspace that the
deployment does not serve.

### `GET /static/{file}`

The bundle of the script of the browser and the styles of the studio.

---

## The api of the studio

Every route of the api needs the session of the caller: the answer is
`401 AUTHENTICATION_REQUIRED` without it.

Every route that changes the state needs the token of the session in the
header `x-bridge-csrf`. The token is read from
`GET /w/{workspaceId}/api/session`.

A route that changes the state of a row needs the validator of the row
in the header `if-match`: the validator is read from the answer of
`GET /w/{workspaceId}/api/items/{collection}/{id}` and it is carried
from there to the write.

A refusal of the token of the caller — a `401` of the platform — ends
the session: the answer is `401 AUTHENTICATION_REQUIRED` and the browser
is sent back to the login.

### `GET /w/{workspaceId}/api/session`

```json
{
  "data": {
    "principal": {
      "subject": "b1c2…",
      "email": "alice@example.com",
      "name": "Alice",
      "roles": ["editor"]
    },
    "workspace": "22222222-2222-4222-8222-222222222222",
    "csrfToken": "…",
    "gateway": {
      "subject": "b1c2…",
      "roles": ["editor"],
      "workspaceId": "22222222-2222-4222-8222-222222222222"
    }
  }
}
```

The `gateway` is `null` when the deployment does not verify the identity
of the gateway.

### `GET /w/{workspaceId}/api/schema`

The metadata of the collections the caller may use. The answer is the
metadata of the backend, unchanged.

### `GET /w/{workspaceId}/api/schema/{collection}`

The metadata of one collection.

### `GET /w/{workspaceId}/api/items/{collection}`

A page of the rows. The parameters are the ones of the contract of the
backend:

| Parameter | What it is |
| --- | --- |
| `fields` | The fields of the projection, at most 50. |
| `filter` | The json filter of the query. |
| `search` | The text of the search, at most 256 characters. |
| `sort` | Up to three fields, `-` for descending. |
| `limit` | The size of the page, at most 200. |
| `cursor` | The cursor of the next page. |
| `include` | The relations to expand, at most 5. |
| `include_count` | `true` for the count of the rows. |

```bash
curl -sS 'http://studio.example.com/w/22222222-…/api/items/articles?limit=25&sort=-createdAt' \
  -H 'cookie: bridge_session=…'
```

```json
{
  "data": [{ "id": "r1", "version": 3, "title": "Hello" }],
  "meta": { "limit": 25, "nextCursor": null }
}
```

A parameter that is out of the bounds is `400 INVALID_QUERY`.

### `GET /w/{workspaceId}/api/items/{collection}/{id}`

One row, and the validator of it.

```json
{ "data": { "id": "r1", "version": 3, "title": "Hello" }, "etag": "\"v3\"" }
```

### `POST /w/{workspaceId}/api/items/{collection}`

The creation of a row. The body is the row, and the header
`idempotency-key` is the key of the creation: the studio makes one when
the browser does not send it.

```bash
curl -sS -X POST 'http://studio.example.com/w/22222222-…/api/items/articles' \
  -H 'cookie: bridge_session=…' \
  -H 'x-bridge-csrf: …' \
  -H 'idempotency-key: the-key-of-the-creation' \
  -H 'content-type: application/json' \
  -d '{"title":"Hello"}'
```

```json
{ "data": { "id": "r2", "version": 1 } }
```

The answer is `201`.

### `PATCH /w/{workspaceId}/api/items/{collection}/{id}`

The change of a row. The header `if-match` carries the validator of the
row, and it is required.

```json
{ "data": { "id": "r1", "version": 4, "title": "Hello" }, "etag": "\"v4\"" }
```

### `DELETE /w/{workspaceId}/api/items/{collection}/{id}`

The deletion of a row. The header `if-match` carries the validator of the
row, and it is required. The answer is `204`.

### `GET /w/{workspaceId}/api/items/{collection}/{id}/versions`

The history of a row: the versions that are not the current one, the
newest first. The answer is `404 NOT_FOUND` when the collection keeps
no history.

```json
{
  "data": [
    {
      "version": 3,
      "operation": "update",
      "changedFields": ["title"],
      "supersededAt": "2026-10-23T10:00:00.000Z",
      "supersededBy": "b1c2d3e4-…"
    }
  ]
}
```

### `GET /w/{workspaceId}/api/items/{collection}/{id}/versions/{version}`

One version of a row, and the validator of it.

```json
{ "data": { "id": "r1", "version": 3, "title": "Hello" }, "etag": "\"v3\"" }
```

### `POST /w/{workspaceId}/api/items/{collection}/{id}/rollback`

The rollback of a row to one of its versions. The body holds the version
and the header `if-match` carries the validator of the row, and both are
required.

```bash
curl -sS -X POST 'http://studio.example.com/w/22222222-…/api/items/articles/r1/rollback' \
  -H 'cookie: bridge_session=…' \
  -H 'x-bridge-csrf: …' \
  -H 'if-match: "v4"' \
  -H 'content-type: application/json' \
  -d '{"version":3}'
```

```json
{ "data": { "id": "r1", "version": 5, "title": "Hello" }, "etag": "\"v5\"" }
```

The version of the record never moves back: the record holds the version
that follows the one it had.

### `GET /w/{workspaceId}/api/aggregate/{collection}`

The groups of an aggregate. The parameters are `group_by` (at most three
fields), `metrics` (`count`, `sum:amount`, `avg:amount`, `min:amount`,
`max:amount`), `filter`, `search` and `limit` (at most 1000).

```json
{
  "data": [{ "group": { "status": "published" }, "count": 12 }],
  "meta": { "limit": 100, "groups": 1, "truncated": false }
}
```

### `GET /w/{workspaceId}/api/audit`

A page of the audit log of the workspace. The parameters are `limit` (at
most 200) and `cursor`. The answer is `403 FORBIDDEN` when the caller
may not read the audit log: the studio forwards the refusal of the
backend.
