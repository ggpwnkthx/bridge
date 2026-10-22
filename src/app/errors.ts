/**
 * The answers of the studio (spec §8).
 *
 * The studio answers with the same shape as the backend: an answer of a
 * success carries its data, and an answer of a failure carries the code
 * of the error, a message and the identifier of the request. The code is
 * the stable part: the user interface switches on it and never on the
 * message.
 */

/** The envelope of an answer of the studio. */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: readonly { field: string; code: string }[]
  }
  readonly requestId: string
}

/** The error of the studio. */
export class StudioError extends Error {
  override readonly name = 'StudioError'
  /** The code of the failure. */
  readonly code: string
  /** The status of the answer. */
  readonly status: number
  /** The details of the failure. */
  readonly details?: readonly { field: string; code: string }[]

  constructor(
    code: string,
    message: string,
    options: { status?: number; details?: readonly { field: string; code: string }[] } = {}
  ) {
    super(message)
    this.code = code
    this.status = options.status ?? 400
    if (options.details) this.details = options.details
  }
}

/** The envelope of a failure. */
export function errorEnvelope(error: StudioError, requestId: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    requestId,
  }
}
