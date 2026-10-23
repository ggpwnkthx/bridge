/**
 * The path that does not exist.
 *
 * The api of the studio answers with the envelope of a failure, and a
 * page answers with a page: the caller of the api is a program, and the
 * caller of a page is a person.
 */

import type { Context, NotFoundHandler } from 'hono'
import { errorEnvelope, StudioError } from '../app/errors'
import type { AppEnv } from '../app/context'
import { NotFoundPage } from '../components/error-page'
import { wantsJson } from './_error'

const handler: NotFoundHandler = (c) => {
  const context = c as Context<AppEnv>
  const requestId = context.get('requestId') ?? 'unknown'
  if (wantsJson(context)) {
    return context.json(
      errorEnvelope(
        new StudioError('NOT_FOUND', 'this path does not exist', { status: 404 }),
        requestId
      ),
      404
    )
  }
  return context.render(<NotFoundPage />)
}

export default handler
