/**
 * The readiness of the studio.
 *
 * The studio is ready when it can answer: it holds no state of the
 * backend, and it needs no migration of its own.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../app/context'

/** The answer of the probe of the readiness. */
const handler = async (c: Context<AppEnv>): Promise<Response> => {
  if (!c.get('runtime').config.probes) return c.notFound()
  return c.json({ status: 'ready' })
}

export default handler
