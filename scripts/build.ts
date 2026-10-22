/**
 * The build of the studio.
 *
 * The script of the browser is written in TypeScript and it is bundled
 * into one file: the studio serves one document and one script, and it
 * does not need a bundler at the time of the request.
 *
 * The build is deterministic: the same sources produce the same file, and
 * the file is written with the name of the version of the studio, so a
 * browser that has the old one does not use it for ever.
 */

import { mkdir, rm, cp } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const source = join(root, 'src/client')
const target = join(root, 'public')

await rm(target, { recursive: true, force: true })
await mkdir(join(target, 'assets'), { recursive: true })

const result = await Bun.build({
  entrypoints: [join(source, 'main.ts')],
  outdir: join(target, 'assets'),
  target: 'browser',
  format: 'esm',
  naming: 'studio.js',
  minify: true,
  sourcemap: 'none',
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await cp(join(source, 'index.html'), join(target, 'index.html'))
await cp(join(source, 'styles.css'), join(target, 'assets/styles.css'))

console.log('the studio was built')
