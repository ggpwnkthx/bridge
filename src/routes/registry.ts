/**
 * The table of the routes of the studio.
 *
 * honox finds the routes of a studio in the files of its `routes`
 * directory, and it derives the path of every route from the name of
 * its file. The table is written here instead of being read from the
 * disk, so the studio can be loaded by Bun — the contract of the http
 * surface runs the real routes — as well as by the bundler of the
 * client.
 *
 * The names of the files are the names of honox: `index` is the path of
 * its directory, `[name]` is a parameter of the path, and `[...name]` is
 * the rest of it.
 */

import * as root from './index'
import * as login from './login'
import * as logout from './logout'
import * as healthz from './healthz'
import * as readyz from './readyz'
import * as callback from './auth/callback'
import * as assets from './static/[...path]'
import * as studio from './w/[workspaceId]/index'
import * as session from './w/[workspaceId]/api/session'
import * as schema from './w/[workspaceId]/api/schema'
import * as schemaCollection from './w/[workspaceId]/api/schema/[collection]'
import * as items from './w/[workspaceId]/api/items/[collection]/index'
import * as record from './w/[workspaceId]/api/items/[collection]/[id]'
import * as versions from './w/[workspaceId]/api/items/[collection]/[id]/versions'
import * as version from './w/[workspaceId]/api/items/[collection]/[id]/versions/[version]'
import * as rollback from './w/[workspaceId]/api/items/[collection]/[id]/rollback'
import * as aggregate from './w/[workspaceId]/api/aggregate/[collection]'
import * as audit from './w/[workspaceId]/api/audit'
import * as renderer from './_renderer'
import * as middleware from './_middleware'
import * as notFound from './_404'
import * as failure from './_error'

/**
 * The routes of the studio.
 *
 * The key of a route is the path of its file: honox reads the path of
 * the studio from it.
 */
export const ROUTES = {
  '/src/routes/index.tsx': root,
  '/src/routes/login.tsx': login,
  '/src/routes/logout.tsx': logout,
  '/src/routes/healthz.tsx': healthz,
  '/src/routes/readyz.tsx': readyz,
  '/src/routes/auth/callback.tsx': callback,
  '/src/routes/static/[...path].ts': assets,
  '/src/routes/w/[workspaceId]/index.tsx': studio,
  '/src/routes/w/[workspaceId]/api/session.ts': session,
  '/src/routes/w/[workspaceId]/api/schema.ts': schema,
  '/src/routes/w/[workspaceId]/api/schema/[collection].ts': schemaCollection,
  '/src/routes/w/[workspaceId]/api/items/[collection]/index.ts': items,
  '/src/routes/w/[workspaceId]/api/items/[collection]/[id].ts': record,
  '/src/routes/w/[workspaceId]/api/items/[collection]/[id]/versions.ts': versions,
  '/src/routes/w/[workspaceId]/api/items/[collection]/[id]/versions/[version].ts': version,
  '/src/routes/w/[workspaceId]/api/items/[collection]/[id]/rollback.ts': rollback,
  '/src/routes/w/[workspaceId]/api/aggregate/[collection].ts': aggregate,
  '/src/routes/w/[workspaceId]/api/audit.ts': audit,
}

/** The renderer of the pages of the studio. */
export const RENDERER = {
  '/src/routes/_renderer.tsx': renderer,
}

/** The middleware of the requests of the studio. */
export const MIDDLEWARE = {
  '/src/routes/_middleware.ts': middleware,
}

/** The page of a path that does not exist. */
export const NOT_FOUND = {
  '/src/routes/_404.tsx': notFound,
}

/** The page of a failure of the studio. */
export const ERROR = {
  '/src/routes/_error.tsx': failure,
}
