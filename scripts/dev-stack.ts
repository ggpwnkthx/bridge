#!/usr/bin/env bun
/**
 * The development stack of the platform.
 *
 * It starts the four services of a development machine in one process:
 *
 *   - PostgreSQL          (:5433)   the database of the backend and of the broker
 *   - the identity provider (:5556) the fixture of the tenant of the broker
 *   - Hub                 (:8082)   the broker and the access decisions
 *   - the data backend    (:8083)   Depot
 *   - Shuttle             (:8080)   the gateway
 *   - Bridge              (:8081)   the studio, with a reload of the server
 *
 * Every service is started with the environment of a development machine:
 * the sessions live in the memory of the process, the cookies are not
 * secure and the secrets are the fixtures of this file.
 *
 * The script is the counterpart of `bun run dev` of the four repositories:
 * it is the wiring between them, not a deployment.
 *
 *   bun run dev:stack
 *
 * The environment:
 *
 *   DEV_SHUTTLE_DIR  the checkout of the gateway     (default: ../shuttle)
 *   DEV_HUB_DIR      the checkout of the broker      (default: ../hub)
 *   DEV_DEPOT_DIR    the checkout of the backend     (default: ../depot)
 *   DEV_PG_PORT      the port of PostgreSQL           (default: 5433)
 *   DEV_FRESH        "1" drops the database of a previous run
 */

import { spawn, type Subprocess } from 'bun'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------

/** The root of the studio. */
const BRIDGE_DIR = resolve(import.meta.dir, '..')
/** The directory of the state of the stack. */
const WORK_DIR = join(BRIDGE_DIR, '.dev')

/** The checkout of the gateway. */
const SHUTTLE_DIR = resolve(process.env.DEV_SHUTTLE_DIR ?? join(BRIDGE_DIR, '..', 'shuttle'))
/** The checkout of the broker. */
const HUB_DIR = resolve(process.env.DEV_HUB_DIR ?? join(BRIDGE_DIR, '..', 'hub'))
/** The checkout of the backend. */
const DEPOT_DIR = resolve(process.env.DEV_DEPOT_DIR ?? join(BRIDGE_DIR, '..', 'depot'))

/** The ports of the stack. */
const PORTS = {
  postgres: Number(process.env.DEV_PG_PORT ?? 5433),
  idp: 5556,
  shuttle: 8080,
  bridge: 8081,
  hub: 8082,
  depot: 8083,
} as const

/** The urls of the stack. */
const URLS = {
  shuttle: `http://localhost:${PORTS.shuttle}`,
  bridge: `http://localhost:${PORTS.bridge}`,
  hub: `http://localhost:${PORTS.hub}`,
  depot: `http://localhost:${PORTS.depot}`,
  idp: `http://localhost:${PORTS.idp}`,
} as const

// ---------------------------------------------------------------------------
// The fixtures of the development machine
// ---------------------------------------------------------------------------

/** The secret of the sessions of the gateway. */
const SESSION_SECRET = 'dev-session-secret-of-the-development-machine-01'
/** The token of the administration of the broker. */
const HUB_ADMIN_TOKEN = 'dev-admin-token-of-the-development-machine-0001'
/** The token the gateway presents to the broker. */
const HUB_ACCESS_TOKEN = 'dev-access-token-of-the-development-machine-001'
/** The read only credential of the access context contract. */
const HUB_CONTEXT_TOKEN = 'dev-context-token-of-the-development-machine-001'
/** The client of the gateway and of the studio at the broker. */
const HUB_CLIENT_ID = 'dev-client'
const HUB_CLIENT_SECRET = 'dev-client-secret-of-the-development-machine'
/** The tenant of the development machine. */
const TENANT_SLUG = 'dev'
/** The workspace of the development machine. */
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
/** The route of the gateway that reaches the backend. */
const ROUTE_ID = 'data-api'
/** The route of the worker of the backend. */
const WORKER_ROUTE_ID = 'data-worker'
/** The account of the fixture of the identity provider. */
const USER_SUBJECT = 'user-alice'
const USER_EMAIL = 'alice@shuttle.test'
const USER_PASSWORD = 'alice-password'
/** The client of the broker at the fixture of the identity provider. */
const IDP_CLIENT_ID = 'hub-idp'
const IDP_CLIENT_SECRET = 'hub-idp-secret-of-the-development-machine'

