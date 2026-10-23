/**
 * The rollback of a record to one of its versions.
 *
 * The rollback is a write and not a privileged command: the version is
 * read with the policies of the deployment and the write that restores
 * it is authorized by the same policies as any other update. The version
 * of the record never moves back: the record holds the version that
 * follows the one it had.
 */

import type { RouteContext } from '../../../../../../../app/context'
import { clientOf, readBody } from '../../../../../../../app/context'
import { StudioError } from '../../../../../../../app/errors'

export const POST = [
  async (c: RouteContext<'/w/:workspaceId/api/items/:collection/:id/rollback'>) => {
    const client = await clientOf(c)
    const body = await readBody(c)
    const version = body.version
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new StudioError('INVALID_REQUEST', 'the version is required and it is a whole number', {
        status: 400,
      })
    }
    const etag = c.req.header('if-match')
    if (!etag) {
      throw new StudioError('INVALID_REQUEST', 'the validator of the record is required', {
        status: 400,
      })
    }
    const record = await client.rollback(
      c.req.param('collection'),
      c.req.param('id'),
      version,
      etag
    )
    return c.json({ data: record.row, etag: record.etag })
  },
]
