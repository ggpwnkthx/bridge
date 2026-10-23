/**
 * The tests of the manifest of the baseline of the studio.
 *
 * The manifest is the one place that owns the repositories of the
 * platform and the revisions that are tested against them: a manifest
 * that is not a baseline is refused as a whole.
 */

import { describe, expect, test } from 'bun:test'
import {
  CompatibilityManifestError,
  parseCompatibilityManifest,
  selectBaseline,
} from '../../scripts/compatibility-manifest'

/** A manifest of the tests. */
function manifest(revision = 'a'.repeat(40)): string {
  return JSON.stringify({
    version: 1,
    repositories: {
      shuttle: { url: 'https://example.com/shuttle.git', commit: revision },
      hub: { url: 'https://example.com/hub.git', commit: revision },
      depot: { url: 'https://example.com/depot.git', commit: revision },
    },
  })
}

describe('the manifest of the baseline', () => {
  test('it reads the repositories of the platform', () => {
    const parsed = parseCompatibilityManifest(manifest())
    expect(parsed.version).toBe(1)
    expect(parsed.repositories.shuttle.url).toBe('https://example.com/shuttle.git')
    expect(parsed.repositories.hub.commit).toBe('a'.repeat(40))
    expect(parsed.repositories.depot.url).toBe('https://example.com/depot.git')
  })

  test('it refuses a manifest that is not json', () => {
    expect(() => parseCompatibilityManifest('not json')).toThrow(CompatibilityManifestError)
  })

  test('it refuses a manifest that holds an unknown repository', () => {
    const raw = JSON.parse(manifest()) as Record<string, unknown>
    ;(raw.repositories as Record<string, unknown>).other = {
      url: 'https://example.com/other.git',
      commit: 'a'.repeat(40),
    }
    expect(() => parseCompatibilityManifest(JSON.stringify(raw))).toThrow(
      CompatibilityManifestError
    )
  })

  test('it refuses a revision that is not a revision', () => {
    const raw = JSON.parse(manifest()) as {
      repositories: Record<string, { commit: string }> & { shuttle: { commit: string } }
    }
    raw.repositories.shuttle.commit = 'main'
    expect(() => parseCompatibilityManifest(JSON.stringify(raw))).toThrow(
      CompatibilityManifestError
    )
  })

  test('it refuses a repository that is missing', () => {
    const raw = JSON.parse(manifest()) as { repositories: Record<string, unknown> }
    delete raw.repositories.depot
    expect(() => parseCompatibilityManifest(JSON.stringify(raw))).toThrow(
      CompatibilityManifestError
    )
  })
})

describe('the baseline of a run', () => {
  test('the manifest is the baseline when nothing overrides it', () => {
    const parsed = parseCompatibilityManifest(manifest())
    const selection = selectBaseline(parsed, {})
    expect(selection.isBaseline).toBe(true)
    expect(selection.overrides.length).toBe(0)
    expect(selection.repositories.shuttle.commit).toBe('a'.repeat(40))
  })

  test('the environment overrides the manifest', () => {
    const parsed = parseCompatibilityManifest(manifest())
    const selection = selectBaseline(parsed, {
      SHUTTLE_COMMIT: 'b'.repeat(40),
      DEPOT_REPOSITORY: '/home/depot',
    })
    expect(selection.isBaseline).toBe(false)
    expect(selection.repositories.shuttle.commit).toBe('b'.repeat(40))
    expect(selection.repositories.depot.url).toBe('/home/depot')
    expect(selection.repositories.hub.commit).toBe('a'.repeat(40))
    expect(selection.overrides).toContain('SHUTTLE_COMMIT')
  })

  test('an empty variable is not an override', () => {
    const parsed = parseCompatibilityManifest(manifest())
    const selection = selectBaseline(parsed, { HUB_COMMIT: '' })
    expect(selection.isBaseline).toBe(true)
    expect(selection.repositories.hub.commit).toBe('a'.repeat(40))
  })

  test('an override that cannot be used is an error', () => {
    const parsed = parseCompatibilityManifest(manifest())
    expect(() => selectBaseline(parsed, { HUB_COMMIT: 'main' })).toThrow(CompatibilityManifestError)
  })
})
