/**
 * The audit log of the workspace.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../../../../app/context'
import { clientOf } from '../../../../app/context'
import { readAuditQuery } from '../../../../domains/studio/queries'

export const GET = [
  async (c: Context<AppEnv>) => {
    const client = await clientOf(c)
    const query = readAuditQuery(new URL(c.req.url).searchParams)
    const page = await client.audit(query)
    return c.json({ data: page.data, meta: page.meta })
  },
]
