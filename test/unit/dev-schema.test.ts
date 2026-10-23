/**
 * The tests of the drift of the schema of the development stack.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drift, readMigrations } from '../../scripts/dev-schema'

/** A directory of the tests. */
function workDir(): string {
  return mkdtempSync(join(tmpdir(), 'bridge-schema-'))
}

/** Writes a migration in a directory. */
function migration(directory: string, name: string, sql: string): void {
  writeFileSync(join(directory, name), sql)
}

describe('the migrations of a checkout', () => {
  test('it reads the migrations of the directory, by their name', () => {
    const directory = workDir()
    try {
      migration(directory, '0001_initial.sql', 'create table a (id int);')
      migration(directory, '0002_more.sql', 'create table b (id int);')
      const migrations = readMigrations(directory, false)
      expect([...migrations.keys()]).toEqual(['0001_initial.sql', '0002_more.sql'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('it holds the digest of the statements when the service keeps one', () => {
    const directory = workDir()
    try {
      migration(directory, '0001_initial.sql', 'create table a (id int);')
      const migrations = readMigrations(directory, true)
      expect(migrations.get('0001_initial.sql')).toMatch(/^[0-9a-f]{64}$/)
      expect(readMigrations(directory, false).get('0001_initial.sql')).toBeUndefined()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('a directory without migrations holds none', () => {
    const directory = workDir()
    try {
      expect(readMigrations(directory, true).size).toBe(0)
      expect(readMigrations(join(directory, 'nowhere'), true).size).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('the drift of the schema', () => {
  test('a migration that was renamed after it was applied is a drift', () => {
    const applied = new Map([['0010_group_members.sql', undefined]])
    const known = new Map([['0010_group_membership.sql', undefined]])
    expect(drift(applied, known)).toEqual(['0010_group_members.sql'])
  })

  test('a migration that was changed after it was applied is a drift', () => {
    const applied = new Map([['0007_search.sql', 'the-old-digest']])
    const known = new Map([['0007_search.sql', 'the-new-digest']])
    expect(drift(applied, known)).toEqual(['0007_search.sql'])
  })

  test('the migrations that the two sides share are not a drift', () => {
    const applied = new Map([
      ['0001_initial.sql', 'the-digest'],
      ['0002_more.sql', undefined],
    ])
    const known = new Map([
      ['0001_initial.sql', 'the-digest'],
      ['0002_more.sql', undefined],
    ])
    expect(drift(applied, known)).toEqual([])
  })

  test('a migration that the checkout does not have yet is not a drift', () => {
    const applied = new Map([['0001_initial.sql', undefined]])
    const known = new Map([
      ['0001_initial.sql', undefined],
      ['0002_more.sql', undefined],
    ])
    expect(drift(applied, known)).toEqual([])
  })
})
