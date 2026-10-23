/**
 * A record of a collection.
 */

import type { RouteContext } from '../../../../../../app/context'
import { clientOf, readBody } from '../../../../../../app/context'
import { StudioError } from '../../../../../../app/errors'

export const GET = [
  async (c: RouteContext<'/w/:workspaceId/api/items/:collection/:id'>) => {
    const client = await clientOf(c)
    const record = await client.get(c.req.param('collection'), c.req.param('id'))
    return c.json({ data: record.row, etag: record.etag })
  },
]

export const PATCH = [
  async (c: RouteContext<'/w/:workspaceId/api/items/:collection/:id'>) => {
    const client = await clientOf(c)
    const body = await readBody(c)
    const etag = c.req.header('if-match')
    if (!etag) {
      throw new StudioError('INVALID_REQUEST', 'the validator of the record is required', {
        status: 400,
      })
    }
    const record = await client.update(c.req.param('collection'), c.req.param('id'), body, etag)
    return c.json({ data: record.row, etag: record.etag })
  },
]

export const DELETE = [
  async (c: RouteContext<'/w/:workspaceId/api/items/:collection/:id'>) => {
    const client = await clientOf(c)
    const etag = c.req.header('if-match')
    if (!etag) {
      throw new StudioError('INVALID_REQUEST', 'the validator of the record is required', {
        status: 400,
      })
    }
    await client.remove(c.req.param('collection'), c.req.param('id'), etag)
    return c.body(null, 204)
  },
]
