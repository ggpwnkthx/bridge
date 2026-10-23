/**
 * The client of the data backend (spec §6).
 *
 * The studio is a client of the backend, like any other client: it knows
 * the contract of v1 and nothing else. It never reaches the database, it
 * never reads a manifest and it never decides what a caller may do: the
 * metadata of the collections that the backend answers is already the
 * answer of the policies of the deployment.
 *
 * Every call goes through the **gateway**: the gateway signs the identity
 * of the caller and the backend verifies that signature. The studio holds
 * the token of the caller and it presents it as a bearer token, and it
 * never signs anything itself.
 */

/** The metadata of a field of a collection. */
export interface FieldMetadata {
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly nullable: boolean
  readonly maxLength?: number
  readonly minLength?: number
  readonly enum?: readonly string[]
  readonly minimum?: number
  readonly maximum?: number
  readonly label?: string
  readonly description?: string
}

/** The metadata of a relation of a collection. */
export interface RelationMetadata {
  readonly name: string
  readonly target: string
  readonly type: string
  readonly label?: string
  readonly description?: string
}

/** The metadata of a collection, for one caller. */
export interface CollectionMetadata {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly schemaVersion: string
  readonly actions: readonly string[]
  readonly readableFields: readonly string[]
  readonly writableFields: readonly string[]
  readonly filterableFields: readonly string[]
  readonly fields: readonly FieldMetadata[]
  readonly relations: readonly RelationMetadata[]
}

/** The metadata of the deployment, for one caller. */
export interface SchemaMetadata {
  readonly apiVersion: string
  readonly schemaVersion: string
  readonly policyBundleVersion: string
  readonly limits: {
    readonly maxLimit: number
    readonly defaultLimit: number
    readonly maxSelectedFields: number
    readonly maxSortFields: number
    readonly maxIncludes: number
  }
  readonly collections: readonly CollectionMetadata[]
}

/** A row of a collection. */
export type Row = Record<string, unknown> & { id: string; version: number }

/** A page of a collection. */
export interface Page {
  readonly data: readonly Row[]
  readonly meta: {
    readonly limit: number
    readonly nextCursor: string | null
    readonly count?: number
  }
}

/** One group of an aggregate. */
export interface AggregateGroup {
  readonly group: Record<string, unknown>
  readonly count: number
  readonly sum?: Record<string, string | null>
  readonly avg?: Record<string, string | null>
  readonly min?: Record<string, unknown>
  readonly max?: Record<string, unknown>
}

/** The answer of an aggregate. */
export interface AggregateResult {
  readonly data: readonly AggregateGroup[]
  readonly meta: { readonly limit: number; readonly groups: number; readonly truncated: boolean }
}

/** The identity of the caller, as the backend answers it. */
export interface CallerIdentity {
  readonly principalId: string
  readonly tenantId: string
  readonly workspaceId: string
  readonly routeId: string
  readonly apiVersion: string
}

/** The options of a list. */
export interface ListOptions {
  readonly fields?: readonly string[]
  readonly filter?: unknown
  readonly search?: string
  readonly sort?: readonly string[]
  readonly limit?: number
  readonly cursor?: string
  readonly include?: readonly string[]
  readonly includeCount?: boolean
}

/** The options of an aggregate. */
export interface AggregateOptions {
  readonly groupBy?: readonly string[]
  readonly metrics?: readonly string[]
  readonly filter?: unknown
  readonly search?: string
  readonly limit?: number
}

/** The error of the backend, as the studio sees it. */
export class BackendError extends Error {
  override readonly name = 'BackendError'
  /** The stable code of the error. */
  readonly code: string
  /** The status of the answer. */
  readonly status: number
  /** The identifier of the request, for the logs of the deployment. */
  readonly requestId: string
  /** The details of the error, when it carries some. */
  readonly details: readonly { field: string; code: string }[]

  constructor(options: {
    code: string
    message: string
    status: number
    requestId: string
    details?: readonly { field: string; code: string }[]
  }) {
    super(options.message)
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
    this.details = options.details ?? []
  }
}

/**
 * A refusal of the platform, as the studio reads it.
 *
 * Two services answer a refusal and they do not answer it in the same
 * shape: the backend answers an envelope — `{"error":{"code":"…",
 * "message":"…"},"requestId":"…"}` — and the gateway answers a flat
 * body — `{"error":"…","message":"…"}`. The studio reads both, and it
 * never invents a code that it did not read.
 */
export interface Refusal {
  readonly code: string
  readonly message: string
  readonly details: readonly { field: string; code: string }[]
  readonly requestId: string
}

/** Reads a refusal of the platform. */
export function refusalOf(body: unknown, response: Response): Refusal {
  const record = (body ?? {}) as {
    error?:
      | string
      | { code?: string; message?: string; details?: { field: string; code: string }[] }
    message?: string
    requestId?: string
  }
  const requestId =
    (typeof record.requestId === 'string' && record.requestId) ||
    response.headers.get('x-request-id') ||
    'unknown'
  // The envelope of the backend: the code is in `error.code`.
  if (record.error && typeof record.error === 'object') {
    return {
      code: record.error.code ?? 'UNKNOWN',
      message: record.error.message ?? 'the request failed',
      details: record.error.details ?? [],
      requestId,
    }
  }
  // The body of the gateway: the code is in `error`.
  if (typeof record.error === 'string' && record.error.length > 0) {
    return {
      code: record.error,
      message: record.message ?? 'the request failed',
      details: [],
      requestId,
    }
  }
  return {
    code: 'UNKNOWN',
    message: record.message ?? 'the request failed',
    details: [],
    requestId,
  }
}

