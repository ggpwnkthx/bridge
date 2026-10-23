/**
 * The middleware of the studio.
 *
 * Every request of the studio carries an identifier: it is given back
 * to the caller, and it is written in the logs of the deployment. The
 * identifier of the gateway is kept when there is one, so the logs of
 * the studio and the logs of the gateway can be read together.
 */

import type { Context, Next } from 'hono'
import type { AppEnv } from '../app/context'

/** The identifier of a request, and the log of its answer. */
async function requestId(c: Context<AppEnv>, next: Next): Promise<void> {
  const runtime = c.get('runtime')
  const id = c.req.header('x-request-id') ?? crypto.randomUUID()
  c.set('requestId', id)
  c.header('x-request-id', id)
  const started = Date.now()
  try {
    await next()
  } finally {
    runtime.logger.info('the request was answered', {
      requestId: id,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs: Date.now() - started,
    })
  }
}

export default [requestId]
