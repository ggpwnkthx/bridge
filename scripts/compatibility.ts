#!/usr/bin/env bun
/**
 * The compatibility harness of the studio (spec §16).
 *
 * The harness runs the **real** gateway, the **real** broker and the
 * **real** backend of the platform, at the revisions of the manifest
 * `compatibility.json`, and it drives the **real** studio against them:
 * the login of a caller, the catalog of a workspace, a collection and a
 * write.
 *
 * The revisions are the ones of the manifest, the one file of this
 * repository that owns the repositories of the platform and the
 * revisions that are tested against them. The gateway, the broker and
 * the backend are cloned at those revisions and they are never
 * modified.
 *
 * The command:
 *
 *   bun run test:compat
 *
 * The environment:
 *
 *   SHUTTLE_REPOSITORY  the repository of the gateway: a git url or the
 *                       path of a local repository (default: the url of
 *                       the manifest)
 *   HUB_REPOSITORY      the repository of the broker (default: the url
 *                       of the manifest)
 *   DEPOT_REPOSITORY    the repository of the backend (default: the url
 *                       of the manifest)
 *   SHUTTLE_COMMIT      the revision of the gateway (default: the
 *                       revision of the manifest)
 *   HUB_COMMIT          the revision of the broker (default: the
 *                       revision of the manifest)
 *   DEPOT_COMMIT        the revision of the backend (default: the
 *                       revision of the manifest)
 *   COMPAT_MIRROR       a directory that holds the bare mirrors
 *                       `shuttle.git`, `hub.git` and `depot.git`
 *   COMPAT_WORKSPACE    the directory the checkouts are created in (a
 *                       temporary directory by default)
 *   COMPAT_KEEP         when it is set, the temporary directory is kept
 *
 * The order of the sources is the one of the list: an explicit
 * repository wins over a mirror, and a mirror wins over the url of the
 * manifest. An override that is set and that cannot be used is an
 * error: the harness never falls back to another source. A run with an
 * override is a run of a candidate, and it is not the proof of the
 * baseline of the manifest.
 */

import { spawn, spawnSync, type Subprocess } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  readCompatibilityManifest,
  selectBaseline,
  type BaselineSelection,
  type RepositoryName,
} from './compatibility-manifest'
import { assertCleanCheckout, cloneAtRevision, sourceOf } from './compatibility-git'
import { install } from './dev-dependencies'
import { exitCodeOf } from './spawn'

/** The root of the studio. */
const BRIDGE_DIR = resolve(import.meta.dir, '..')

/** The directory of the mirrors of the deployment. */
const COMPAT_MIRROR = process.env.COMPAT_MIRROR ?? ''

/** The ports of the run. They are the ports of a run of its own. */
const PORTS = {
  postgres: Number(process.env.COMPAT_PG_PORT ?? 5434),
  idp: Number(process.env.COMPAT_IDP_PORT ?? 5557),
  shuttle: Number(process.env.COMPAT_SHUTTLE_PORT ?? 8180),
  bridge: Number(process.env.COMPAT_BRIDGE_PORT ?? 8181),
  hub: Number(process.env.COMPAT_HUB_PORT ?? 8182),
  depot: Number(process.env.COMPAT_DEPOT_PORT ?? 8183),
} as const

/** The url of the studio of the run. */
const BRIDGE_URL = `http://localhost:${PORTS.bridge}`

/** The steps of the harness. */
const steps: string[] = []

/** Reports a step. */
function step(message: string): void {
  steps.push(message)
  console.log(`▸ ${message}`)
}

/** Fails the harness. */
function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** Waits for an endpoint to answer. */
async function waitFor(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // The service is not up yet.
    }
    await new Promise((done) => setTimeout(done, 200))
  }
  throw new Error(`the service at ${url} did not answer`)
}

/**
 * Prepares the checkout of a repository of the baseline.
 *
 * A checkout that is already prepared — a directory of the environment
 * — is used as it is, and it is checked before the run: its head has to
 * be the revision of the baseline and its tracked files have to be the
 * ones of the revision.
 */
