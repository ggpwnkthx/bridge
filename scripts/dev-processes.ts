#!/usr/bin/env bun
/**
 * The registry of the processes of the development stack.
 *
 * The runner of the development machine starts the services of the
 * platform as child processes. A run of the runner that starts while
 * another one is alive — or after a run that was killed without its
 * children — must not leave two stacks behind: the ports of the
 * services are taken and the database of the previous run still holds
 * the lock of its data directory.
 *
 * This module keeps the registry of the processes of the runs of the
 * runner in a directory of the working tree: every run registers the
 * processes it spawns, and every run kills the processes of the runs
 * that came before it.
 *
 * The registry is a directory of files, one per process, and not a
 * single file: two runs write it at the same time, and a run that dies
 * must not erase the entries of the run that replaced it.
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// The processes of the machine
// ---------------------------------------------------------------------------

/** A row of the table of the processes of the machine. */
interface ProcessRow {
  /** The identifier of the process. */
  readonly pid: number
  /** The identifier of the parent of the process. */
  readonly ppid: number
  /** The state of the process: `Ss`, `Z`… */
  readonly state: string
  /** The command of the process. */
  readonly command: string
}

/** The table of the processes of the machine. */
function psRows(): ProcessRow[] {
  const result = spawnSync('ps', ['-ww', '-eo', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' })
  if (result.status !== 0 || typeof result.stdout !== 'string') return []
  const rows: ProcessRow[] = []
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const parts = trimmed.split(/\s+/)
    const pid = Number(parts[0])
    const ppid = Number(parts[1])
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    rows.push({ pid, ppid, state: parts[2] ?? '', command: parts.slice(3).join(' ') })
  }
  return rows
}

/** Tells whether a process is alive. */
export function alive(pid: number): boolean {
  const row = psRows().find((candidate) => candidate.pid === pid)
  if (!row) return false
  // A process that is a zombie is gone: it waits for its parent to
  // take it, and it holds nothing.
  return !row.state.startsWith('Z')
}

/** The command of a process, or nothing when it is gone. */
export function commandOf(pid: number): string | undefined {
  const row = psRows().find((candidate) => candidate.pid === pid)
  return row?.command
}

/**
 * The processes that descend from the roots, the deepest first.
 *
 * The order matters: a child is killed before its parent, so a
 * supervisor does not restart what it watches.
 */
export function tree(roots: number[]): number[] {
  const rows = psRows()
  const children = new Map<number, number[]>()
  for (const row of rows) {
    const siblings = children.get(row.ppid) ?? []
    siblings.push(row.pid)
    children.set(row.ppid, siblings)
  }
  const depth = new Map<number, number>()
  const queue: number[] = []
  for (const root of roots) {
    if (depth.has(root)) continue
    depth.set(root, 0)
    queue.push(root)
  }
  while (queue.length > 0) {
    const pid = queue.shift() as number
    for (const child of children.get(pid) ?? []) {
      if (depth.has(child)) continue
      depth.set(child, (depth.get(pid) as number) + 1)
      queue.push(child)
    }
  }
  return [...depth.entries()].sort((left, right) => right[1] - left[1]).map(([pid]) => pid)
}

/** Sends a signal to the processes, the ones that are gone are skipped. */
export function signal(pids: number[], name: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, name)
    } catch {
      // The process is already gone.
    }
  }
}

// ---------------------------------------------------------------------------
// The processes that hold a port
// ---------------------------------------------------------------------------

/** The identifier of the processes that listen on a port. */
export function listeners(port: number): number[] {
  const inodes = socketInodes(port)
  if (inodes.size === 0) return []
  return processesOfSockets(inodes)
}

/** The directory a process works in. */
export function cwdOf(pid: number): string | undefined {
  try {
    return readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    // The process is not on Linux, or it is gone.
  }
  const result = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('n')) return line.slice(1)
  }
  return undefined
}

/**
 * The processes that run a script of a checkout of the machine.
 *
 * The runs of the stack that started before the registry existed, or
 * whose registry was erased, are found here.
 */
