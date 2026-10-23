#!/usr/bin/env bun
/**
 * The schema of the databases of the development stack.
 *
 * The schema of a service is the sum of the migrations of its checkout.
 * The database of a previous run holds the migrations that were applied
 * to it, and the checkout holds the migrations that exist now.
 *
 * The two are not always the same: a migration that was renamed after
 * it was applied leaves the database with a migration that the service
 * does not know, and a migration that was changed after it was applied
 * is a drift of the same kind. The service refuses to start against a
 * schema it does not understand, and the runner of the development
 * machine has to repair the drift before it starts the services.
 *
 * The module owns the vocabulary of the drift. It reads no database and
 * touches no file of the stack: the runner reads the database and hands
 * the two sets of migrations over.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The migrations of a schema.
 *
 * The name of the file of a migration is its identity. The digest of
 * its statements is there when the service keeps one: it is the way a
 * migration that was changed after it was applied is found.
 */
export type Migrations = Map<string, string | undefined>

/**
 * Reads the migrations of a directory.
 *
 * A directory that does not hold any migration is a directory of a
 * checkout of another version: it holds no migration, and the drift is
 * computed against nothing.
 */
export function readMigrations(directory: string, withDigest: boolean): Migrations {
  const migrations: Migrations = new Map()
  let names: string[]
  try {
    names = readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort()
  } catch {
    return migrations
  }
  for (const name of names) {
    const sql = readFileSync(join(directory, name), 'utf8')
    migrations.set(name, withDigest ? createHash('sha256').update(sql).digest('hex') : undefined)
  }
  return migrations
}

/**
 * The migrations of the database that the checkout of the service does
 * not know, or knows with another content.
 *
 * A migration that the checkout does not have is a migration that was
 * renamed or removed after it was applied. A migration whose digest
 * changed is a migration that was edited after it was applied. The two
 * are the same drift: the database is behind the service.
 */
export function drift(applied: Migrations, known: Migrations): string[] {
  const drifted: string[] = []
  for (const [name, digest] of applied) {
    if (!known.has(name)) {
      drifted.push(name)
      continue
    }
    const expected = known.get(name)
    if (digest !== undefined && expected !== undefined && digest !== expected) {
      drifted.push(name)
    }
  }
  return drifted
}
