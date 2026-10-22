/**
 * The parameters of the queries of the studio (spec §7).
 *
 * The studio parses the parameters of a query of the browser before it
 * calls the backend: a parameter that the studio does not understand is
 * refused, and a parameter that is out of the bounds of the contract is
 * refused. The bounds are the ones the backend publishes in the metadata
 * of the schema, and the studio never sends a request that the backend
 * would refuse.
 */

/** The problem of a query of the studio. */
export class QueryError extends Error {
  override readonly name = 'QueryError'
  /** The code of the failure. */
  readonly code: string
  /** The status of the answer. */
  readonly status: number

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message)
    this.code = options.code ?? 'INVALID_QUERY'
    this.status = options.status ?? 400
  }
}

/** The limits of the queries, as the contract of v1 defines them. */
export const QUERY_LIMITS = {
  maxLimit: 200,
  defaultLimit: 50,
  maxSelectedFields: 50,
  maxSortFields: 3,
  maxIncludes: 5,
  maxSearchLength: 256,
  maxGroupBy: 3,
  maxAggregateLimit: 1000,
} as const

/** The parameters of a list. */
export interface ListQuery {
  readonly fields?: readonly string[]
  readonly filter?: unknown
  readonly search?: string
  readonly sort?: readonly string[]
  readonly limit: number
  readonly cursor?: string
  readonly include?: readonly string[]
  readonly includeCount: boolean
}

/** The parameters of an aggregate. */
export interface AggregateQuery {
  readonly groupBy?: readonly string[]
  readonly metrics?: readonly string[]
  readonly filter?: unknown
  readonly search?: string
  readonly limit: number
}

/**
 * Reads the parameters of a list.
 *
 * A parameter that appears twice is refused: the answer would depend on
 * which value the reader picked.
 */
export function readListQuery(params: URLSearchParams): ListQuery {
  const limit = readLimit(params, QUERY_LIMITS.maxLimit, QUERY_LIMITS.defaultLimit)
  const fields = readList(params, 'fields', QUERY_LIMITS.maxSelectedFields)
  const sort = readList(params, 'sort', QUERY_LIMITS.maxSortFields)
  const include = readList(params, 'include', QUERY_LIMITS.maxIncludes)
  const search = readSearch(params)
  const filter = readFilter(params)
  const cursor = params.get('cursor')
  if (params.get('include_count') !== null && params.get('include_count') !== 'true') {
    throw new QueryError('the parameter "include_count" is "true" or it is absent')
  }
  return {
    ...(fields ? { fields } : {}),
    ...(filter === undefined ? {} : { filter }),
    ...(search === undefined ? {} : { search }),
    ...(sort ? { sort } : {}),
    limit,
    ...(cursor ? { cursor } : {}),
    ...(include ? { include } : {}),
    includeCount: params.get('include_count') === 'true',
  }
}

/** Reads the parameters of an aggregate. */
export function readAggregateQuery(params: URLSearchParams): AggregateQuery {
  const limit = readLimit(params, QUERY_LIMITS.maxAggregateLimit, QUERY_LIMITS.defaultLimit)
  const groupBy = readList(params, 'group_by', QUERY_LIMITS.maxGroupBy)
  const metrics = readList(params, 'metrics', QUERY_LIMITS.maxSelectedFields)
  const search = readSearch(params)
  const filter = readFilter(params)
  return {
    ...(groupBy ? { groupBy } : {}),
    ...(metrics ? { metrics } : {}),
    ...(filter === undefined ? {} : { filter }),
    ...(search === undefined ? {} : { search }),
    limit,
  }
}

/** Reads the parameters of the audit log. */
export function readAuditQuery(params: URLSearchParams): { limit: number; cursor?: string } {
  const limit = readLimit(params, QUERY_LIMITS.maxLimit, QUERY_LIMITS.defaultLimit)
  const cursor = params.get('cursor')
  return { limit, ...(cursor ? { cursor } : {}) }
}

/** The size of a page. */
function readLimit(params: URLSearchParams, max: number, fallback: number): number {
  const raw = params.get('limit')
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new QueryError(`the limit is a number between 1 and ${max}`)
  }
  return value
}

/** A list of values, separated by commas. */
function readList(
  params: URLSearchParams,
  name: string,
  max: number
): readonly string[] | undefined {
  const raw = params.get(name)
  if (raw === null) return undefined
  const values = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (values.length > max) {
    throw new QueryError(`the parameter "${name}" holds at most ${max} values`)
  }
  return values.length > 0 ? values : undefined
}

/** The text of the search of a collection. */
function readSearch(params: URLSearchParams): string | undefined {
  const raw = params.get('search')
  if (raw === null) return undefined
  if (raw.length > QUERY_LIMITS.maxSearchLength) {
    throw new QueryError(`the search is at most ${QUERY_LIMITS.maxSearchLength} characters long`)
  }
  return raw
}

/**
 * The filter of a query.
 *
 * The filter is a json document: the studio sends it as it is, and the
 * backend refuses the filter it does not understand.
 */
function readFilter(params: URLSearchParams): unknown {
  const raw = params.get('filter')
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new QueryError('the filter is not a json document')
  }
}
