/**
 * The end of the session of the caller.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../app/context'
import {
  parseCookies,
  SESSION_COOKIE_NAME,
  sessionDeletionCookie,
} from '../domains/identity/cookies'

export const POST = [
  async (c: Context<AppEnv>) => {
    const dependencies = c.get('runtime')
    const cookies = parseCookies(c.req.header('cookie'))
    const session = cookies.get(SESSION_COOKIE_NAME)
    if (session) dependencies.sessions.delete(session)
    c.header('set-cookie', sessionDeletionCookie({ secure: dependencies.config.secureCookies }))
    return c.body(null, 204)
  },
]
