/**
 * The studio of a workspace.
 *
 * The page holds the studio itself: the frame is rendered by the server,
 * and the script of the browser takes it over when it answers.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../../../app/context'
import { workspaceOf } from '../../../app/context'
import { Studio } from '../../../components/studio'

/** The studio of a workspace. */
const handler = async (c: Context<AppEnv>): Promise<Response> => {
  const workspace = workspaceOf(c)
  return c.render(
    <div id="studio" data-workspace={workspace}>
      <Studio workspace={workspace} />
    </div>
  )
}

export default handler