async function prepare(
  name: RepositoryName,
  source: string,
  commit: string,
  workspace: string
): Promise<string> {
  const prepared = process.env[`${name.toUpperCase()}_CHECKOUT`]
  if (prepared) {
    const head = spawnSync(['git', 'rev-parse', 'HEAD'], {
      cwd: prepared,
    })
    const revision = head.stdout?.toString().trim() ?? ''
    if (exitCodeOf(head) !== 0 || revision !== commit) {
      fail(
        `the prepared checkout of ${name} is at ${revision || 'an unknown revision'} and the baseline is ${commit}`
      )
    }
    assertCleanCheckout(prepared)
    step(`the prepared checkout of ${name} is the revision of the baseline`)
    return prepared
  }
  const directory = join(workspace, name)
  step(`the checkout of ${name} at ${commit.slice(0, 7)}`)
  cloneAtRevision(sourceOf(source, COMPAT_MIRROR), commit, directory)
  step(`the dependencies of ${name}`)
  await install({ name, directory }, (line) => console.log(`  ${line}`), { frozen: true })
  return directory
}

/** Runs a command and waits for it. */
async function run(
  command: string[],
  options: { cwd: string; env?: Record<string, string> }
): Promise<void> {
  const child = spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await child.exited
  if (code !== 0) {
    throw new Error(`the command "${command.join(' ')}" failed with the code ${code}`)
  }
}

/** The stack of the run. */
let stack: Subprocess | undefined

/** Stops the stack of the run. */
async function stopStack(): Promise<void> {
  const child = stack
  stack = undefined
  if (!child) return
  try {
    child.kill('SIGTERM')
  } catch {
    // The process is already gone.
  }
  await child.exited
}

/** Runs the harness. */
async function main(): Promise<void> {
  const manifest = await readCompatibilityManifest(join(BRIDGE_DIR, 'compatibility.json'))
  const baseline: BaselineSelection = selectBaseline(manifest)
  step(
    baseline.isBaseline
      ? 'the baseline of the manifest is the revision that is tested'
      : `the baseline is overridden: ${baseline.overrides.join(', ')}`
  )

  const workspace =
    process.env.COMPAT_WORKSPACE ?? (await mkdtemp(join(tmpdir(), 'bridge-compat-')))
  const keep = process.env.COMPAT_KEEP !== undefined
  step(`the checkouts of the run are in ${workspace}`)

  try {
    const shuttle = await prepare(
      'shuttle',
      baseline.repositories.shuttle.url,
      baseline.repositories.shuttle.commit,
      workspace
    )
    const hub = await prepare(
      'hub',
      baseline.repositories.hub.url,
      baseline.repositories.hub.commit,
      workspace
    )
    const depot = await prepare(
      'depot',
      baseline.repositories.depot.url,
      baseline.repositories.depot.commit,
      workspace
    )

    // The stack of the run: the four services of the platform and the
    // database of the run, on the ports of the run.
    step('the stack of the run')
    const workDirectory = join(workspace, 'state')
    stack = spawn(['bun', 'run', 'scripts/dev-stack.ts'], {
      cwd: BRIDGE_DIR,
      env: {
        ...process.env,
        DEV_SHUTTLE_DIR: shuttle,
        DEV_HUB_DIR: hub,
        DEV_DEPOT_DIR: depot,
        DEV_WORK_DIR: workDirectory,
        DEV_PG_DIR: join(workDirectory, 'pg'),
        DEV_PG_PORT: String(PORTS.postgres),
        DEV_IDP_PORT: String(PORTS.idp),
        DEV_SHUTTLE_PORT: String(PORTS.shuttle),
        DEV_BRIDGE_PORT: String(PORTS.bridge),
        DEV_HUB_PORT: String(PORTS.hub),
        DEV_DEPOT_PORT: String(PORTS.depot),
        DEV_FRESH: '1',
      },
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await waitFor(`${BRIDGE_URL}/healthz`)

    // The proof: the studio, the one of this repository, against the
    // platform of the baseline.
    step('the smoke test of the studio against the baseline')
    await run(['bun', 'run', 'scripts/dev-smoke.ts'], {
      cwd: BRIDGE_DIR,
      env: { DEV_BRIDGE_URL: BRIDGE_URL },
    })

    console.log('')
    console.log('  the studio speaks the contract of the baseline')
    console.log('')
  } finally {
    await stopStack()
    if (!keep) await rm(workspace, { recursive: true, force: true })
  }
}

main().catch(async (error: unknown) => {
  await stopStack()
  fail(error instanceof Error ? error.message : String(error))
})
