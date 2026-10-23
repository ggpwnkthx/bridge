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
 *   DEV_IDP_PORT     the port of the identity provider (default: 5556)
 *   DEV_SHUTTLE_PORT the port of the gateway          (default: 8080)
 *   DEV_BRIDGE_PORT  the port of the studio           (default: 8081)
 *   DEV_HUB_PORT     the port of the broker           (default: 8082)
 *   DEV_DEPOT_PORT   the port of the backend          (default: 8083)
 *   DEV_WORK_DIR     the directory of the state of the run (default: .dev)
 *   DEV_PG_DIR       the directory of the data of PostgreSQL
 *                    (default: the work directory of the run)
 *   DEV_FRESH        "1" drops the database of a previous run
 */

import { spawn, type Subprocess } from 'bun'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'
import {
  alive,
  ancestry,
  commandOf,
  cwdOf,
  listeners,
  ProcessRegistry,
  runners,
  signal,
  tree,
} from './dev-processes'
import { exitCodeOf } from './spawn'
import { drift, type Migrations, readMigrations } from './dev-schema'
import { install, type Checkout, pending } from './dev-dependencies'
import {
  type Binaries,
  directories as postgresDirectories,
  find as findPostgres,
  install as installPostgres,
  isKnown as isKnownMajor,
} from './dev-postgres'

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------

/** The root of the studio. */
const BRIDGE_DIR = resolve(import.meta.dir, '..')
/** The directory of the state of the stack. */
const WORK_DIR = resolve(process.env.DEV_WORK_DIR ?? join(BRIDGE_DIR, '.dev'))
/** The directory of the registry of the processes of the runs of the stack. */
const PROCESS_DIR = join(WORK_DIR, 'processes')
/** The directory of the data of the database of the stack. */
const PG_DIR = resolve(process.env.DEV_PG_DIR ?? join(WORK_DIR, 'pg'))

/** The checkout of the gateway. */
const SHUTTLE_DIR = resolve(process.env.DEV_SHUTTLE_DIR ?? join(BRIDGE_DIR, '..', 'shuttle'))
/** The checkout of the broker. */
const HUB_DIR = resolve(process.env.DEV_HUB_DIR ?? join(BRIDGE_DIR, '..', 'hub'))
/** The checkout of the backend. */
const DEPOT_DIR = resolve(process.env.DEV_DEPOT_DIR ?? join(BRIDGE_DIR, '..', 'depot'))

/** The checkouts of the repositories of the stack. */
const CHECKOUTS: readonly Checkout[] = [
  { name: 'shuttle', directory: SHUTTLE_DIR },
  { name: 'hub', directory: HUB_DIR },
  { name: 'depot', directory: DEPOT_DIR },
]

