/**
 * The history of the versions of a record.
 *
 * The list holds the versions that are not the current one: the current
 * version of a record is the record itself. A collection that keeps no
 * history answers `404`, and the studio shows nothing.
 */

import type { RouteContext } from '../../../../../../../app/context'
import { clientOf } from '../../../../../../../app/context'

export const GET = [
  async (c: RouteContext<'/w/:workspaceId/api/items/:collection/:id/versions'>) => {
    const client = await clientOf(c)
    const versions = await client.versions(c.req.param('collection'), c.req.param('id'))
    return c.json({ data: versions })
  },
]
