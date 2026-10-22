/**
 * The assets of the studio (spec §8.1).
 *
 * The studio serves two things: the shell of the user interface, which is
 * a document, and the bundle of the script of the browser. Both are built
 * from the sources of the repository, and both are read once, at the
 * start of the process.
 */

import { join } from 'node:path'

/** The types of the answers of the assets. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

/** The assets of the studio. */
export interface Assets {
  /** The shell of the user interface. */
  shell: () => Promise<string | null>
  /** A file of the assets, by its path. */
  file: (path: string) => Promise<{ body: ArrayBuffer; contentType: string } | null>
}

/** The options of the assets. */
export interface AssetsOptions {
  /** The directory that holds the built assets. */
  readonly directory: string
}

/**
 * The assets of the studio, on the disk.
 *
 * The paths are resolved inside the directory of the assets: a path that
 * climbs out of it names nothing.
 */
export function createAssets(options: AssetsOptions): Assets {
  const root = options.directory
  return {
    async shell() {
      const file = Bun.file(join(root, 'index.html'))
      if (!(await file.exists())) return null
      return file.text()
    },
    async file(path) {
      const name = path.replace(/^\/+/, '')
      if (name.length === 0) return null
      if (name.includes('..') || name.includes('\0')) return null
      const file = Bun.file(join(root, name))
      if (!(await file.exists())) return null
      const extension = name.slice(name.lastIndexOf('.'))
      const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream'
      return { body: await file.arrayBuffer(), contentType }
    },
  }
}

/** The assets that hold nothing: the studio answers without a user interface. */
export function emptyAssets(): Assets {
  return {
    async shell() {
      return null
    },
    async file() {
      return null
    },
  }
}
