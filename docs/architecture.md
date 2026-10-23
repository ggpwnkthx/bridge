# The architecture of the studio

The studio is written in TypeScript on Bun. It follows the layout of the
other repositories of the platform: the domains own the rules, the
routes own the http surface, and the platform owns the runtime.

The routes are the routes of **honox**: the path of a route is the path
of its file, and the files of a directory hold the renderer, the
middleware, the page of a failure and the page of a path that does not
exist. The user interface is written in **preact**, in TSX files.

```
src/
  main.ts                  the entry point of the process
  server.ts                the application of the studio: the routes of honox
  app/
    context.ts             the context of a request: the session, the gateway
    errors.ts              the envelope of a failure
  routes/                  the routes of honox: a file is a path
    registry.ts            the table of the routes
    _renderer.tsx          the document of the studio
    _middleware.ts         the identifier of the request, and the logs
    _404.tsx               the page of a path that does not exist
    _error.tsx             the page of a failure
    index.tsx              /
    login.tsx              /login
    logout.tsx             /logout
    auth/callback.tsx      /auth/callback
    healthz.tsx            /healthz
    readyz.tsx             /readyz
    static/[...path].ts    /static/*
    w/[workspaceId]/
      index.tsx            /w/:workspaceId
      api/                 /w/:workspaceId/api/*
  components/              the components of the studio, in preact
    studio.tsx             the studio: the frame, the state and the views
    views.tsx              the rows, the aggregate and the audit log
    drawer.tsx             the drawer of a record
    frame.tsx              the top bar and the collections
    document.tsx           the document of a page
    notice.tsx             the notices and the messages
    error-page.tsx         the pages of a failure
    context.ts             what the components share
  client/                  the script of the browser
    entry.tsx              the entry of the script
    api.ts                 the client of the api of the studio
    format.ts              the words of the studio
    types.ts               the shapes of the studio
    values.ts              the values of the fields of a record
    styles.css             the styles
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
```

## The boundaries

| The directory | What it owns | What it may not do |
| --- | --- | --- |
| `domains/` | The rules of the studio and the protocols it speaks. | It reads no file, it touches no database and it imports no other domain. |
| `routes/` | The http surface of the studio: the paths, the parsing of the requests and the answers. | It holds no rule: it calls a domain and it maps its failures to the answers. |
| `app/` | The context of a request: the session of the caller, the identity of the gateway and the envelope of a failure. | It holds no rule and it knows no path. |
| `components/` | The user interface of the studio. | It talks to the api of the studio and to nothing else. |
| `client/` | The script of the browser and what it shares with the server. | It talks to the api of the studio and to nothing else. |
| `platform/` | The runtime and the configuration. | It knows nothing of the studio. |
| `observability/` | The logs. | It knows nothing of the studio. |

A domain imports nothing of the application, and the application imports
nothing of the browser. The client is a separate program that is built
into one file: it never shares a module with the server.

## The dependencies of a route

The routes of honox are found in the disk, and they cannot be given the
dependencies of the studio when they are built. The dependencies are
therefore put in the context of the request by the middleware of
`src/server.ts`, and the routes read them from there:

```ts
export const GET = [
  async (c: RouteContext<'/w/:workspaceId/api/session'>) => {
    const session = await establish(c)
    ...
  },
]
```

A test builds the studio with the dependencies it needs
(`createStudioApp(dependencies)`), and the contract of the http surface
runs the real routes.

## The dependencies

| The dependency | The version | Why |
| --- | --- | --- |
| `hono` | `4.13.13` | The http boundary. |
| `honox` | `0.1.62` | The routes: the path of a route is the path of its file. |
| `jose` | `6.2.12` | The signature of the gateway, the token of the identity and the keys of the broker. |
| `preact` | `11.0.1` | The user interface of the studio. |
| `preact-render-to-string` | `6.8.1` | The document of a page, on the server. |
| `zod` | `4.6.7` | The shape of the environment. |

The user interface is written in preact: the studio renders a table of
rows and a drawer, and the components of `src/components` are the whole
of it. Every value of a row is read as text by preact, so nothing of a
row of the backend can become markup.

## The flow of a call

```
the browser ──▶ routes ──▶ domains/studio/depot ──▶ the gateway ──▶ the backend
                   │                   │
                   │                   └──▶ domains/identity (the token of the caller)
                   └──▶ domains/gateway (the identity of the gateway)
```

1. The application establishes the context of the request: the session
   of the caller, and the identity of the gateway when the deployment gave a
   key to verify it with.
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