export function runners(script: string, directory: string): number[] {
  const pids: number[] = []
  for (const row of psRows()) {
    if (!row.command.includes(script)) continue
    if (cwdOf(row.pid) !== directory) continue
    pids.push(row.pid)
  }
  return pids
}

/** The sockets of the machine that listen on a port. */
function socketInodes(port: number): Set<string> {
  const inodes = new Set<string>()
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/)
      if (fields.length < 10) continue
      // 0A is the state of a socket that listens.
      if (fields[3] !== '0A') continue
      const local = fields[1]?.split(':')
      if (!local || local.length < 2) continue
      if (Number.parseInt(local[1] ?? '', 16) !== port) continue
      inodes.add(fields[9] ?? '')
    }
  }
  return inodes
}

/** The processes that hold the sockets of the machine. */
function processesOfSockets(inodes: Set<string>): number[] {
  const pids: number[] = []
  let entries: string[]
  try {
    entries = readdirSync('/proc')
  } catch {
    return pids
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue
    let descriptors: string[]
    try {
      descriptors = readdirSync(`/proc/${name}/fd`)
    } catch {
      continue
    }
    for (const descriptor of descriptors) {
      let link: string
      try {
        link = readlinkSync(`/proc/${name}/fd/${descriptor}`)
      } catch {
        continue
      }
      const match = /^socket:\[(\d+)\]$/.exec(link)
      if (!match || !inodes.has(match[1] ?? '')) continue
      pids.push(Number(name))
      break
    }
  }
  return pids
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** A process of the registry. */
export interface RegisteredProcess {
  /** The identifier of the process. */
  readonly pid: number
  /** The role of the process in the stack: `stack`, `hub`, `depot`… */
  readonly role: string
  /** The run that spawned the process. */
  readonly owner: string
  /** The command of the process, to recognise it when the identifier is reused. */
  readonly command: string
}

/** The registry of the processes of the runs of the runner. */
export class ProcessRegistry {
  /** The run that owns this registry. */
  readonly owner: string
  /** The directory of the registry. */
  readonly directory: string

  constructor(directory: string, owner = randomUUID()) {
    this.directory = directory
    this.owner = owner
    mkdirSync(directory, { recursive: true })
  }

  /** The name of the file of an entry. */
  private fileName(entry: RegisteredProcess): string {
    return `${entry.role}.${entry.pid}.${entry.owner}.json`
  }

  /** Registers a process of this run. */
  register(pid: number, role: string): void {
    if (!Number.isInteger(pid) || pid <= 0) return
    const entry: RegisteredProcess = {
      pid,
      role,
      owner: this.owner,
      command: commandOf(pid) ?? '',
    }
    writeFileSync(join(this.directory, this.fileName(entry)), JSON.stringify(entry))
  }

  /** The processes of the registry, the ones that are gone are removed. */
  list(): RegisteredProcess[] {
    const entries: RegisteredProcess[] = []
    for (const name of readdirSync(this.directory)) {
      const path = join(this.directory, name)
      let entry: RegisteredProcess
      try {
        entry = JSON.parse(readFileSync(path, 'utf8')) as RegisteredProcess
      } catch {
        rmSync(path, { force: true })
        continue
      }
      if (!Number.isInteger(entry.pid) || !this.recognises(entry)) {
        rmSync(path, { force: true })
        continue
      }
      entries.push(entry)
    }
    return entries
  }

  /** The processes of the runs that came before this one. */
  foreign(): RegisteredProcess[] {
    return this.list().filter((entry) => entry.owner !== this.owner)
  }

  /** Removes the entries of this run. */
  release(): void {
    if (!existsSync(this.directory)) return
    for (const name of readdirSync(this.directory)) {
      const path = join(this.directory, name)
      if (!name.endsWith(`.${this.owner}.json`)) continue
      rmSync(path, { force: true })
    }
  }

  /**
   * Tells whether an entry still describes the process it was written for.
   *
   * The identifier of a process is reused by the machine: an entry that
   * was left by a run that died describes a process that is gone, or
   * another process entirely. Such an entry is dropped.
   */
  private recognises(entry: RegisteredProcess): boolean {
    if (!alive(entry.pid)) return false
    if (entry.command.length === 0) return true
    return commandOf(entry.pid) === entry.command
  }
}
