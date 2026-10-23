/**
 * The metadata of the deployment.
 *
 * The metadata is the answer of the policies of the deployment: the
 * collections the caller may use, and the fields it may write.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../../../../app/context'
import { clientOf } from '../../../../app/context'

export const GET = [
  async (c: Context<AppEnv>) => {
    const client = await clientOf(c)
    const schema = await client.schema()
    return c.json({ data: schema })
  },
]
