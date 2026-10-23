/**
 * The probes of the deployment.
 *
 * The probes answer when the deployment gave the studio the right to
 * answer them: a studio that is not probed does not answer.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../app/context'

/** The answer of the probe of the liveness. */
const handler = async (c: Context<AppEnv>): Promise<Response> => {
  if (!c.get('runtime').config.probes) return c.notFound()
  return c.json({ status: 'ok', service: 'bridge', version: '0.1.0' })
}

export default handler
