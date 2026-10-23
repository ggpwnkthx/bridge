/**
 * The metadata of a collection.
 */

import type { RouteContext } from '../../../../../app/context'
import { clientOf } from '../../../../../app/context'

export const GET = [
  async (c: RouteContext<'/w/:workspaceId/api/schema/:collection'>) => {
    const client = await clientOf(c)
    const collection = await client.collection(c.req.param('collection'))
    return c.json({ data: collection })
  },
]
