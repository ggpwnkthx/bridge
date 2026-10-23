/**
 * The context of the studio.
 *
 * The components of the studio share the state of the studio: the
 * session of the caller, the metadata of the deployment, the collection
 * that is shown and the query that is written. The context holds them,
 * and the components read them.
 */

import { createContext } from 'preact/compat'
import { useContext } from 'preact/hooks'
import type { Api } from '../client/api'
import type { CollectionMetadata, SchemaMetadata, SessionInfo } from '../client/types'

/** The views of the studio. */
export type View = 'data' | 'aggregate' | 'audit'

/** The query of a collection. */
export interface Query {
  /** What the studio looks for in the rows. */
  search: string
  /** The fields the rows are sorted by. */
  sort: string
  /** The filter of the rows, as a json document. */
  filter: string
  /** The number of rows of a page. */
  limit: number
}

/** The query of an aggregate. */
export interface AggregateQuery {
  /** The fields the rows are grouped by. */
  groupBy: string
  /** The metrics of the groups. */
  metrics: string
  /** The filter of the rows, as a json document. */
  filter: string
}

/** What the components of the studio share. */
export interface StudioContextValue {
  /** The client of the api of the studio. */
  api: Api
  /** The workspace of the studio. */
  workspace: string
  /** The session of the caller. */
  session: SessionInfo | null
  /** The metadata of the deployment. */
  schema: SchemaMetadata | null
  /** The collection that is shown. */
  collection: CollectionMetadata | null
  /** The view that is open. */
  view: View
  /** The query that is written. */
  draft: Query
  /** The query that is run. */
  query: Query
  /** Changes the query that is written. */
  write: (patch: Partial<Query>) => void
  /** Runs the query that is written. */
  run: () => void
  /** The cursor of the page that is shown. */
  cursor: string | null
  /** The stack of the cursors of the pages that were shown. */
  cursors: (string | null)[]
  /** Goes to the next page, or to the previous one. */
  page: (direction: 'next' | 'previous', next?: string | null) => void
  /** The query of the aggregate that is written. */
  aggregate: AggregateQuery
  /** Changes the query of the aggregate that is written. */
  writeAggregate: (patch: Partial<AggregateQuery>) => void
  /** Runs the aggregate that is written. */
  runAggregate: () => void
  /** The number of the runs of the aggregate: a run that comes later wins. */
  readonly aggregateRun: number
  /** Shows a collection. */
  select: (key: string) => void
  /** Shows a view of the studio. */
  show: (view: View) => void
  /** Opens the drawer of a record. */
  open: (key: string, id: string | null) => void
  /** Shows a message. */
  toast: (message: string, kind?: 'ok' | 'error') => void
  /** Asks the view that is open to read its rows again. */
  refresh: () => void
  /** The number of the reads: a view reads its rows again when it grows. */
  readonly revision: number
}

/** The context of the studio. */
export const StudioContext = createContext<StudioContextValue | null>(null)

/** The state of the studio, as the components see it. */
export function useStudio(): StudioContextValue {
  const studio = useContext(StudioContext)
  if (!studio) throw new Error('the studio is not there')
  return studio
}
