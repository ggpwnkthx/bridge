/**
 * The first page of the studio.
 *
 * The studio serves the workspaces of the deployment: the first one
 * answers at the root, and the browser lands on the studio itself.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../app/context'

/** The first workspace of the deployment. */
const handler = async (c: Context<AppEnv>): Promise<Response> => {
  const workspace = c.get('runtime').config.workspaces[0]
  if (workspace) return c.redirect(`/w/${workspace}`, 302)
  return c.redirect('/login', 302)
}

export default handler
