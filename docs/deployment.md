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
| `/w/{workspaceId}/` | The studio. |
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
      "match": { "host": "studio.example.com", "path": "/w/{workspaceId}/" },
      "upstream": "http://bridge:8081",
      "rewrite": "/w/{workspaceId}/{rest}",
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
an identity and it cannot mint one. A deployment that still uses the
symmetric format gives the derived key to the studio instead:

```bash
BRIDGE_GATEWAY_IDENTITY_KEY="$(base64 -w0 secrets/identity.key)"
```

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
