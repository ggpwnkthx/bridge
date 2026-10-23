/**
 * The application of the studio.
 *
 * The routes of the studio are the files of `src/routes`, and honox
 * reads them: the path of a route is the path of its file, and the
 * files of a directory hold the renderer, the middleware, the page of a
 * failure and the page of a path that does not exist.
 *
 * The dependencies of the studio are given when the application is
 * built: the middleware puts them in the context of the request, and
 * the routes read them from there. A test builds the studio with the
 * dependencies it needs.
 */

import { createApp } from 'honox/server'
import type { Hono } from 'hono'
import type { AppDependencies, AppEnv } from './app/context'
import { ERROR, MIDDLEWARE, NOT_FOUND, RENDERER, ROUTES } from './routes/registry'

/** Builds the studio. */
export function createStudioApp(dependencies: AppDependencies): Hono<AppEnv> {
  return createApp<AppEnv>({
    root: '/src/routes',
    ROUTES,
    RENDERER,
    MIDDLEWARE,
    NOT_FOUND,
    ERROR,
    init: (app) => {
      // The dependencies of the studio are in the context of every
      // request: the routes read them from there.
      app.use('*', async (c, next) => {
        c.set('runtime', dependencies)
        await next()
      })
    },
  })
}
