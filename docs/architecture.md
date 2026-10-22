# The architecture of the studio

The studio is written in TypeScript on Bun. It follows the layout of the
other repositories of the platform: the domains own the rules, the
application owns the routes, and the platform owns the runtime.

```
src/
  main.ts                  the entry point of the process
  app/
    app.ts                 the routes, the parsing and the answers
    errors.ts              the envelope of a failure
  domains/
    identity/
      oidc.ts              the client of the broker
      session.ts           the sessions and the logins that are in flight
      cookies.ts           the cookies of the studio
    gateway/
      identity.ts          the verification of the identity of the gateway
    studio/
      depot.ts             the client of the backend, through the gateway
      queries.ts           the parameters of the queries of the studio
  platform/
    config.ts              the environment of the studio
    assets.ts              the assets of the user interface
    bun/server.ts          the server
  observability/
    logger.ts              the logs
  client/                  the script of the browser
    index.html             the frame of the application
    styles.css             the styles
    main.ts                the studio
    api.ts                 the client of the api of the studio
    dom.ts                 the helpers of the document
```

## The boundaries

| The directory | What it owns | What it may not do |
| --- | --- | --- |
| `domains/` | The rules of the studio and the protocols it speaks. | It reads no file, it touches no database and it imports no other domain. |
| `app/` | The routes, the parsing of the requests and the answers. | It holds no rule: it calls a domain and it maps its failures to the answers. |
| `platform/` | The runtime and the configuration. | It knows nothing of the studio. |
| `observability/` | The logs. | It knows nothing of the studio. |
| `client/` | The script of the browser. | It talks to the api of the studio and to nothing else. |

A domain imports nothing of the application, and the application imports
nothing of the browser. The client is a separate program that is built
into one file: it never shares a module with the server.

## The dependencies

| The dependency | The version | Why |
| --- | --- | --- |
| `hono` | `4.13.13` | The http boundary. |
| `jose` | `6.2.12` | The signature of the gateway, the token of the identity and the keys of the broker. |
| `zod` | `4.6.7` | The shape of the environment. |

There is no framework in the browser: the studio renders a table of rows
and a drawer, and a handful of helpers are enough for it. Every element
is built with the document, so nothing of a row of the backend can become
markup.

## The flow of a call

```
the browser ──▶ app/routes ──▶ domains/studio/depot ──▶ the gateway ──▶ the backend
                    │                   │
                    │                   └──▶ domains/identity (the token of the caller)
                    └──▶ domains/gateway (the identity of the gateway)
```

1. The application establishes the context of the request: the session
   of the caller, and the identity of the gateway when the deployment gave
   a key to verify it with.
2. It parses the parameters of the query with the rules of
   `domains/studio/queries.ts`.
3. It calls the backend through the gateway, with the token of the caller.
4. It maps a failure of the backend to an answer of the studio, and it
   forwards the code of the error.

## The state

The studio holds two things in its own process:

- the **sessions** of the callers, with their token,
- the **logins that are in flight**, with their state, their nonce and
  their verifier.

Both have a small interface, and a deployment with several replicas needs
a shared implementation of them. Nothing else is stored: the studio does
not cache a row, a collection or a decision.