/** The roles of the database of the backend. */
const ROLE_PASSWORDS: Record<string, string> = {
  data_owner: 'dev-owner-password-0001',
  data_runtime: 'dev-runtime-password-0001',
  data_registry: 'dev-registry-password-0001',
  data_delivery: 'dev-delivery-password-0001',
  data_maintenance: 'dev-maintenance-password-0001',
}

// ---------------------------------------------------------------------------
// The helpers
// ---------------------------------------------------------------------------

/** The processes of the stack. */
const children: Subprocess[] = []
/** The services of the stack that run in this process. */
const stoppers: (() => void | Promise<void>)[] = []
/** The server of the database. */
let stopPostgres: (() => void) | undefined

/** A stream of bytes that can be read with `for await`. */
type ByteStream = ReadableStream<Uint8Array> & {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>
}

/** The client of the database of the development machine. */
interface DatabaseClient {
  connect(): Promise<void>
  query(sql: string, values?: unknown[]): Promise<{ rowCount: number | null }>
  end(): Promise<void>
}

/** The reports a step of the stack. */
function step(message: string): void {
  console.log(`[36m▸[0m ${message}`)
}

/** Reports a failure of the stack. */
function fail(message: string): never {
  console.error(`[31m✗[0m ${message}`)
  process.exit(1)
}

/** Waits for an endpoint to answer. */
async function waitFor(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // The service is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`the service at ${url} did not answer`)
}

/** Reports that a port of the stack is already taken. */
async function checkPort(port: number, name: string): Promise<void> {
  const free = await new Promise<boolean>((done) => {
    const server = createServer()
    server.once('error', () => done(false))
    server.once('listening', () => server.close(() => done(true)))
    server.listen(port, '127.0.0.1')
  })
  if (!free) {
    fail(`the port ${port} of ${name} is already taken: stop the service that holds it`)
  }
}

/** Starts a service of the stack and streams its logs. */
function start(
  name: string,
  command: string[],
  options: { cwd: string; env?: Record<string, string> }
): Subprocess {
  const child = spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const prefix = `[90m${name.padEnd(7)}[0m │ `
  const pipe = (stream: ReadableStream<Uint8Array> | undefined): void => {
    if (!stream) return
    void (async () => {
      const decoder = new TextDecoder()
      for await (const chunk of stream as ByteStream) {
        for (const line of decoder.decode(chunk).split('\n')) {
          if (line.trim().length === 0) continue
          console.log(`${prefix}${line}`)
        }
      }
    })()
  }
  pipe(child.stdout as ReadableStream<Uint8Array>)
  pipe(child.stderr as ReadableStream<Uint8Array>)
  child.exited.then((code) => {
    if (code !== 0 && code !== null) {
      console.error(`[31m${name} stopped with the code ${code}[0m`)
    }
  })
  children.push(child)
  return child
}

/** Runs a command of a repository and waits for it. */
async function run(cwd: string, command: string[], env: Record<string, string>): Promise<void> {
  const child = spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const logs: string[] = []
  const collect = (stream: ReadableStream<Uint8Array> | undefined): void => {
    if (!stream) return
    void (async () => {
      const decoder = new TextDecoder()
      for await (const chunk of stream as ByteStream) {
        for (const line of decoder.decode(chunk).split('\n')) {
          if (line.trim().length === 0) continue
          logs.push(line)
        }
      }
    })()
  }
  collect(child.stdout as ReadableStream<Uint8Array>)
  collect(child.stderr as ReadableStream<Uint8Array>)
  const code = await child.exited
  if (code !== 0) {
    throw new Error(`the command "${command.join(' ')}" failed: ${logs.slice(-20).join('\n')}`)
  }
}

