#!/usr/bin/env bun
/**
 * The PostgreSQL of the development machine.
 *
 * The backend of the platform starts the server of the database of the
 * stack, with the scripts of its own checkout, and those scripts look
 * for the binaries of the server in the directories of PostgreSQL of
 * the machine.
 *
 * The studio looks for them too, before the backend is asked: a
 * machine without the binaries of PostgreSQL cannot run the stack, and
 * the message of the machine says what is missing and how it is
 * installed. The studio also names the major of the machine when the
 * backend does not know it: the backend asks for the binaries of a
 * major with the environment `POSTGRES_MAJOR`, and the major of the
 * machine is the answer.
 */

import { spawn, spawnSync } from 'bun'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { exitCodeOf } from './spawn'

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

/** The binaries of PostgreSQL of the machine. */
export interface Binaries {
  /** The directory that holds the binaries. */
  readonly directory: string
  /** The major of the server, when the directory names it. */
  readonly major: number | null
}

/**
 * Finds the binaries of PostgreSQL of the machine.
 *
 * The directories are looked for in the order of the directories of the
 * function above: the newest major first, so the machine runs the
 * server it proves.
 */
export function find(): Binaries | undefined {
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
// The installation of PostgreSQL
// ---------------------------------------------------------------------------

/** The package manager of the machine, and the packages of PostgreSQL. */
interface Installer {
  /** The name of the manager, for the messages of the machine. */
  readonly name: string
  /** The command that installs the packages. */
  readonly command: string[]
  /** The packages of PostgreSQL for that manager. */
  readonly packages: string[]
  /** The command that reads the index of the packages again. */
  readonly update: string[]
}

/**
 * The installer of the packages of PostgreSQL of the machine.
 *
 * The machine is Debian or Ubuntu, Fedora, or macOS: the packages of
 * PostgreSQL are named differently, and the manager of the machine
 * knows how to install them.
 */
export function installer(): Installer | undefined {
  if (existsSync('/usr/bin/apt-get')) {
    return {
      name: 'apt',
      command: ['apt-get', 'install', '-y', '-q'],
      packages: ['postgresql'],
      update: ['apt-get', 'update', '-q'],
    }
  }
  if (existsSync('/usr/bin/dnf')) {
    return {
      name: 'dnf',
      command: ['dnf', 'install', '-y'],
      packages: ['postgresql-server', 'postgresql-contrib'],
      update: ['dnf', 'makecache'],
    }
  }
  if (existsSync('/opt/homebrew/bin/brew') || existsSync('/usr/local/bin/brew')) {
    return {
      name: 'brew',
      command: ['brew', 'install'],
      packages: ['postgresql@18'],
      update: ['brew', 'update'],
    }
  }
  return undefined
}

/**
 * Tells whether the machine can run a command with the rights of the
 * root, without asking for a password.
 *
 * The machine never asks for a password: a runner that waits for a
 * password that nobody types is a runner that hangs.
 */
export function canElevate(): boolean {
  const result = spawnSync(['sudo', '-n', 'true'], { stdout: 'ignore', stderr: 'ignore' })
  return exitCodeOf(result) === 0
}

/**
 * Runs a command of the machine and waits for it.
 *
 * The lines of the command are given to the caller, so the machine
 * says what it is doing.
 */
export async function run(command: string[], onLine: (line: string) => void): Promise<number> {
  const child = spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
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

/**
 * Installs PostgreSQL on the machine.
 *
 * The install is the one of the package manager of the machine, and it
 * needs the rights of the root: the machine only runs it when it can
 * do it without asking for a password. The machine says what it
 * installs.
 *
 * An install that fails because the index of the packages of the
 * machine is older than its packages is tried again with a fresh
 * index.
 */
export async function install(onLine: (line: string) => void): Promise<Binaries | undefined> {
  const installer_ = installer()
  if (!installer_) return undefined
  const asRoot = canElevate() ? ['sudo', '-n'] : []
  const command = [...asRoot, ...installer_.command, ...installer_.packages]
  onLine(`$ ${command.join(' ')}`)
  if ((await run(command, onLine)) !== 0) {
    if (asRoot.length === 0) return find()
    // The index of the packages of the machine may be older than the
    // packages of the machine: the index is read again, and the
    // install is tried once more.
    onLine('the index of the packages of the machine is read again')
    const update = [...asRoot, ...installer_.update]
    onLine(`$ ${update.join(' ')}`)
    await run(update, onLine)
    onLine(`$ ${command.join(' ')}`)
    if ((await run(command, onLine)) !== 0) return undefined
  }
  return find()
}
