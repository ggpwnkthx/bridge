/**
 * The manifest of the baseline of the studio (spec §16).
 *
 * The studio is a client of the platform: it talks to the broker for
 * the login, to the gateway for the data and to the backend behind the
 * gateway. The manifest is the one place that owns the repositories of
 * the platform and the revisions that are tested against them: a pin
 * that is written twice is a pin that will drift.
 *
 * The file is `compatibility.json`, at the root of the repository:
 *
 *   {
 *     "version": 1,
 *     "repositories": {
 *     "shuttle": { "url": "https://github.com/ggpwnkthx/shuttle.git", "commit": "<sha>" },
 *     "hub":     { "url": "https://github.com/ggpwnkthx/hub.git",     "commit": "<sha>" },
 *     "depot":   { "url": "https://github.com/ggpwnkthx/depot.git",   "commit": "<sha>" }
 *     }
 *   }
 *
 * The overrides of the environment are for the runs that test another
 * revision: they never change the manifest, and a run with an override
 * is not the proof of the baseline.
 */

/** A repository of the baseline and the revision that is tested. */
export interface PinnedRepository {
  /** The url of the repository, or a path on the disk. */
  readonly url: string
  /** The full revision of the commit that is tested. */
  readonly commit: string
}

/** The names of the repositories the studio depends on. */
export const REPOSITORY_NAMES = ['shuttle', 'hub', 'depot'] as const

/** The name of a repository the studio depends on. */
export type RepositoryName = (typeof REPOSITORY_NAMES)[number]

/** The manifest of the baseline. */
export interface CompatibilityManifest {
  readonly version: 1
  readonly repositories: Readonly<Record<RepositoryName, PinnedRepository>>
}

/** The problem of a manifest that cannot be used. */
export class CompatibilityManifestError extends Error {
  override readonly name = 'CompatibilityManifestError'
}

/** The name of the file of the manifest. */
export const COMPATIBILITY_MANIFEST_FILE = 'compatibility.json'

/** A revision of a commit is forty hexadecimal characters. */
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

/** Reports whether a value is a usable url or path of a repository. */
function isUsableUrl(value: string): boolean {
  return value.length > 0 && !/\s/.test(value)
}

/**
 * Parses and validates the manifest of the baseline.
 *
 * The manifest is refused as a whole: a baseline that names a revision
 * that does not exist, or a branch instead of a revision, is not a
 * baseline.
 */
export function parseCompatibilityManifest(raw: string): CompatibilityManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CompatibilityManifestError('the manifest of the baseline is not json')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CompatibilityManifestError('the manifest of the baseline is not an object')
  }
  const file = parsed as Record<string, unknown>
  const unknownKeys = Object.keys(file).filter((key) => key !== 'version' && key !== 'repositories')
  if (unknownKeys.length > 0) {
    throw new CompatibilityManifestError(
      `the manifest of the baseline has unknown properties: ${unknownKeys.sort().join(', ')}`
    )
  }
  if (file.version !== 1) {
    throw new CompatibilityManifestError('the manifest of the baseline must have the version 1')
  }
  const repositories = file.repositories
  if (!repositories || typeof repositories !== 'object' || Array.isArray(repositories)) {
    throw new CompatibilityManifestError(
      'the manifest of the baseline must hold the repositories of the platform'
    )
  }
  const record = repositories as Record<string, unknown>
  const unknownRepositories = Object.keys(record).filter(
    (key) => !REPOSITORY_NAMES.includes(key as RepositoryName)
  )
  if (unknownRepositories.length > 0) {
    throw new CompatibilityManifestError(
      `the manifest of the baseline has unknown repositories: ${unknownRepositories.sort().join(', ')}`
    )
  }
  const parsed_ = {} as Record<RepositoryName, PinnedRepository>
  for (const name of REPOSITORY_NAMES) {
    const raw_ = record[name]
    if (!raw_ || typeof raw_ !== 'object' || Array.isArray(raw_)) {
      throw new CompatibilityManifestError(
        `the repository "${name}" of the baseline is not an object`
      )
    }
    const entry = raw_ as Record<string, unknown>
    const unknown = Object.keys(entry).filter((key) => key !== 'url' && key !== 'commit')
    if (unknown.length > 0) {
      throw new CompatibilityManifestError(
        `the repository "${name}" of the baseline has unknown properties: ${unknown.sort().join(', ')}`
      )
    }
    const url = entry.url
    const commit = entry.commit
    if (typeof url !== 'string' || !isUsableUrl(url)) {
      throw new CompatibilityManifestError(
        `the repository "${name}" of the baseline must name a url or a path`
      )
    }
    if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
      throw new CompatibilityManifestError(
        `the repository "${name}" of the baseline must name a full revision of forty hexadecimal characters`
      )
    }
    parsed_[name] = { url, commit }
  }
  return { version: 1, repositories: parsed_ }
}

/** Reads the manifest of the baseline from the disk. */
export async function readCompatibilityManifest(
  path: string = COMPATIBILITY_MANIFEST_FILE
): Promise<CompatibilityManifest> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new CompatibilityManifestError(`the manifest of the baseline is not there: ${path}`)
  }
  return parseCompatibilityManifest(await file.text())
}

/** The environment as a record of strings. */
export type Env = Record<string, string | undefined>

/** The baseline of a run, and the overrides that were applied to it. */
export interface BaselineSelection {
  readonly repositories: Readonly<Record<RepositoryName, PinnedRepository>>
  /** The names of the variables that overrode the manifest. */
  readonly overrides: readonly string[]
  /** True when the run tests the revision of the checked in manifest. */
  readonly isBaseline: boolean
}

/**
 * Applies the overrides of the environment to the manifest.
 *
 * The precedence is the one of the manifest: the environment wins, and
 * an override that cannot be used stops the run. The manifest itself is
 * never changed: an override is a candidate, and a candidate is not the
 * baseline.
 */
export function selectBaseline(
  manifest: CompatibilityManifest,
  env: Env = process.env
): BaselineSelection {
  const overrides: string[] = []
  const select = (
    pinned: PinnedRepository,
    urlVariable: string,
    commitVariable: string
  ): PinnedRepository => {
    // An empty variable is a variable that is not set: a deployment
    // that exports an empty one is not an override.
    const url = env[urlVariable]
    const commit = env[commitVariable]
    if (url !== undefined && url !== '') {
      if (!isUsableUrl(url)) {
        throw new CompatibilityManifestError(`${urlVariable} does not name a repository`)
      }
      overrides.push(urlVariable)
    }
    if (commit !== undefined && commit !== '') {
      if (!COMMIT_PATTERN.test(commit)) {
        throw new CompatibilityManifestError(
          `${commitVariable} must name a full revision of forty hexadecimal characters`
        )
      }
      overrides.push(commitVariable)
    }
    return {
      url: url || pinned.url,
      commit: commit || pinned.commit,
    }
  }
  const repositories = {
    shuttle: select(manifest.repositories.shuttle, 'SHUTTLE_REPOSITORY', 'SHUTTLE_COMMIT'),
    hub: select(manifest.repositories.hub, 'HUB_REPOSITORY', 'HUB_COMMIT'),
    depot: select(manifest.repositories.depot, 'DEPOT_REPOSITORY', 'DEPOT_COMMIT'),
  }
  return { repositories, overrides, isBaseline: overrides.length === 0 }
}
