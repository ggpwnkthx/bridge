/**
 * One version of a record.
 *
 * The version is read with the policies of the deployment: a version
 * that the caller may not read answers `404`, and the fields that the
 * policies do not grant are not in the answer.
 */

import type { RouteContext } from '../../../../../../../../app/context'
import { clientOf } from '../../../../../../../../app/context'

export const GET = [
  async (c: RouteContext<'/w/:workspaceId/api/items/:collection/:id/versions/:version'>) => {
    const client = await clientOf(c)
    const version = Number(c.req.param('version'))
    if (!Number.isInteger(version) || version < 1) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'the version does not exist' } }, 404)
    }
    const record = await client.version(c.req.param('collection'), c.req.param('id'), version)
    return c.json({ data: record.row, etag: record.etag })
  },
]
