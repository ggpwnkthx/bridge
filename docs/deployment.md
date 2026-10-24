# The deployment of the studio

The studio is deployed **behind the gateway**, it authenticates its
callers against the **broker**, and it calls the **backend** through the
gateway. This document is the wiring of the three services.

```
the browser ──▶ Shuttle ──▶ Bridge ──▶ Shuttle ──▶ Depot
                    │                                   │
                    │                                   └──▶ Hub
                    └──▶ Hub (the login of the caller)
```

## The shape of the urls

The studio and the backend share the host of the gateway, and they are
distinguished by their path:

| The path | The service |
| --- | --- |
| `/w/{workspaceId}` | The studio. |
| `/w/{workspaceId}/api/*` | The api of the studio. |
| `/ws/{workspaceId}/v1/*` | The backend. |

The workspace is in the path of both, and it is the same placeholder:
the gateway checks the access of the caller to that workspace once, and
the studio refuses a workspace it does not serve.

## The configuration of the gateway

```json
{
  "version": 1,
  "defaults": {
    "auth": { "mode": "none" },
    "timeouts": { "responseMs": 5000, "firstByteMs": 30000, "bodyMs": 300000 }
  },
  "trustedProxies": ["10.0.0.0/8"],
  "routes": [
    {
      "id": "studio",
      "match": { "host": "studio.example.com", "path": "/w/{workspaceId}" },
      "upstream": "http://bridge:8081",
      "auth": { "mode": "none" }
    },
    {
      "id": "data-api",
      "match": { "host": "studio.example.com", "path": "/ws/{workspaceId}/v1/" },
      "upstream": "http://depot:8080",
      "auth": { "mode": "any", "workspace": { "param": "workspaceId", "requireUuid": true } }
    }
  ]
}
```

Two remarks about that file:

- the route of the studio is `mode: none`: the studio authenticates its
  callers itself, against the broker, and it does not need a session of
  the gateway. The studio is protected by the network and by the key of
  the gateway, not by the session of the gateway,
- the route of the backend is `mode: any`: the studio presents the token
  of the caller as a bearer token, and the gateway accepts it.

The session of the gateway never reaches the studio: the gateway removes
its own cookies from the requests it forwards, because a session id is a
credential of the caller. The studio cannot reuse it, and it does not
try to: it holds a session of its own, and it presents the token of the
caller to the route of the backend.

## The migration of the platform

The studio is proven against the gateway `2.0.0`, the broker `2.0.0` and
the backend `0.4.0`. The two first ones are **MAJOR** releases, and a
deployment of the studio that runs them has to read the migration of the
platform. The studio itself needs nothing: it reads the identity of the
gateway as the gateway writes it, and it verifies the signature with the
key of the deployment.

| The change | What a deployment has to do |
| --- | --- |
| The gateway writes the **subject** of the caller as it is, and refuses a subject that is empty, that carries a control character or that is longer than 512 characters with a `500`. | Nothing for the studio: the subject of the broker is a uuid, and the studio compares it with the subject of the session byte for byte. A deployment whose provider issues another kind of subject has to fix its provider. |
| The **host** of a request is decided before its method, and the ranges of the trusted proxies of the environment **replace** the ones of the file of the routes. | Nothing for the studio: its two routes share one host. A deployment whose catch-all names `GET` and answers for the host of the studio has to move that host to the catch-all, or to name the methods the host does not answer. |
| The address of the caller is read from the **number** of the proxies in front of the gateway, and not from the ranges of the trusted proxies. The new variable is `SHUTTLE_TRUSTED_PROXY_HOPS` (one by default). | A deployment with more than one proxy in front of the gateway has to name the number of them. A deployment with one proxy — the usual one — has nothing to do. |
| The users of the shared state in Redis are written by the deployment at every start, and the file of the roles no longer holds their passwords. | A deployment of the gateway with Redis writes the two passwords after the server started. The studio does not touch the shared state of the gateway. |
| The decisions of a **gateway** are scoped to their tenant, and the shared credential of the deployment is deprecated. | The gateway of the platform presents the shared credential of the deployment; the broker answers the decision and writes a warning. It is the only scheme the gateway speaks today. The studio holds a credential of the **tenant** and it uses it for the login of the callers only: it never asks the broker for a decision. |
| The backend of the platform reads the values of the identity **as they are** and refuses the ones the gateway did not write. | Nothing for the studio: it reads the identity the same way, and it refuses a header that appears twice. |

