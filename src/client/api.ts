/**
 * The client of the api of the studio.
 *
 * The script of the browser talks to the studio and never to the backend:
 * the token of the caller stays on the server, and the studio is the only
 * thing that knows the gateway. Every change of the state carries the
 * token of the session, so a request that did not come from the studio
 * itself is refused.
 */

/** The error of the api of the studio. */
export class ApiError extends Error {
  override readonly name = 'ApiError'
  /** The stable code of the error. */
  readonly code: string
  /** The identifier of the request, for the logs of the deployment. */
  readonly requestId: string

  constructor(code: string, message: string, requestId: string) {
    super(message)
    this.code = code
    this.requestId = requestId
  }
}

/** The client of the api of the studio. */
export class Api {
  readonly #base: string
  #csrf = ''

  constructor(workspace: string) {
    this.#base = `/w/${workspace}/api`
  }

  /** The token of the session, for the changes of the state. */
  setCsrf(token: string): void {
    this.#csrf = token
  }

  /** Reads a resource. */
  async get<T>(path: string): Promise<T> {
    return this.#call<T>(path, { method: 'GET' })
  }

  /** Writes a resource. */
  async send<T>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options: { idempotencyKey?: string; etag?: string } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey
    if (options.etag) headers['if-match'] = options.etag
    return this.#call<T>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    })
  }

  /**
   * Sends a request to a path of the studio itself.
   *
   * The paths of the api of the studio are relative to the workspace, and
   * the paths of the studio itself are not.
   */
  async absolute<T>(path: string, method: 'POST' | 'GET' = 'POST'): Promise<T> {
    return this.#call<T>(path, { method }, true)
  }

  /** Sends a request to the studio. */
  async #call<T>(path: string, init: RequestInit, absolute = false): Promise<T> {
    const headers = new Headers({ accept: 'application/json' })
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    if (init.method && init.method !== 'GET') headers.set('x-bridge-csrf', this.#csrf)
    for (const [name, value] of Object.entries((init.headers as Record<string, string>) ?? {})) {
      headers.set(name, value)
    }
    const response = await fetch(absolute ? path : `${this.#base}${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
    })
    const text = await response.text()
    let body: unknown = null
    if (text.length > 0) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    if (!response.ok) {
      const envelope = (body ?? {}) as {
        error?: { code?: string; message?: string }
        requestId?: string
      }
      throw new ApiError(
        envelope.error?.code ?? 'UNKNOWN',
        envelope.error?.message ?? 'the request failed',
        envelope.requestId ?? 'unknown'
      )
    }
    return body as T
  }
}
