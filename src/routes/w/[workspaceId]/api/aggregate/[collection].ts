/**
 * The aggregate of a collection.
 */

import type { RouteContext } from '../../../../../app/context'
import { clientOf } from '../../../../../app/context'
import { readAggregateQuery } from '../../../../../domains/studio/queries'

export const GET = [
  async (c: RouteContext<'/w/:workspaceId/api/aggregate/:collection'>) => {
    const client = await clientOf(c)
    const query = readAggregateQuery(new URL(c.req.url).searchParams)
    const result = await client.aggregate(c.req.param('collection'), query)
    return c.json({ data: result.data, meta: result.meta })
  },
]