/** Calls the administration of the broker. */
async function admin(
  path: string,
  body: unknown,
  method = 'POST'
): Promise<Record<string, unknown>> {
  const response = await fetch(`${URLS.hub}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${HUB_ADMIN_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`the administration of the broker failed at ${path}: ${text}`)
  }
  return (text.length > 0 ? JSON.parse(text) : {}) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  for (const [name, directory] of [
    ['shuttle', SHUTTLE_DIR],
    ['hub', HUB_DIR],
    ['depot', DEPOT_DIR],
  ] as const) {
    if (!existsSync(join(directory, 'package.json'))) {
      fail(
        `the checkout of ${name} was not found at ${directory}: set DEV_${name.toUpperCase()}_DIR`
      )
    }
    if (!existsSync(join(directory, 'node_modules'))) {
      fail(`the dependencies of ${name} are not installed: run "bun install" in ${directory}`)
    }
  }
  mkdirSync(WORK_DIR, { recursive: true })

  // 0. The ports of the stack.
  for (const [port, name] of [
    [PORTS.postgres, 'the database'],
    [PORTS.idp, 'the identity provider'],
    [PORTS.shuttle, 'the gateway'],
    [PORTS.hub, 'the broker'],
    [PORTS.depot, 'the backend'],
    [PORTS.bridge, 'the studio'],
  ] as const) {
    await checkPort(port, name)
  }

  // 1. The database.
  step('the database')
  const { startPostgres } = await import(
    pathToFileURL(join(DEPOT_DIR, 'scripts', 'postgres.ts')).href
  )
  const postgres = await startPostgres({
    dataDir: join(WORK_DIR, 'pg'),
    port: PORTS.postgres,
    user: 'depot',
    password: 'depot',
    fresh: process.env.DEV_FRESH === '1',
  })
  stopPostgres = postgres.stop
  const socketDirectory = join(WORK_DIR, 'socket')
  const socketUrl = `postgres://depot@localhost/postgres?host=${encodeURIComponent(socketDirectory)}&port=${postgres.port}`

  const pgModule = (await import(
    pathToFileURL(join(DEPOT_DIR, 'node_modules', 'pg', 'lib', 'index.js')).href
  )) as { default?: { Client: new (config: { connectionString: string }) => DatabaseClient } }
  const pg =
    pgModule.default ??
    (pgModule as unknown as {
      Client: new (config: { connectionString: string }) => DatabaseClient
    })
  const admin_ = new pg.Client({ connectionString: socketUrl })
  await admin_.connect()
  await admin_.query("alter role depot with password 'depot'")
  for (const [role, password] of Object.entries(ROLE_PASSWORDS)) {
    await admin_.query(
      `do $$ begin
         if not exists (select from pg_roles where rolname = '${role}') then
           create role ${role} with login password '${password}';
         end if;
       end $$`
    )
  }
  for (const [database, owner] of [
    ['depot', 'data_owner'],
    ['hub', 'depot'],
  ]) {
    const existing = await admin_.query('select 1 from pg_database where datname = $1', [database])
    if (existing.rowCount === 0) {
      await admin_.query(`create database ${database} owner ${owner}`)
    }
  }
  await admin_.end()
  const base = `postgres://depot:depot@127.0.0.1:${postgres.port}`
  const ownerUrl = `postgres://data_owner:${ROLE_PASSWORDS.data_owner}@127.0.0.1:${postgres.port}/depot`
  const runtimeUrl = `postgres://data_runtime:${ROLE_PASSWORDS.data_runtime}@127.0.0.1:${postgres.port}/depot`
  const registryUrl = `postgres://data_registry:${ROLE_PASSWORDS.data_registry}@127.0.0.1:${postgres.port}/depot`
  const deliveryUrl = `postgres://data_delivery:${ROLE_PASSWORDS.data_delivery}@127.0.0.1:${postgres.port}/depot`
  const hubUrl = `${base}/hub`
  step(`the database listens on ${base.replace('postgres://depot:depot', 'postgres://…')}`)

  // 2. The migrations of the backend.
  step('the migrations of the backend')
  await run(DEPOT_DIR, ['bun', 'run', 'scripts/migrate.ts'], { DATA_OWNER_DATABASE_URL: ownerUrl })

  // 3. The fixture of the identity provider of the tenant.
  step('the identity provider of the tenant')
  const { startOidcProvider } = await import(
    pathToFileURL(join(SHUTTLE_DIR, 'services', 'oidc-provider.ts')).href
  )
  const idp = await startOidcProvider({
    port: PORTS.idp,
    issuer: URLS.idp,
    clientId: IDP_CLIENT_ID,
    clientSecret: IDP_CLIENT_SECRET,
    redirectUris: [`${URLS.hub}/oauth/tenant/callback`],
  })
  stoppers.push(() => idp.stop())

  // 4. The broker.
  step('the broker (Hub)')
  // The broker signs its tokens with a private key of its own. A
  // development machine holds one in the directory of the stack: the same
  // key on every run, so the tokens of a previous run stay valid.
  const signingKeyFile = join(WORK_DIR, 'hub-signing-key.pem')
  if (!existsSync(signingKeyFile)) {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    writeFileSync(signingKeyFile, privateKey)
  }
  start('hub', ['bun', 'run', 'src/main.ts'], {
    cwd: HUB_DIR,
    env: {
      HUB_ENVIRONMENT: 'development',
      HUB_HOST: '127.0.0.1',
      HUB_PORT: String(PORTS.hub),
      HUB_ISSUER: URLS.hub,
      HUB_PUBLIC_URL: URLS.hub,
      HUB_DATABASE_URL: hubUrl,
      HUB_ALLOW_MEMORY_STATE: 'true',
      HUB_ADMIN_TOKEN,
      HUB_ACCESS_TOKEN,
      HUB_ACCESS_CONTEXT_TOKENS: JSON.stringify({ [HUB_CONTEXT_TOKEN]: null }),
      HUB_STATE_SECRET: '0'.repeat(64),
      HUB_SIGNING_KEY: readFileSync(signingKeyFile, 'utf8'),
      HUB_SIGNING_KID: 'dev-1',
      HUB_SECRET_ENCRYPTION_KEY: '1'.repeat(64),
      HUB_LOG_LEVEL: 'info',
    },
  })
  await waitFor(`${URLS.hub}/healthz`)

  // 5. The fixtures of the broker: the tenant, the principal and the grants.
  step('the fixtures of the broker')
  const tenant = await admin('/v1/admin/tenants', {
    slug: TENANT_SLUG,
    displayName: 'Development',
    issuer: idp.issuer,
    idpClientId: idp.clientId,
    idpClientSecret: idp.clientSecret,
    idpRedirectUri: `${URLS.hub}/oauth/tenant/callback`,
    emailDomain: 'shuttle.test',
    clientId: HUB_CLIENT_ID,
    clientSecret: HUB_CLIENT_SECRET,
    clientRedirectUris: [`${URLS.shuttle}/auth/callback`, `${URLS.bridge}/auth/callback`],
    default: true,
    enabled: true,
  })
  const tenantId = String(tenant.id ?? '')
  if (!tenantId)
    fail('the administration of the broker did not answer the identifier of the tenant')

  const principal = await admin('/v1/admin/users', {
    tenant: TENANT_SLUG,
    externalSubject: USER_SUBJECT,
    email: USER_EMAIL,
  })
  const principalId = String(principal.id ?? '')
  if (!principalId)
    fail('the administration of the broker did not answer the identifier of the principal')

  await admin('/v1/admin/groups', {
    tenant: TENANT_SLUG,
    key: 'editors',
    displayName: 'Editors',
    members: [USER_SUBJECT],
  })
  for (const permission of ['content.reader', 'content.editor', 'data.audit.read']) {
    await admin(
      '/v1/admin/grants',
      {
        tenant: TENANT_SLUG,
        userId: principalId,
        permission,
        workspaceId: WORKSPACE_ID,
        routeId: ROUTE_ID,
      },
      'PUT'
    )
  }
  await admin(
    '/v1/admin/grants',
    {
      tenant: TENANT_SLUG,
      userId: principalId,
      permission: 'content.reader',
      workspaceId: WORKSPACE_ID,
      routeId: WORKER_ROUTE_ID,
    },
    'PUT'
  )

  // 6. The registry of the backend: the workspace and its collections.
  step('the workspace of the backend')
  await run(
    DEPOT_DIR,
    [
      'bun',
      'run',
      'scripts/workspace.ts',
      '--',
      'create',
      '--id',
      WORKSPACE_ID,
      '--tenant',
      tenantId,
      '--slug',
      'acme',
      '--name',
      'Acme',
    ],
    { DATA_OWNER_DATABASE_URL: ownerUrl }
  )
  for (const collection of ['articles', 'categories']) {
    await run(
      DEPOT_DIR,
      [
        'bun',
        'run',
        'scripts/collection.ts',
        '--',
        'register',
        '--workspace',
        WORKSPACE_ID,
        '--collection',
        collection,
      ],
      { DATA_OWNER_DATABASE_URL: ownerUrl }
    )
  }

  // 7. The backend.
  step('the backend (Depot)')
  const identityKey = createHmac('sha256', SESSION_SECRET)
    .update('shuttle-identity-signature-v1')
    .digest()
  const identityKeyBase64 = identityKey.toString('base64')
  const identityKeyFile = join(WORK_DIR, 'identity.key')
  writeFileSync(identityKeyFile, identityKeyBase64)
  const cursorKeyFile = join(WORK_DIR, 'cursor.key')
  writeFileSync(cursorKeyFile, 'the-cursor-key-of-the-development-machine-0001')
  const contextTokenFile = join(WORK_DIR, 'hub-context.token')
  writeFileSync(contextTokenFile, HUB_CONTEXT_TOKEN)
  const bindingsFile = join(WORK_DIR, 'bindings.json')
  writeFileSync(
    bindingsFile,
    JSON.stringify(
      {
        version: 1,
        bindings: [
          {
            id: ROUTE_ID,
            host: `localhost:${PORTS.shuttle}`,
            upstreamPathPattern: '/ws/{workspaceId}/v1/*',
            routeId: ROUTE_ID,
            identityKeyFile,
          },
        ],
      },
      null,
      2
    )
  )
  start('depot', ['bun', 'run', 'src/main.ts'], {
    cwd: DEPOT_DIR,
    env: {
      DATA_ENVIRONMENT: 'development',
      DATA_HOST: '127.0.0.1',
      DATA_PORT: String(PORTS.depot),
      DATA_PROCESS_ROLE: 'all',
      DATA_LOG_LEVEL: 'info',
      DATA_DATABASE_URL: runtimeUrl,
      DATA_REGISTRY_DATABASE_URL: registryUrl,
      DATA_DELIVERY_DATABASE_URL: deliveryUrl,
      DATA_ADMIN_DATABASE_URL: `${base}/postgres`,
      DATA_OWNER_DATABASE_URL: ownerUrl,
      DATA_SHUTTLE_BINDINGS_FILE: bindingsFile,
      DATA_SCHEMA_BUNDLE_FILE: join(DEPOT_DIR, 'manifests', 'schema.json'),
      DATA_POLICY_BUNDLE_FILE: join(DEPOT_DIR, 'manifests', 'policies.json'),
      DATA_HUB_URL: URLS.hub,
      DATA_HUB_CONTEXT_TOKEN_FILE: contextTokenFile,
      DATA_CURSOR_KEY_FILE: cursorKeyFile,
      DATA_WORKER_PRINCIPAL_ID: principalId,
      DATA_WORKER_ROUTE_ID: WORKER_ROUTE_ID,
    },
  })
  await waitFor(`${URLS.depot}/readyz`)

  // 8. The gateway.
  step('the gateway (Shuttle)')
  const routesFile = join(WORK_DIR, 'routes.json')
  writeFileSync(
    routesFile,
    JSON.stringify(
      {
        version: 1,
        defaults: { auth: { mode: 'none' }, forwardAuthorization: false },
        trustedProxies: ['127.0.0.1/32', '::1/128'],
        routes: [
          {
            id: ROUTE_ID,
            match: { host: 'localhost', path: '/ws/{workspaceId}/' },
            upstream: URLS.depot,
            auth: { mode: 'any', workspace: { param: 'workspaceId', requireUuid: true } },
            forwardAuthorization: false,
          },
        ],
      },
      null,
      2
    )
  )
  start('shuttle', ['bun', 'run', 'src/main.ts'], {
    cwd: SHUTTLE_DIR,
    env: {
      SHUTTLE_CONFIG: routesFile,
      SHUTTLE_GATEWAY_HOST: '127.0.0.1',
      SHUTTLE_GATEWAY_PORT: String(PORTS.shuttle),
      SHUTTLE_OIDC_ISSUER: URLS.hub,
      SHUTTLE_OIDC_CLIENT_ID: HUB_CLIENT_ID,
      SHUTTLE_OIDC_CLIENT_SECRET: HUB_CLIENT_SECRET,
      SHUTTLE_OIDC_REDIRECT_URI: `${URLS.shuttle}/auth/callback`,
      SHUTTLE_OIDC_SCOPES: 'openid,profile,email,groups',
      SHUTTLE_OIDC_ALLOW_INSECURE: 'true',
      SHUTTLE_ACCESS_URL: URLS.hub,
      SHUTTLE_ACCESS_TOKEN: HUB_ACCESS_TOKEN,
      SHUTTLE_SESSION_SECRET: SESSION_SECRET,
      SHUTTLE_SESSION_URL: 'memory://local',
      SHUTTLE_ALLOW_MEMORY_STATE: 'true',
      SHUTTLE_COOKIE_SECURE: 'false',
      SHUTTLE_EXTERNAL_PROTO: 'http',
      SHUTTLE_LOG_LEVEL: 'info',
      SHUTTLE_TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
    },
  })
  await waitFor(`${URLS.shuttle}/healthz`)

  // 9. The studio.
  step('the studio (Bridge)')
  await run(BRIDGE_DIR, ['bun', 'run', 'scripts/build.ts'], {})
  start('bridge', ['bun', '--watch', 'src/main.ts'], {
    cwd: BRIDGE_DIR,
    env: {
      NODE_ENV: 'development',
      BRIDGE_HOST: '0.0.0.0',
      BRIDGE_PORT: String(PORTS.bridge),
      BRIDGE_PUBLIC_URL: URLS.bridge,
      BRIDGE_GATEWAY_URL: URLS.shuttle,
      BRIDGE_HUB_URL: URLS.hub,
      BRIDGE_HUB_CLIENT_ID: HUB_CLIENT_ID,
      BRIDGE_HUB_CLIENT_SECRET: HUB_CLIENT_SECRET,
      BRIDGE_HUB_SCOPE: 'openid profile email groups',
      BRIDGE_WORKSPACES: WORKSPACE_ID,
      BRIDGE_SECURE_COOKIES: 'false',
      // The studio answers the browser directly on this port, so the
      // request does not carry the signature of the gateway. The
      // signature is verified by the backend, on the route of the data,
      // where it matters: the studio is a client of the gateway.
      BRIDGE_REQUIRE_GATEWAY_IDENTITY: 'false',
      BRIDGE_BIND_GATEWAY_WORKSPACE: 'false',
      BRIDGE_PROBES: 'true',
    },
  })
  await waitFor(`${URLS.bridge}/healthz`)

  console.log('')
  console.log('  The platform is up')
  console.log('  ─────────────────────────────────────────────')
  console.log(`  studio        ${URLS.bridge}/w/${WORKSPACE_ID}/`)
  console.log(`  gateway       ${URLS.shuttle}`)
  console.log(`  broker        ${URLS.hub}`)
  console.log(`  backend       ${URLS.depot}`)
  console.log(`  identity      ${URLS.idp}`)
  console.log('')
  console.log(`  sign in with  ${USER_EMAIL} / ${USER_PASSWORD}`)
  console.log(`  workspace     ${WORKSPACE_ID}`)
  console.log('')
}

/** Stops the stack. */
async function stop(): Promise<void> {
  for (const child of children.reverse()) {
    try {
      child.kill()
    } catch {
      // The process is already gone.
    }
  }
  for (const stopper of stoppers.reverse()) {
    try {
      await stopper()
    } catch {
      // The service is already gone.
    }
  }
  stopPostgres?.()
  process.exit(0)
}

process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())

main().catch(async (error: unknown) => {
  console.error(
    `[31m✗[0m the stack could not be started: ${error instanceof Error ? error.message : String(error)}`
  )
  await stop()
})
