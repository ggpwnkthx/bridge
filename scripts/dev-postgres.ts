#!/usr/bin/env bun
/**
 * The PostgreSQL of the development machine.
 *
 * The stack of the development machine has a database, and the database
 * is a server of PostgreSQL. The machine of the studio needs the
 * binaries of that server — `initdb` and `pg_ctl` — and it has two
 * ways to have them:
 *
 *   - the machine has them: the runner uses the ones of the machine;
 *   - the machine does not have them: the runner **pulls** them, the
 *     way a developer pulls a dependency: the packages of PostgreSQL
 *     are downloaded and unpacked in the directory of the machine, and
 *     the server runs from there. Nothing is installed on the machine,
 *     and the machine needs no rights it does not have.
 *
 * The environment `DEV_PG_BIN` names the directory of the binaries when
 * the machine has them somewhere the runner does not look.
 *
 * The runner starts the server himself: the server of the machine is
 * the server of the stack, in the directory of the stack, and the
 * runner knows both.
 */

import { spawn } from 'bun'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** A stream of bytes that can be read with `for await`. */
type ByteStream = ReadableStream<Uint8Array> & {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>
}

/** The binaries that the machine needs to start the server. */
const BINARIES = ['initdb', 'pg_ctl']

/** The newest major of PostgreSQL that the directories of the machine can hold. */
const NEWEST_MAJOR = 21

/** The oldest major of PostgreSQL that the machine supports. */
const OLDEST_MAJOR = 10

/**
 * The majors that the backend of the platform looks for by itself.
 *
 * The backend of the platform has its own list of the directories of
 * PostgreSQL, and a major of that list is found without the help of
 * the studio. The studio only names the major when the backend cannot
 * find it by itself.
 */
const KNOWN_MAJORS = [18, 17, 16, 15, 14]

/** The binaries of PostgreSQL of the machine. */
export interface Binaries {
  /** The directory that holds the binaries. */
  readonly directory: string
  /** The major of the server, when the directory names it. */
  readonly major: number | null
}

// ---------------------------------------------------------------------------
// The directories of the machine
// ---------------------------------------------------------------------------

/** The directories of the binaries of PostgreSQL, the newest first. */
export function directories(): string[] {
  const found: string[] = []
  for (let major = NEWEST_MAJOR; major >= OLDEST_MAJOR; major--) {
    found.push(`/usr/lib/postgresql/${major}/bin`)
  }
  found.push('/usr/local/pgsql/bin', '/usr/local/postgresql/bin')
  // The kegs of Homebrew hold the binaries of a major under a name of
  // their own, and they are not in the path of the machine.
  for (const directory of homebrewKegs()) {
    found.push(join(directory, 'bin'))
  }
  for (const path of (process.env.PATH ?? '').split(':')) {
    if (path.length > 0) found.push(path)
  }
  return found
}

/** The kegs of PostgreSQL of Homebrew. */
function homebrewKegs(): string[] {
  const found: string[] = []
  for (const root of ['/opt/homebrew/opt', '/usr/local/opt']) {
    if (!existsSync(root)) continue
    try {
      for (const entry of readdirSync(root)) {
        if (!entry.startsWith('postgresql')) continue
        found.push(join(root, entry))
      }
    } catch {
      // A directory of kegs that cannot be read holds no keg.
    }
  }
  return found
}

/**
 * The major of a directory of binaries, when the directory names it.
 *
 * It is null when the directory does not name a major: the version of
 * the server is then not known, and it is not guessed.
 */
export function majorOf(directory: string): number | null {
  const match = /postgresql(?:@|\/)?(\d+)/.exec(directory)
  return match ? Number(match[1]) : null
}

/**
 * The binaries of PostgreSQL that the machine names.
 *
 * The environment `DEV_PG_BIN` names the directory of the binaries when
 * the machine has them somewhere the runner does not look. It is a
 * direction, not a guess: a directory that does not hold the binaries
 * is an error.
 */
export function named(): Binaries | undefined {
  const directory = process.env.DEV_PG_BIN
  if (!directory) return undefined
  return { directory, major: majorOf(directory) }
}

/**
 * Finds the binaries of PostgreSQL of the machine.
 *
 * The directories are looked for in the order of the directories of the
 * function above: the newest major first, so the machine runs the
 * server it proves. A machine that pulls its own PostgreSQL does not
 * look for the one of the system.
 */
export function find(): Binaries | undefined {
  // The machine names the directory of the binaries: that one, or none.
  const named = process.env.DEV_PG_BIN
  if (named) {
    return BINARIES.every((binary) => existsSync(join(named, binary)))
      ? { directory: named, major: majorOf(named) }
      : undefined
  }
  if (process.env.DEV_PG_PULL === '1') return undefined
  for (const directory of directories()) {
    if (BINARIES.every((binary) => existsSync(join(directory, binary)))) {
      return { directory, major: majorOf(directory) }
    }
  }
  return undefined
}

/**
 * Tells whether the backend of the platform finds the binaries of the
 * machine by itself.
 *
 * The backend has its own list of the directories of PostgreSQL. A
 * major of that list is found without the help of the studio, and the
 * studio does not name it.
 */
export function isKnown(major: number | null): boolean {
  if (major === null) return false
  return KNOWN_MAJORS.includes(major)
}

// ---------------------------------------------------------------------------
// The commands of the machine
// ---------------------------------------------------------------------------

/**
 * Runs a command of the machine and waits for it.
 *
 * The lines of the command are given to the caller, so the machine
 * says what it is doing.
 */