/** The options of the client. */
export interface DepotClientOptions {
  /** The base url of the gateway. */
  readonly gatewayUrl: string
  /** The workspace of the calls. */
  readonly workspaceId: string
  /** The token of the caller, as the gateway expects it. */
  readonly accessToken: string
  /** The transport of the client. */
  readonly fetch?: typeof globalThis.fetch
}

/** The client of the data backend, through the gateway. */
export class DepotClient {
  readonly #options: DepotClientOptions

  constructor(options: DepotClientOptions) {
    this.#options = options
  }

  /** The prefix of the calls. */
  get #prefix(): string {
    return `${this.#options.gatewayUrl.replace(/\/+$/, '')}/ws/${this.#options.workspaceId}/v1`
  }

  /** The transport of the client. */
  get #fetch(): typeof globalThis.fetch {
    return this.#options.fetch ?? globalThis.fetch
  }

  /** Sends a request to the backend. */
  async #call<T>(
    path: string,
    options: {
      method?: string
      body?: unknown
      headers?: Record<string, string>
    } = {}
  ): Promise<{ body: T; status: number; headers: Headers }> {
    const headers = new Headers({
      accept: 'application/json',
      authorization: `Bearer ${this.#options.accessToken}`,
      ...(options.headers ?? {}),
    })
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    const response = await this.#fetch(`${this.#prefix}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
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
      const refusal = refusalOf(body, response)
      throw new BackendError({
        code: refusal.code,
        message: refusal.message,
        status: response.status,
        requestId: refusal.requestId,
        ...(refusal.details.length > 0 ? { details: refusal.details } : {}),
      })
    }
    return { body: body as T, status: response.status, headers: response.headers }
  }

  /** The identity of the caller in the workspace. */
  async me(): Promise<CallerIdentity> {
    const answer = await this.#call<{ data: CallerIdentity }>('/me')
    return answer.body.data
  }

  /** The metadata of the collections the caller may use. */
  async schema(): Promise<SchemaMetadata> {
    const answer = await this.#call<{ data: SchemaMetadata }>('/schema')
    return answer.body.data
  }

  /** The metadata of one collection. */
  async collection(key: string): Promise<CollectionMetadata> {
    const answer = await this.#call<{ data: CollectionMetadata }>(
      `/schema/${encodeURIComponent(key)}`
    )
    return answer.body.data
  }

  /** A page of a collection. */
  async list(key: string, options: ListOptions & { cursor?: string } = {}): Promise<Page> {
    const query = new URLSearchParams()
    if (options.fields?.length) query.set('fields', options.fields.join(','))
    if (options.filter !== undefined) query.set('filter', JSON.stringify(options.filter))
    if (options.search !== undefined) query.set('search', options.search)
    if (options.sort?.length) query.set('sort', options.sort.join(','))
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.cursor) query.set('cursor', options.cursor)
    if (options.include?.length) query.set('include', options.include.join(','))
    if (options.includeCount) query.set('include_count', 'true')
    const suffix = query.toString()
    const answer = await this.#call<{ data: Row[]; meta: Page['meta'] }>(
      `/items/${encodeURIComponent(key)}${suffix ? `?${suffix}` : ''}`
    )
    return { data: answer.body.data, meta: answer.body.meta }
  }

  /** One row, and the validator of it. */
  async get(key: string, id: string): Promise<{ row: Row; etag: string }> {
    const answer = await this.#call<{ data: Row }>(`/items/${encodeURIComponent(key)}/${id}`)
    return { row: answer.body.data, etag: answer.headers.get('etag') ?? '' }
  }

  /** Creates a row. */
  async create(key: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Row> {
    const answer = await this.#call<{ data: Row }>(`/items/${encodeURIComponent(key)}`, {
      method: 'POST',
      body,
      headers: { 'idempotency-key': idempotencyKey },
    })
    return answer.body.data
  }

  /** Updates a row. */
  async update(
    key: string,
    id: string,
    body: Record<string, unknown>,
    etag: string
  ): Promise<{ row: Row; etag: string }> {
    const answer = await this.#call<{ data: Row }>(`/items/${encodeURIComponent(key)}/${id}`, {
      method: 'PATCH',
      body,
      headers: { 'if-match': etag },
    })
    return { row: answer.body.data, etag: answer.headers.get('etag') ?? '' }
  }

  /** Deletes a row. */
  async remove(key: string, id: string, etag: string): Promise<void> {
    await this.#call(`/items/${encodeURIComponent(key)}/${id}`, {
      method: 'DELETE',
      headers: { 'if-match': etag },
    })
  }

  /** The groups of an aggregate. */
  async aggregate(key: string, options: AggregateOptions = {}): Promise<AggregateResult> {
    const query = new URLSearchParams()
    if (options.groupBy?.length) query.set('group_by', options.groupBy.join(','))
    if (options.metrics?.length) query.set('metrics', options.metrics.join(','))
    if (options.filter !== undefined) query.set('filter', JSON.stringify(options.filter))
    if (options.search !== undefined) query.set('search', options.search)
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    const suffix = query.toString()
    const answer = await this.#call<{ data: AggregateGroup[]; meta: AggregateResult['meta'] }>(
      `/aggregate/${encodeURIComponent(key)}${suffix ? `?${suffix}` : ''}`
    )
    return { data: answer.body.data, meta: answer.body.meta }
  }

  /** A page of the audit log of the workspace. */
  async audit(options: { limit?: number; cursor?: string } = {}): Promise<{
    data: readonly Record<string, unknown>[]
    meta: { limit: number; nextCursor: string | null }
  }> {
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.cursor) query.set('cursor', options.cursor)
    const suffix = query.toString()
    const answer = await this.#call<{
      data: Record<string, unknown>[]
      meta: { limit: number; nextCursor: string | null }
    }>(`/audit${suffix ? `?${suffix}` : ''}`)
    return answer.body
  }
}
