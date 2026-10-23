/**
 * The build of the studio.
 *
 * The script of the browser is written in TypeScript and it is bundled
 * into one file: the studio serves one document and one script, and it
 * does not need a bundler at the time of the request.
 *
 * The build is deterministic: the same sources produce the same file,
 * and the studio serves it with the name it has, so a browser that has
 * the old one does not use it for ever.
 *
 * With `--watch` the build follows the sources: the script of the
 * browser is built again when a component of the studio changes.
 */

import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const source = join(root, 'src/client')
const target = join(root, 'dist/client')
const watch = process.argv.includes('--watch')

const copyStyles = async (): Promise<void> => {
  await cp(join(source, 'styles.css'), join(target, 'static/styles.css'))
}

await rm(target, { recursive: true, force: true })
await mkdir(join(target, 'static'), { recursive: true })

const result = await Bun.build({
  entrypoints: [join(source, 'entry.tsx')],
  outdir: join(target, 'static'),
  target: 'browser',
  format: 'esm',
  naming: 'client.js',
  minify: true,
  sourcemap: 'none',
  ...(watch
    ? {
        watch: {
          onRebuild(error: Error | null) {
            if (error) {
              console.error(error)
              return
            }
            void copyStyles().then(() => console.log('the studio was built'))
          },
        },
      }
    : {}),
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await copyStyles()

console.log('the studio was built')