export async function run(
  command: string[],
  onLine: (line: string) => void,
  options: { cwd?: string } = {}
): Promise<number> {
  const child = spawn(command, {
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', DEBIAN_FRONTEND: 'noninteractive' },
  })
  const collect = (stream: ReadableStream<Uint8Array> | undefined): void => {
    if (!stream) return
    void (async () => {
      const decoder = new TextDecoder()
      for await (const chunk of stream as ByteStream) {
        for (const line of decoder.decode(chunk).split('\n')) {
          if (line.trim().length === 0) continue
          onLine(line)
        }
      }
    })()
  }
  collect(child.stdout as ReadableStream<Uint8Array>)
  collect(child.stderr as ReadableStream<Uint8Array>)
  return await child.exited
}

// ---------------------------------------------------------------------------
// The pull of PostgreSQL
// ---------------------------------------------------------------------------

/**
 * The majors of PostgreSQL that the machine can pull.
 *
 * The machine pulls the packages of PostgreSQL of its own
 * distribution: the index of the machine knows them, and the runner
 * only downloads them. The runner does not install them: the packages
 * are unpacked in the directory of the machine.
 */
export async function pullable(): Promise<number[]> {
  if (!existsSync('/usr/bin/apt-cache') || !existsSync('/usr/bin/apt-get')) return []
  const result = spawnSync('apt-cache', ['search', '--names-only', '^postgresql-[0-9]+$'], {
    encoding: 'utf8',
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return []
  const majors: number[] = []
  for (const line of result.stdout.split('\n')) {
    const match = /^postgresql-(\d+)\b/.exec(line.trim())
    if (!match) continue
    majors.push(Number(match[1]))
  }
  return majors.sort((left, right) => right - left)
}

/**
 * Pulls PostgreSQL into the directory of the machine.
 *
 * The packages of PostgreSQL are downloaded with the tool of the
 * machine — nothing is installed — and they are unpacked in the
 * directory of the machine. The server of the machine then runs from
 * there, and the machine keeps no trace of it.
 */
export async function pull(
  directory: string,
  onLine: (line: string) => void
): Promise<Binaries | undefined> {
  for (const major of await pullable()) {
    const packages = [`postgresql-${major}`, `postgresql-client-${major}`]
    const downloads = join(directory, `packages-${major}`)
    const prefix = join(directory, `postgresql-${major}`)
    const binaries = join(prefix, 'usr', 'lib', 'postgresql', String(major), 'bin')
    // The packages of a major that is already there are not pulled
    // again: a machine that runs the stack again has them.
    if (BINARIES.every((binary) => existsSync(join(binaries, binary)))) {
      return { directory: binaries, major }
    }
    mkdirSync(downloads, { recursive: true })
    onLine(`$ apt-get download ${packages.join(' ')}`)
    if ((await run(['apt-get', 'download', ...packages], onLine, { cwd: downloads })) !== 0) {
      continue
    }
    for (const file of readdirSync(downloads)) {
      if (!file.endsWith('.deb')) continue
      onLine(`$ dpkg-deb -x ${file}`)
      if ((await run(['dpkg-deb', '-x', join(downloads, file), prefix], onLine)) !== 0) {
        return undefined
      }
    }
    if (BINARIES.every((binary) => existsSync(join(binaries, binary)))) {
      // The packages of a major are unpacked once: the packages
      // themselves are not kept.
      rmSync(downloads, { recursive: true, force: true })
      return { directory: binaries, major }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// The server of the machine
// ---------------------------------------------------------------------------

/** The server of the database of the machine. */
export interface StartedPostgres {
  /** The port of the server. */
  readonly port: number
  /** The directory of the data of the server. */
  readonly dataDir: string
  /** Stops the server. */
  readonly stop: () => void
}

/** The options of the server of the machine. */
export interface PostgresOptions {
  /** The directory of the binaries of PostgreSQL. */
  readonly binaries: string
  /** The directory of the data of the server. */
  readonly dataDir: string
  /** The directory of the socket of the server. */
  readonly socketDir: string
  /** The port of the server. */
  readonly port: number
  /** The user of the server. */
  readonly user: string
  /** The password of the user. */
  readonly password: string
  /** Removes the data of a previous run. */
  readonly fresh: boolean
}

/**
 * Starts the server of the database of the machine.
 *
 * The server is the server of the stack: it lives in the directory of
 * the stack, it listens on the port of the stack, and it speaks to the
 * machine on the socket of the stack. The runner stops it when the
 * stack stops.
 */
export async function start(options: PostgresOptions): Promise<StartedPostgres> {
  const binary = (name: string): string => join(options.binaries, name)
  if (options.fresh && existsSync(options.dataDir)) {
    rmSync(options.dataDir, { recursive: true, force: true })
  }
  mkdirSync(options.socketDir, { recursive: true })

  if (!existsSync(join(options.dataDir, 'PG_VERSION'))) {
    const init = spawnSync(
      binary('initdb'),
      [
        '-D',
        options.dataDir,
        '-U',
        options.user,
        '--auth-local=trust',
        '--auth-host=scram-sha-256',
        '-E',
        'UTF8',
      ],
      { encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }
    )
    if (init.status !== 0) {
      throw new Error(`initdb failed: ${init.stderr}`)
    }
  }

  const log = join(options.dataDir, '..', 'server.log')
  const started = spawnSync(
    binary('pg_ctl'),
    [
      '-D',
      options.dataDir,
      '-l',
      log,
      '-o',
      `-p ${options.port} -k ${options.socketDir} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
      '-w',
      'start',
    ],
    { encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }
  )
  if (started.status !== 0) {
    throw new Error(`pg_ctl failed: ${started.stderr}\n${started.stdout}`)
  }

  const stop = (): void => {
    spawnSync(binary('pg_ctl'), ['-D', options.dataDir, '-m', 'fast', 'stop'], {
      encoding: 'utf8',
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    })
  }
  return { port: options.port, dataDir: options.dataDir, stop }
}
