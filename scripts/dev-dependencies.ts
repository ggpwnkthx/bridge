#!/usr/bin/env bun
/**
 * The dependencies of the development machine.
 *
 * The stack of the development machine is four repositories: the studio
 * and its three neighbours. Each one holds its own dependencies, and a
 * checkout whose dependencies are not installed cannot run: the studio
 * builds the script of its browser with its own packages, and the three
 * others start with theirs.
 *
 * The installer of this file installs the dependencies of a checkout
 * that does not have them. It runs the installer of Bun in the
 * directory of the checkout, so the versions of the lockfile of the
 * checkout are the versions of the machine.
 */

import { spawn } from 'bun'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A stream of bytes that can be read with `for await`. */
type ByteStream = ReadableStream<Uint8Array> & {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>
}

/** A checkout of the development machine. */
export interface Checkout {
  /** The name of the repository, for the messages of the machine. */
  readonly name: string
  /** The directory of the checkout. */
  readonly directory: string
}

/**
 * Tells whether the dependencies of a checkout are installed.
 *
 * A directory of dependencies that is there but empty is a directory
 * of dependencies that are not installed: the install was interrupted,
 * and the stack would fail later, on a module it cannot find.
 */
export function areInstalled(directory: string): boolean {
  const modules = join(directory, 'node_modules')
  if (!existsSync(modules)) return false
  try {
    return readdirSync(modules).length > 0
  } catch {
    // A directory of dependencies that cannot be read is a directory
    // of dependencies that are not installed.
    return false
  }
}

/**
 * The number of the dependencies a checkout declares.
 *
 * A checkout that declares none has nothing to install: it runs
 * without a directory of dependencies, and the machine does not look
 * for one. A checkout whose manifest cannot be read declares what it
 * cannot be read: the machine installs, and the installer says what
 * it cannot find.
 */
function declared(directory: string): number {
  const manifest = join(directory, 'package.json')
  if (!existsSync(manifest)) return 1
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    return (
      Object.keys(parsed.dependencies ?? {}).length +
      Object.keys(parsed.devDependencies ?? {}).length +
      Object.keys(parsed.optionalDependencies ?? {}).length
    )
  } catch {
    return 1
  }
}

/**
 * Tells whether the dependencies of a checkout are waiting for an
 * install.
 */
export function pending(checkout: Checkout): boolean {
  if (declared(checkout.directory) === 0) return false
  return !areInstalled(checkout.directory)
}

/**
 * Installs the dependencies of a checkout.
 *
 * The installer of Bun is run in the directory of the checkout: it
 * reads the lockfile of the checkout and it installs the versions it
 * pins. The lines of the installer are given to the caller, so the
 * machine says what it is doing.
 *
 * The install of a checkout that is pinned — a checkout of a revision
 * of the baseline, whose lockfile is the truth of the revision — is
 * frozen: the install cannot change the lockfile, and it fails when
 * the manifest of the checkout and its lockfile do not agree.
 */
export async function install(
  checkout: Checkout,
  onLine: (line: string) => void,
  options: { frozen?: boolean } = {}
): Promise<void> {
  const command = ['bun', 'install']
  if (options.frozen) command.push('--frozen-lockfile')
  const child = spawn(command, {
    cwd: checkout.directory,
    stdout: 'pipe',
    stderr: 'pipe',
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
  const code = await child.exited
  if (code !== 0) {
    throw new Error(
      `the dependencies of ${checkout.name} could not be installed in ${checkout.directory}`
    )
  }
}
