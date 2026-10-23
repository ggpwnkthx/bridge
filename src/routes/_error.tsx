/**
 * The failures of the studio.
 *
 * A failure of the api is an envelope: the code of the error, a message
 * and the identifier of the request. A failure of a page is a page: the
 * studio shows what happened, in the words of a person, and it keeps
 * the code of the backend.
 */

import type { Context, ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { StudioError, errorEnvelope } from '../app/errors'
import type { AppEnv } from '../app/context'
import { BackendError } from '../domains/studio/depot'
import { QueryError } from '../domains/studio/queries'
import { ErrorPage } from '../components/error-page'

/**
 * Whether a request wants the answer of the program.
 *
 * The api of the studio and the assets of the user interface are read
 * by a program: they answer with the envelope of a failure. The pages
 * are read by a person: they answer with a page.
 */
export function wantsJson(c: Context<AppEnv>): boolean {
  const path = c.req.path
  return path.includes('/api/') || path.startsWith('/static/')
}

/** The answer of a failure of the api. */
function answerOf(error: unknown, c: Context<AppEnv>): Response {
  const requestId = c.get('requestId') ?? 'unknown'
  if (error instanceof StudioError) {
    return c.json(errorEnvelope(error, requestId), error.status as ContentfulStatusCode)
  }
  if (error instanceof BackendError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details.length > 0 ? { details: error.details } : {}),
        },
        requestId: error.requestId,
      },
      error.status as ContentfulStatusCode
    )
  }
  if (error instanceof QueryError) {
    return c.json(errorEnvelope(new StudioError('INVALID_QUERY', error.message), requestId), 400)
  }
  c.get('runtime').logger.error('the request could not be completed', {
    requestId,
    error: error instanceof Error ? error.message : 'unknown error',
  })
  return c.json(
    errorEnvelope(
      new StudioError('INTERNAL_ERROR', 'the request could not be completed', { status: 500 }),
      requestId
    ),
    500
  )
}

/** The failure of a request of the studio. */
const handler: ErrorHandler = (error, c) => {
  const context = c as Context<AppEnv>
  if (wantsJson(context)) return answerOf(error, context)
  const requestId = context.get('requestId') ?? 'unknown'
  const code =
    error instanceof StudioError
      ? error.code
      : error instanceof BackendError
        ? error.code
        : error instanceof QueryError
          ? 'INVALID_QUERY'
          : 'INTERNAL_ERROR'
  const message =
    error instanceof StudioError || error instanceof BackendError || error instanceof QueryError
      ? error.message
      : 'the request could not be completed'
  context.status((error instanceof StudioError ? error.status : 500) as ContentfulStatusCode)
  return context.render(<ErrorPage code={code} message={message} requestId={requestId} />)
}

export default handler
