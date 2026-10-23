/**
 * The tests of the PostgreSQL of the development machine.
 */

import { describe, expect, test } from 'bun:test'
import { directories, isKnown, majorOf } from '../../scripts/dev-postgres'

describe('the directories of the binaries of PostgreSQL', () => {
  test('they hold the majors of the machine, the newest first', () => {
    const directories_ = directories()
    const majors = directories_
      .map((directory) => majorOf(directory))
      .filter((major): major is number => major !== null)
    expect(majors.length).toBeGreaterThan(0)
    expect([...majors].sort((a, b) => b - a)).toEqual(majors)
  })

  test('they hold the path of the machine', () => {
    const path = (process.env.PATH ?? '').split(':').filter((entry) => entry.length > 0)
    for (const entry of path) {
      expect(directories()).toContain(entry)
    }
  })
})

describe('the major of a directory of binaries', () => {
  test('it is read from the name of the directory', () => {
    expect(majorOf('/usr/lib/postgresql/18/bin')).toBe(18)
    expect(majorOf('/opt/homebrew/opt/postgresql@16/bin')).toBe(16)
  })

  test('it is not guessed when the directory does not name one', () => {
    expect(majorOf('/usr/local/pgsql/bin')).toBeNull()
  })
})

describe('the majors that the backend of the platform knows', () => {
  test('the majors of its own list are known', () => {
    expect(isKnown(18)).toBe(true)
    expect(isKnown(15)).toBe(true)
  })

  test('a major that is not in its list is not known', () => {
    expect(isKnown(19)).toBe(false)
    expect(isKnown(null)).toBe(false)
  })
})