/** The ports of the stack. */
const PORTS = {
  postgres: Number(process.env.DEV_PG_PORT ?? 5433),
  idp: Number(process.env.DEV_IDP_PORT ?? 5556),
  shuttle: Number(process.env.DEV_SHUTTLE_PORT ?? 8080),
  bridge: Number(process.env.DEV_BRIDGE_PORT ?? 8081),
  hub: Number(process.env.DEV_HUB_PORT ?? 8082),
  depot: Number(process.env.DEV_DEPOT_PORT ?? 8083),
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

/** The registry of the processes of the runs of the stack. */
const registry = new ProcessRegistry(PROCESS_DIR)

/** A stream of bytes that can be read with `for await`. */
type ByteStream = ReadableStream<Uint8Array> & {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>
}

/** The client of the database of the development machine. */
interface DatabaseClient {
  connect(): Promise<void>
  query(sql: string, values?: unknown[]): Promise<{ rowCount: number | null; rows?: unknown[] }>
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

/** Waits for a moment. */
async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Waits for a condition to hold, and tells whether it held in time. */
async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return condition()
}

/**
 * Kills the processes of the runs of the stack that came before this one.
 *
 * A run that is still alive is asked to leave, the way a stack is
 * stopped with a signal: it kills its own services. The processes that
 * outlive it — a service that ignored the signal, the database of a run
 * that was killed — are killed here.
 */
async function stopPreviousRun(): Promise<void> {
  const previous = registry.foreign()
  // The runs of the stack that are alive without a registry behind them:
  // a run that started before the registry, or one whose registry was
  // erased, is stopped here too. The ancestors of this run are not
  // runs of the machine: the shell that started it, and the `bun run`
  // that started it, are never killed.
  const ancestors = ancestry(process.pid)
  const orphans = runners('dev-stack.ts', BRIDGE_DIR).filter(
    (pid) => pid !== process.pid && !ancestors.includes(pid)
  )
  if (previous.length === 0 && orphans.length === 0) {
    step('no previous run of the stack')
    return
  }
  step('the previous run of the stack is stopped')

  const masters = [
    ...previous.filter((entry) => entry.role === 'stack').map((entry) => entry.pid),
    ...orphans,
  ]
  for (const master of masters) signal([master], 'SIGTERM')
  if (masters.length > 0) {
    await until(() => masters.every((master) => !alive(master)), 5_000)
    for (const master of masters) {
      if (alive(master)) signal([master], 'SIGKILL')
    }
  }

  const services = previous.filter((entry) => entry.role !== 'stack' && alive(entry.pid))
  if (services.length > 0) {
    signal(tree(services.map((entry) => entry.pid)), 'SIGTERM')
    await until(() => services.every((entry) => !alive(entry.pid)), 3_000)
    const survivors = services.filter((entry) => alive(entry.pid))
    if (survivors.length > 0) signal(tree(survivors.map((entry) => entry.pid)), 'SIGKILL')
  }
}

/**
 * Stops the database of a previous run.
 *
 * The server of PostgreSQL is started by `pg_ctl`: it leaves the process
 * group of the runner, so it survives the death of the run that started
 * it and holds the port and the data directory of the stack.
 */
async function stopPreviousDatabase(): Promise<void> {
  if (!existsSync(join(PG_DIR, 'PG_VERSION'))) return
  const { binaries } = (await import(
    pathToFileURL(join(DEPOT_DIR, 'scripts', 'postgres.ts')).href
  )) as { binaries: () => string }
  const result = spawnSync(join(binaries(), 'pg_ctl'), ['-D', PG_DIR, '-m', 'fast', 'stop'], {
    encoding: 'utf8',
  })
  const report = `${result.stdout}${result.stderr}`
  if (exitCodeOf(result) !== 0 && !/is server running/i.test(report)) {
    step(`the database of the previous run is left as it is: ${result.stderr.trim()}`)
  }
}

/** Tells whether a port is free. */
async function isFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((done) => {
    const server = createServer()
    server.once('error', () => done(false))
    server.once('listening', () => server.close(() => done(true)))
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Tells whether a process is a service of the stack.
 *
 * A service of the stack works in the checkout of one of the four
 * repositories, or it is the database of the stack, in the directory of
 * its data. A process that holds the port of the stack and is none of
 * them belongs to somebody else: it is not killed.
 */
function isServiceOfStack(pid: number): boolean {
  const command = commandOf(pid) ?? ''
  if (command.includes(PG_DIR)) return true
  const directory = cwdOf(pid)
  if (!directory) return false
  const checkouts = [BRIDGE_DIR, HUB_DIR, DEPOT_DIR, SHUTTLE_DIR]
  if (!checkouts.includes(directory)) return false
  return command.includes('src/main.ts') || command.includes('dev-stack.ts')
}

/** Reports that a port of the stack is already taken. */
async function checkPort(port: number, name: string): Promise<void> {
  if (await isFree(port)) return

  // The port is held by a service of a previous run of the stack that
  // did not leave its registry behind: it is stopped here.
  const holders = listeners(port).filter((pid) => isServiceOfStack(pid))
  if (holders.length > 0) {
    step(`the service of a previous run that holds the port ${port} is stopped`)
    signal(tree(holders), 'SIGTERM')
    await until(() => holders.every((pid) => !alive(pid)), 3_000)
    const survivors = holders.filter((pid) => alive(pid))
    if (survivors.length > 0) signal(tree(survivors), 'SIGKILL')
    await delay(300)
    if (await isFree(port)) return
  }

  fail(`the port ${port} of ${name} is already taken: stop the service that holds it`)
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
  registry.register(child.pid, name)
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

// ---------------------------------------------------------------------------
// The schema of the databases of a previous run
// ---------------------------------------------------------------------------

/** The constructor of the clients of the database of the stack. */
let clientOf: ((connectionString: string) => DatabaseClient) | undefined

/** The url of the database of the stack, without the name of the database. */
let DATABASE_URL = ''

/** The url of the cluster of the database of the stack. */
let SOCKET_URL = ''

/** The directory of the migrations of the schema of the broker. */
const HUB_MIGRATIONS_DIR = join(HUB_DIR, 'src', 'platform', 'postgres', 'migrations')

/** The directory of the migrations of the schema of the backend. */
const DEPOT_MIGRATIONS_DIR = resolve(DEPOT_DIR, process.env.DATA_MIGRATIONS_DIR ?? 'migrations')

/**
 * The migrations that the database of a service holds and that its
 * checkout does not know, or knows with another content.
 *
 * A migration that was renamed after it was applied leaves the database
 * with a migration that the service does not know: the service refuses
 * to start, because it does not know what it would find in the tables.
 * A migration that was changed after it was applied is a drift of the
 * same kind.
 */
async function driftOf(options: {
  /** The database of the service. */
  database: string
  /** The table that holds the migrations that were applied. */
  table: string
  /** The column that holds the name of the migration. */
  column: string
  /** The column that holds the digest of the migration, when there is one. */
  digest?: string
  /** The migrations of the checkout of the service. */
  known: Migrations
}): Promise<string[]> {
  if (!clientOf) return []
  const client = clientOf(`${DATABASE_URL}/${options.database}`)
  try {
    await client.connect()
    const table = await client.query(`select to_regclass($1) as table`, [options.table])
    if (!table.rows?.[0] || (table.rows[0] as { table: string | null }).table === null) return []
    const columns = [options.column, ...(options.digest ? [options.digest] : [])]
    const result = await client.query(
      `select ${columns.join(', ')} from ${options.table} order by ${options.column}`
    )
    const applied: Migrations = new Map()
    for (const row of result.rows ?? []) {
      const record = row as Record<string, unknown>
      applied.set(
        String(record[options.column]),
        options.digest ? (record[options.digest] as string | undefined) : undefined
      )
    }
    return drift(applied, options.known)
  } catch {
    // A database that cannot be read has no drift to repair: the service
    // starts, and it says what it cannot do.
    return []
  } finally {
    await client.end().catch(() => undefined)
  }
}

/**
 * Runs something with a client of the cluster of the database.
 *
 * The client is the owner of the cluster: it creates the databases and
 * it drops them.
 */
async function withAdmin<T>(action: (admin: DatabaseClient) => Promise<T>): Promise<T> {
  if (!clientOf) throw new Error('the database of the stack is not started')
  const admin = clientOf(SOCKET_URL)
  await admin.connect()
  try {
    return await action(admin)
  } finally {
    await admin.end().catch(() => undefined)
  }
}

/**
 * Builds the database of a service again.
 *
 * A development machine holds nothing that a manual repair would save:
 * the database of the service is dropped, and the migrations of the
 * checkout are applied to it by the service itself.
 */
async function rebuildDatabase(database: string, owner: string): Promise<void> {
  await withAdmin(async (admin) => {
    await admin.query(`drop database if exists ${database}`)
    await admin.query(`create database ${database} owner ${owner}`)
  })
}

/**
 * Repairs the drift of the schemas of the databases of a previous run.
 *
 * The schema of a service is the sum of the migrations of its checkout.
 * A migration that was renamed or changed after it was applied leaves
 * the database behind the service, and the service refuses to start
 * against a schema it does not understand. The database of the service
 * is built again, and the migrations of the checkout are applied to it.
 */
async function repairDrift(): Promise<void> {
  const depot = await driftOf({
    database: 'depot',
    table: 'platform.schema_migrations',
    column: 'id',
    digest: 'checksum',
    known: readMigrations(DEPOT_MIGRATIONS_DIR, true),
  })
  const hub = await driftOf({
    database: 'hub',
    table: 'hub_schema_migrations',
    column: 'name',
    known: readMigrations(HUB_MIGRATIONS_DIR, false),
  })
  if (depot.length > 0) {
    step(
      `the schema of the backend drifted: ${depot.join(', ')} — the database of the backend is built again`
    )
    await rebuildDatabase('depot', 'data_owner')
  }
  if (hub.length > 0) {
    step(
      `the schema of the broker drifted: ${hub.join(', ')} — the database of the broker is built again`
    )
    await rebuildDatabase('hub', 'depot')
    // The tenant of the broker is created with the database of the
    // broker, and it has another identifier: the backend, which holds
    // the reference of the tenant, is built again with it.
    step(
      'the database of the backend is built again: it holds the reference of the tenant of the broker'
    )
    await rebuildDatabase('depot', 'data_owner')
  }
}

/**
 * Tells whether the backend holds the workspace of another tenant.
 *
 * The tenant of the broker is created with the database of the broker:
 * when the database of the broker is built again, the tenant has another
 * identifier, and the reference of the tenant in the backend is a
 * reference to a tenant that does not exist. The rows of the workspace
 * keep the reference, and the fixture of the workspace cannot be put
 * again.
 */
async function holdsAnotherTenant(options: {
  /** The database of the backend. */
  database: string
  /** The identifier of the workspace of the development machine. */
  workspace: string
  /** The identifier of the tenant of the broker. */
  tenant: string
}): Promise<boolean> {
  if (!clientOf) return false
  const client = clientOf(`${DATABASE_URL}/${options.database}`)
  try {
    await client.connect()
    const result = await client.query(
      'select tenant_id from platform.workspaces where id = $1::uuid',
      [options.workspace]
    )
    const row = result.rows?.[0] as { tenant_id?: string } | undefined
    if (!row?.tenant_id) return false
    return row.tenant_id !== options.tenant
  } catch {
    // A backend without its registry has no reference to drift.
    return false
  } finally {
    await client.end().catch(() => undefined)
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

/**
 * Checks the binaries of PostgreSQL of the machine.
 *
 * The backend of the platform starts the server of the database with
 * the scripts of its own checkout, and those scripts look for the
 * binaries of PostgreSQL in the directories of the machine. The studio
 * looks for them first: a machine without them cannot run the stack,
 * and the message of the machine says what is missing and how it is
 * installed.
 *
 * A major that the backend of the platform does not know is named with
 * the environment `POSTGRES_MAJOR`: the backend looks for the binaries
 * of the major of the machine.
 *
 * A machine without PostgreSQL gets it: the database of the stack is
 * a dependency of the machine, and the machine installs it when it can
 * do it without asking for a password.
 */
async function checkPostgres(): Promise<Binaries> {
  const binaries = findPostgres()
  if (binaries) {
    if (binaries.major !== null && !isKnownMajor(binaries.major)) {
      process.env.POSTGRES_MAJOR = String(binaries.major)
      step(`the binaries of PostgreSQL ${binaries.major} are at ${binaries.directory}`)
    }
    return binaries
  }
  // The machine has no PostgreSQL: the database of the stack is a
  // dependency of the machine, and the machine installs it when it can
  // do it without asking for a password.
  if (process.env.DEV_SKIP_INSTALL === '1') {
    fail(
      `the binaries of PostgreSQL were not found and the install is skipped: install PostgreSQL 15 or later (on Debian and Ubuntu: sudo apt install postgresql)`
    )
  }
  step('the binaries of PostgreSQL are installed')
  const prefix = '\u001b[90mpostgres\u001b[0m │ '
  const installed = await installPostgres((line) => console.log(`${prefix}${line}`))
  if (!installed) {
    fail(
      `the binaries of PostgreSQL were not found and they could not be installed: the machine needs "initdb" and "pg_ctl" — install PostgreSQL 15 or later (on Debian and Ubuntu: sudo apt install postgresql) — the directories that were looked for: ${postgresDirectories().slice(0, 6).join(', ')}`
    )
  }
  if (installed.major !== null && !isKnownMajor(installed.major)) {
    process.env.POSTGRES_MAJOR = String(installed.major)
  }
  return installed
}

/**
 * Installs the dependencies of the checkouts of the stack.
 *
 * A checkout whose dependencies are not installed cannot run, and the
 * machine installs them: the run of the stack is the moment where the
 * machine is whole. A checkout that has its dependencies is left
 * alone: the install is the work of the developer who changed them.
 *
 * The install is the one of the developer of the checkout — the
 * lockfile of the checkout is read, and it is updated when the
 * manifest of the checkout and its lockfile do not agree. The
 * environment `DEV_SKIP_INSTALL=1` says that the machine does not
 * install anything: a checkout without its dependencies is an error.
 */
async function installDependencies(): Promise<void> {
  const skip = process.env.DEV_SKIP_INSTALL === '1'
  const checkouts: readonly Checkout[] = [
    { name: 'the studio', directory: BRIDGE_DIR },
    ...CHECKOUTS,
  ]
  for (const checkout of checkouts) {
    if (!pending(checkout)) continue
    if (skip) {
      fail(
        `the dependencies of ${checkout.name} are not installed and the install is skipped: run "bun install" in ${checkout.directory}`
      )
    }
    step(`the dependencies of ${checkout.name} are installed`)
    const prefix = `\u001b[90m${checkout.name.padEnd(7)}\u001b[0m │ `
    try {
      await install(checkout, (line) => console.log(`${prefix}${line}`))
    } catch (error) {
      fail(
        `${error instanceof Error ? error.message : String(error)}: run "bun install" in ${checkout.directory}`
      )
    }
    if (pending(checkout)) {
      fail(`the dependencies of ${checkout.name} are still not installed: ${checkout.directory}`)
    }
  }
}

async function main(): Promise<void> {
  for (const checkout of CHECKOUTS) {
    if (!existsSync(join(checkout.directory, 'package.json'))) {
      fail(
        `the checkout of ${checkout.name} was not found at ${checkout.directory}: set DEV_${checkout.name.toUpperCase()}_DIR`
      )
    }
  }
  // 0. The dependencies of the machine.
  await installDependencies()
  mkdirSync(WORK_DIR, { recursive: true })

  // 0.1 The binaries of PostgreSQL of the machine.
  const binaries = await checkPostgres()

  // 0.2 The runs of the stack that came before this one.
  await stopPreviousRun()
  await stopPreviousDatabase()
  registry.register(process.pid, 'stack')

  // 0.3 The ports of the stack.
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
  let postgres: Awaited<ReturnType<typeof startPostgres>>
  try {
    postgres = await startPostgres({
      dataDir: PG_DIR,
      port: PORTS.postgres,
      user: 'depot',
      password: 'depot',
      fresh: process.env.DEV_FRESH === '1',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/binaries/i.test(message)) {
      fail(
        `the backend of the platform did not find the binaries of PostgreSQL: they are at ${binaries.directory} — the backend looks for them in the directories of PostgreSQL of the machine`
      )
    }
    fail(message)
  }
  stopPostgres = postgres.stop
  const postmaster = join(PG_DIR, 'postmaster.pid')
  if (existsSync(postmaster)) {
    const pid = Number(readFileSync(postmaster, 'utf8').split('\n')[0])
    if (Number.isInteger(pid)) registry.register(pid, 'postgres')
  }
  const socketDirectory = join(WORK_DIR, 'socket')
  const socketUrl = `postgres://depot@localhost/postgres?host=${encodeURIComponent(socketDirectory)}&port=${postgres.port}`
  SOCKET_URL = socketUrl

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
  clientOf = (connectionString: string) => new pg.Client({ connectionString })
  DATABASE_URL = `postgres://depot:depot@127.0.0.1:${postgres.port}`
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
  // 1.1 The drift of the schemas of the databases of a previous run.
  await repairDrift()

  await admin_.end()
  const base = DATABASE_URL
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
  if (await holdsAnotherTenant({ database: 'depot', workspace: WORKSPACE_ID, tenant: tenantId })) {
    // The tenant of the broker has another identifier than the one the
    // backend holds: the reference of the tenant in the backend drifted,
    // and the fixture of the workspace cannot be put again.
    step(
      'the reference of the tenant of the broker drifted in the backend — the database of the backend is built again'
    )
    await rebuildDatabase('depot', 'data_owner')
    await run(DEPOT_DIR, ['bun', 'run', 'scripts/migrate.ts'], {
      DATA_OWNER_DATABASE_URL: ownerUrl,
    })
  }
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
  // The gateway signs the identity of a request with the private key of
  // the deployment, and the backend verifies it with the public one. The
  // key of the development machine is in the directory of the stack: it
  // is the same on every run.
  const identityKeyFile = join(WORK_DIR, 'identity-key.pem')
  const identityPublicKeyFile = join(WORK_DIR, 'identity.key')
  // The key of a previous run is kept, so the identity of the machine is
  // the same on every run. A file that does not hold a key of the
  // machine — the derived secret of an earlier release — is replaced.
  const identityKeysAreThere =
    existsSync(identityKeyFile) &&
    existsSync(identityPublicKeyFile) &&
    readFileSync(identityKeyFile, 'utf8').includes('PRIVATE KEY') &&
    readFileSync(identityPublicKeyFile, 'utf8').includes('PUBLIC KEY')
  if (!identityKeysAreThere) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    writeFileSync(identityKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    writeFileSync(
      identityPublicKeyFile,
      publicKey.export({ type: 'spki', format: 'pem' }).toString()
    )
  }
  const identityKey = readFileSync(identityKeyFile, 'utf8')
  const cursorKeyFile = join(WORK_DIR, 'cursor.key')
  writeFileSync(cursorKeyFile, 'the-cursor-key-of-the-development-machine-0001')
  const contextTokenFile = join(WORK_DIR, 'hub-context.token')
  writeFileSync(contextTokenFile, HUB_CONTEXT_TOKEN)
  const bindingsFile = join(WORK_DIR, 'bindings.json')
  writeFileSync(
    bindingsFile,
    JSON.stringify(
      {
        version: 2,
        bindings: [
          {
            id: ROUTE_ID,
            host: `localhost:${PORTS.shuttle}`,
            upstreamPathPattern: '/ws/{workspaceId}/v1/*',
            routeId: ROUTE_ID,
            identity: {
              version: 'v5',
              algorithm: 'ES256',
              publicKeyFile: identityPublicKeyFile,
            },
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
      // The gateway signs the identity of the requests it forwards with
      // the private key of the machine; the backend verifies it with the
      // public one, in the file of the bindings.
      SHUTTLE_IDENTITY_SIGNING_KEY: identityKey,
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
  console.log(`  studio        ${URLS.bridge}/w/${WORKSPACE_ID}`)
  console.log(`  gateway       ${URLS.shuttle}`)
  console.log(`  broker        ${URLS.hub}`)
  console.log(`  backend       ${URLS.depot}`)
  console.log(`  identity      ${URLS.idp}`)
  console.log('')
  console.log(`  sign in with  ${USER_EMAIL} / ${USER_PASSWORD}`)
  console.log(`  workspace     ${WORKSPACE_ID}`)
  console.log('')
}

/** Tells whether the stack is already stopping. */
let stopping = false

/** Stops the stack. */
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  const pids = children.map((child) => child.pid)
  // The tree is taken before the first kill: a watcher that dies
  // leaves its child behind, and the child would be lost.
  const descendants = tree(pids)
  for (const child of children.reverse()) {
    try {
      child.kill()
    } catch {
      // The process is already gone.
    }
  }
  // The services that watch their sources hold a child of their own.
  signal(descendants, 'SIGTERM')
  await until(() => pids.every((pid) => !alive(pid)), 3_000)
  const survivors = descendants.filter((pid) => alive(pid))
  if (survivors.length > 0) signal(tree(survivors), 'SIGKILL')
  for (const stopper of stoppers.reverse()) {
    try {
      await stopper()
    } catch {
      // The service is already gone.
    }
  }
  stopPostgres?.()
  registry.release()
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
