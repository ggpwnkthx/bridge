/**
 * The assets of the user interface.
 *
 * The studio serves the script of the browser and the styles of the
 * studio: both are built before the studio starts, and both are read
 * from the disk.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../../app/context'

/** A file of the assets of the user interface. */
const handler = async (c: Context<AppEnv>): Promise<Response> => {
  const path = c.req.path.replace(/^\//, '')
  const file = await c.get('runtime').assets.file(path)
  if (!file) return c.notFound()
  return new Response(file.body, {
    status: 200,
    headers: {
      'content-type': file.contentType,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  })
}

export default handler
