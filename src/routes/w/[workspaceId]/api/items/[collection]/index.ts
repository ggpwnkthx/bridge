/**
 * The rows of a collection.
 */

import type { RouteContext } from '../../../../../../app/context'
import { clientOf, idempotencyKeyOf, readBody } from '../../../../../../app/context'
import { readListQuery } from '../../../../../../domains/studio/queries'

export const GET = [
  async (c: RouteContext<'/w/:workspaceId/api/items/:collection'>) => {
    const client = await clientOf(c)
    const query = readListQuery(new URL(c.req.url).searchParams)
    const page = await client.list(c.req.param('collection'), query)
    return c.json({ data: page.data, meta: page.meta })
  },
]

export const POST = [
  async (c: RouteContext<'/w/:workspaceId/api/items/:collection'>) => {
    const client = await clientOf(c)
    const body = await readBody(c)
    const idempotencyKey = idempotencyKeyOf(c)
    const receipt = await client.create(c.req.param('collection'), body, idempotencyKey)
    return c.json({ data: receipt }, 201)
  },
]