## The configuration of the broker

The studio is a **client** of the broker, like the gateway is. It needs a
client of its own, with the url of the studio as a redirect uri:

```bash
curl -sS -X POST https://hub.example.com/v1/admin/tenants \
  -H "authorization: Bearer $HUB_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "slug": "acme",
        "displayName": "Acme Inc",
        "issuer": "https://login.acme.example",
        "idpClientId": "hub-acme",
        "idpClientSecret": "the-secret-of-the-provider",
        "clientId": "bridge-acme",
        "clientSecret": "the-secret-of-the-studio",
        "clientRedirectUris": ["https://studio.example.com/auth/callback"],
        "emailDomain": "acme.example",
        "enabled": true
      }'
```

The `clientId` and the `clientSecret` of that client are the values of
`BRIDGE_HUB_CLIENT_ID` and `BRIDGE_HUB_CLIENT_SECRET`.

The grants of the principals stay the business of the broker: the studio
shows the collections that the backend answers, and the backend asks the
broker for the capabilities of the caller.

## The configuration of the backend

The backend is told which route of the gateway is its own, and it is
given the key with which it verifies the signature of the gateway:

```json
{
  "version": 1,
  "bindings": [
    {
      "id": "data-api",
      "host": "studio.example.com",
      "upstreamPathPattern": "/ws/{workspaceId}/v1/*",
      "routeId": "data-api",
      "identityKeyFile": "./secrets/identity.key"
    }
  ]
}
```

The `routeId` is the id of the route of the gateway above: the backend
sends it to the broker when it asks for the access context of a caller.

## The configuration of the studio

```bash
BRIDGE_PUBLIC_URL=https://studio.example.com
BRIDGE_GATEWAY_URL=https://studio.example.com
BRIDGE_HUB_URL=https://hub.example.com
BRIDGE_HUB_CLIENT_ID=bridge-acme
BRIDGE_HUB_CLIENT_SECRET=the-secret-of-the-studio
BRIDGE_WORKSPACES=22222222-2222-4222-8222-222222222222
BRIDGE_SECURE_COOKIES=true
BRIDGE_REQUIRE_GATEWAY_IDENTITY=true
BRIDGE_BIND_GATEWAY_WORKSPACE=true
```

`BRIDGE_GATEWAY_URL` is the url of the **gateway**, and not the url of
the backend: the studio never reaches the backend directly, because the
backend only accepts a request that the gateway signed.

## The key of the gateway

The gateway signs the identity of a request with the private key of the
deployment, and the upstreams hold the public one:

```bash
# in the gateway
bun run identity:key                 # a new pair, the private key in the environment
bun run identity:key --public        # the public key of the deployment

# in the studio
BRIDGE_GATEWAY_IDENTITY_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----…"
```

The studio verifies the signature with the public key, so it can check
an identity and it cannot mint one.

The symmetric format of the earlier releases (`v4`) is **not** read by
the studio: the gateway removed it in its `1.0` release, because its
key was shared with the upstreams and an upstream that verified an
identity could mint one. A gateway older than `1.0` is not a gateway
the studio can be deployed behind.

## The order of the deployment

1. The **broker** is deployed, and the tenant is created with the client
   of the studio.
2. The **backend** is deployed, the schema is applied, the workspace is
   created and the catalog is published.
3. The **gateway** is deployed with the routes of the studio and of the
   backend, and the bindings of the backend are written.
4. The **studio** is deployed with the configuration above, and it is
   given the public key of the gateway.

The studio is useless without the other three, and it is safe to deploy
it first: it refuses to start with a configuration that could not be
used.
