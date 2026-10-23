/**
 * The tests of the registry of the processes of the development stack.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { alive, ProcessRegistry, signal, tree } from '../../scripts/dev-processes'

/** A directory of the tests. */
function workDir(): string {
  return mkdtempSync(join(tmpdir(), 'bridge-processes-'))
}

/** A process that waits and that the test kills at its end. */
function sleeper(): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(['sleep', '30'], { stdout: 'ignore', stderr: 'ignore' })
}

describe('the registry of the processes of the stack', () => {
  test('it registers the processes of the run and forgets them', () => {
    const directory = workDir()
    try {
      const registry = new ProcessRegistry(directory)
      registry.register(process.pid, 'stack')
      const entries = registry.list()
      expect(entries.length).toBe(1)
      expect(entries[0]?.role).toBe('stack')
      expect(entries[0]?.owner).toBe(registry.owner)

      registry.release()
      expect(registry.list().length).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('a run sees the processes of the runs that came before it', async () => {
    const directory = workDir()
    try {
      const first = new ProcessRegistry(directory)
      const second = new ProcessRegistry(directory)
      const child = sleeper()
      try {
        first.register(child.pid, 'hub')
        expect(second.foreign().length).toBe(1)
        expect(second.foreign()[0]?.role).toBe('hub')
        expect(second.list().length).toBe(1)
      } finally {
        child.kill()
        await child.exited
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('it forgets the processes that are gone', async () => {
    const directory = workDir()
    try {
      const registry = new ProcessRegistry(directory)
      const child = sleeper()
      registry.register(child.pid, 'hub')
      child.kill()
      await child.exited
      expect(registry.list().length).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('the processes of the machine', () => {
  test('it tells whether a process is alive', async () => {
    expect(alive(process.pid)).toBe(true)
    const child = sleeper()
    child.kill()
    await child.exited
    expect(alive(child.pid)).toBe(false)
  })

  test('it finds the children of a process, the deepest first', () => {
    const child = sleeper()
    try {
      const descendants = tree([child.pid])
      expect(descendants[0]).toBe(child.pid)
    } finally {
      child.kill()
    }
  })

  test('it kills a process and its children', async () => {
    const child = sleeper()
    signal(tree([child.pid]), 'SIGKILL')
    await child.exited
    expect(alive(child.pid)).toBe(false)
  })
})
