/**
 * The tests of the refusals of the platform, as the studio reads them.
 *
 * Two services answer a refusal and they do not answer it in the same
 * shape: the backend answers an envelope and the gateway answers a flat
 * body. The studio reads both, and it never invents a code it did not
 * read.
 */

import { describe, expect, test } from 'bun:test'
import { refusalOf } from '../../src/domains/studio/depot'

/** An answer of a service of the platform. */
function answer(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

describe('the refusals of the platform', () => {
  test('it reads the envelope of the backend', () => {
    const refusal = refusalOf(
      {
        error: { code: 'NOT_FOUND', message: 'the collection does not exist' },
        requestId: 'the-request-of-the-backend',
      },
      answer({}, 404)
    )
    expect(refusal.code).toBe('NOT_FOUND')
    expect(refusal.message).toBe('the collection does not exist')
    expect(refusal.requestId).toBe('the-request-of-the-backend')
  })

  test('it reads the details of the envelope of the backend', () => {
    const refusal = refusalOf(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'the body is not valid',
          details: [{ field: 'title', code: 'REQUIRED' }],
        },
        requestId: 'the-request-of-the-backend',
      },
      answer({}, 422)
    )
    expect(refusal.details).toEqual([{ field: 'title', code: 'REQUIRED' }])
  })

  test('it reads the body of the gateway', () => {
    const refusal = refusalOf(
      { error: 'unauthorized', message: 'authentication is required' },
      answer({}, 401, { 'x-request-id': 'the-request-of-the-gateway' })
    )
    expect(refusal.code).toBe('unauthorized')
    expect(refusal.message).toBe('authentication is required')
    expect(refusal.requestId).toBe('the-request-of-the-gateway')
  })

  test('it reads a body that says nothing', () => {
    const refusal = refusalOf({}, answer({}, 500))
    expect(refusal.code).toBe('UNKNOWN')
    expect(refusal.message).toBe('the request failed')
    expect(refusal.requestId).toBe('unknown')
  })

  test('it reads a body that is not json', () => {
    const response = new Response('not json', { status: 502 })
    const refusal = refusalOf('not json', response)
    expect(refusal.code).toBe('UNKNOWN')
    expect(refusal.requestId).toBe('unknown')
  })
})
