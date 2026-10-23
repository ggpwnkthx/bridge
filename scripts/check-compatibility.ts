#!/usr/bin/env bun
/**
 * The check of the drift of the baseline (spec §16).
 *
 * The manifest `compatibility.json` owns the repositories of the
 * platform and the revisions that are tested against them. The
 * documentation of the baseline and the workflow of the integration read
 * it, and this check proves that they still agree with it.
 *
 * The command:
 *
 *   bun run check:compatibility          # the check
 *   bun run check:compatibility --write  # the regeneration of the block
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  readCompatibilityManifest,
  type CompatibilityManifest,
  type RepositoryName,
} from './compatibility-manifest'

/** The root of the repository. */
const BRIDGE_DIR = resolve(import.meta.dir, '..')

/** The documentation of the baseline. */
const DOCUMENT = join(BRIDGE_DIR, 'docs', 'compatibility.md')

/** The workflow of the gates of the repository. */
const WORKFLOW = join(BRIDGE_DIR, '.github', 'workflows', 'gates.yml')

/** The markers of the block of the baseline in the documentation. */
export const BASELINE_START = '<!-- compatibility-baseline:start -->'
export const BASELINE_END = '<!-- compatibility-baseline:end -->'

/** The names of the repositories of the baseline, in the order of the table. */
const NAMES: readonly RepositoryName[] = ['shuttle', 'hub', 'depot']

/** A problem of the baseline. */
export interface BaselineProblem {
  readonly file: string
  readonly message: string
}

/** The block of the baseline, as it is written in the documentation. */
export function baselineBlock(manifest: CompatibilityManifest): string {
  const rows = NAMES.map((name) => {
    const repository = manifest.repositories[name]
    return `| ${name} | ${repository.url} | \`${repository.commit}\` |`
  })
  return [
    BASELINE_START,
    '',
    'The baseline of the compatibility is the one of `compatibility.json`:',
    'the one file of this repository that owns the repositories of the',
    'platform and the revisions that are tested against them.',
    '',
    '| Project | Repository | Revision |',
    '| --- | --- | --- |',
    ...rows,
    '',
    BASELINE_END,
  ].join('\n')
}

/** The block of the baseline, as it is in the documentation. */
export function blockOf(document: string): string | undefined {
  const start = document.indexOf(BASELINE_START)
  const end = document.indexOf(BASELINE_END)
  if (start === -1 || end === -1 || end < start) return undefined
  return document.slice(start, end + BASELINE_END.length)
}

/**
 * Checks the baseline of the documentation and of the workflow.
 *
 * The check is small on purpose: it proves that the active
 * documentation and the workflow agree with the manifest, and it says
 * nothing about the historical evidence of the releases.
 */
export function checkBaseline(
  manifest: CompatibilityManifest,
  document: string,
  workflow: string
): BaselineProblem[] {
  const problems: BaselineProblem[] = []
  const block = blockOf(document)
  if (!block) {
    problems.push({
      file: 'docs/compatibility.md',
      message: 'the block of the baseline is not there',
    })
  } else if (block !== baselineBlock(manifest)) {
    problems.push({
      file: 'docs/compatibility.md',
      message: 'the block of the baseline does not agree with the manifest',
    })
  }
  // The workflow does not hold a pin of its own: it reads the manifest,
  // and a pin that is written twice is a pin that will drift.
  const revision = /[0-9a-f]{40}/.exec(workflow)
  if (revision) {
    problems.push({
      file: '.github/workflows/gates.yml',
      message: `the workflow holds a revision of its own: ${revision[0]}`,
    })
  }
  if (!workflow.includes('compatibility.json')) {
    problems.push({
      file: '.github/workflows/gates.yml',
      message: 'the workflow does not read the manifest of the baseline',
    })
  }
  return problems
}

/** Runs the check. */
async function main(): Promise<void> {
  const manifest = await readCompatibilityManifest(join(BRIDGE_DIR, 'compatibility.json'))
  const document = await readFile(DOCUMENT, 'utf8')
  const workflow = await readFile(WORKFLOW, 'utf8')
  if (process.argv.includes('--write')) {
    const block = baselineBlock(manifest)
    const current = blockOf(document)
    const written = current ? document.replace(current, block) : `${document}\n\n${block}\n`
    await writeFile(DOCUMENT, written)
    console.log('the block of the baseline is written')
    return
  }
  const problems = checkBaseline(manifest, document, workflow)
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`✗ ${problem.file}: ${problem.message}`)
    }
    console.error(
      'the baseline drifted: run "bun run check:compatibility --write" to write the block of the documentation'
    )
    process.exit(1)
  }
  console.log('the baseline of the documentation and of the workflow agrees with the manifest')
}

main().catch((error: unknown) => {
  console.error(
    `✗ the check of the baseline failed: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exit(1)
})
