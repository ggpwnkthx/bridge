/**
 * The views of the studio.
 *
 * The studio has three views: the rows of a collection, the aggregate of
 * a collection and the audit log of the workspace. Each of them reads
 * its own rows, and each of them shows the refusal of the backend as it
 * is.
 */

import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import {
  cellValue,
  columnLabel,
  columnsOf,
  fieldMeta,
  formatMoment,
  isEmpty,
  plural,
  renderValue,
} from '../client/format'
import type { Aggregate, AuditPage, CollectionMetadata, Page, Row } from '../client/types'
import { useStudio } from './context'
import { Notice } from './notice'

/**
 * The rows of the collection, with the toolbar of the query.
 *
 * The toolbar is written before the rows are read, and the rows are read
 * again when the query is run, when the page changes and when a record
 * was written.
 */
export function RowsView(): JSX.Element | null {
  const studio = useStudio()
  const collection = studio.collection
  const [page, setPage] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<unknown>(null)

  useEffect(() => {
    if (!collection) return
    let live = true
    const params = new URLSearchParams()
    params.set('limit', String(studio.query.limit))
    const search = studio.query.search.trim()
    if (search) params.set('search', search)
    const sort = studio.query.sort.trim()
    if (sort) params.set('sort', sort)
    const filter = studio.query.filter.trim()
    if (filter) params.set('filter', filter)
    if (studio.cursor) params.set('cursor', studio.cursor)
    setLoading(true)
    studio.api
      .get<Page>(`/items/${encodeURIComponent(collection.key)}?${params.toString()}`)
      .then((answer) => {
        if (!live) return
        setPage(answer)
        setFailure(null)
      })
      .catch((error: unknown) => {
        if (!live) return
        setFailure(error)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [studio.api, studio.query, studio.cursor, studio.revision, collection?.key])

  if (!collection) return null
  const rows = page?.data ?? []
  const meta = page?.meta ?? { limit: studio.query.limit, nextCursor: null }
  return (
    <>
      <Toolbar collection={collection} loading={loading} />
      <p class="collection-description">{collection.description}</p>
      <div class="results-table" aria-busy={loading ? 'true' : undefined}>
        {loading ? (
          <div class="loading">Loading the rows of {collection.label}.</div>
        ) : failure ? (
          <Notice error={failure} retry={() => studio.refresh()} />
        ) : (
          <Table
            collection={collection}
            rows={rows}
            searching={
              studio.query.search.trim().length > 0 || studio.query.filter.trim().length > 0
            }
            open={(id) => studio.open(collection.key, id)}
            create={() => studio.open(collection.key, null)}
          />
        )}
      </div>
      <div class="pager">
        <button
          class="ghost"
          type="button"
          disabled={studio.cursors.length === 0}
          onClick={() => studio.page('previous')}
        >
          Previous
        </button>
        <button
          class="ghost"
          type="button"
          disabled={!meta.nextCursor}
          onClick={() => studio.page('next', meta.nextCursor)}
        >
          Next
        </button>
        <span>
          {meta.count !== undefined
            ? `${plural(rows.length, 'row')} of ${new Intl.NumberFormat().format(meta.count)}`
            : plural(rows.length, 'row')}
        </span>
      </div>
    </>
  )
}

/**
 * The toolbar of the query of a collection.
 *
 * The toolbar is kept while the collection does not change, so the
 * caller does not lose the focus of the field he is writing in when the
 * rows answer again.
 */
function Toolbar(props: { collection: CollectionMetadata; loading: boolean }): JSX.Element {
  const studio = useStudio()
  const collection = props.collection
  const draft = studio.draft
  return (
    <div class="toolbar">
      <h1 tabindex={-1}>{collection.label}</h1>
      <label class="toolbar-label" for="query-search">
        Search
      </label>
      <input
        id="query-search"
        type="search"
        placeholder={`in ${collection.label}`}
        value={draft.search}
        onInput={(event) => studio.write({ search: event.currentTarget.value })}
      />
      <label class="toolbar-label" for="query-sort">
        Sort
      </label>
      <input
        id="query-sort"
        type="text"
        placeholder="title, -createdAt"
        value={draft.sort}
        onInput={(event) => studio.write({ sort: event.currentTarget.value })}
      />
      <button class="primary" type="button" disabled={props.loading} onClick={() => studio.run()}>
        Run
      </button>
      <span class="spacer" />
      {collection.actions.includes('create') ? (
        <button class="ghost" type="button" onClick={() => studio.open(collection.key, null)}>
          New record
        </button>
      ) : null}
      <details class="advanced">
        <summary>The filter and the page size</summary>
        <div class="advanced-body">
          <p class="hint">
            The search looks in the fields of the row. The sort takes a field, and a minus for
            descending: title, -createdAt. The filter is a json document, for example
            {'{"status":{"_eq":"published"}}'}.
          </p>
          <label class="toolbar-label" for="query-filter">
            Filter (json)
          </label>
          <textarea
            id="query-filter"
            value={draft.filter}
            placeholder={'{"status":{"_eq":"published"}}'}
            onInput={(event) => studio.write({ filter: event.currentTarget.value })}
          />
          <label class="toolbar-label" for="query-limit">
            Rows per page
          </label>
          <input
            id="query-limit"
            type="number"
            value={String(draft.limit)}
            min="1"
            max={String(studio.schema?.limits.maxLimit ?? 200)}
            onInput={(event) => studio.write({ limit: Number(event.currentTarget.value) || 50 })}
          />
        </div>
      </details>
    </div>
  )
}

/** The table of the rows. */
function Table(props: {
  collection: CollectionMetadata
  rows: Row[]
  searching: boolean
  open: (id: string) => void
  create: () => void
}): JSX.Element {
  const { collection, rows } = props
  const columns = columnsOf(collection)
  const identity = columns[0] ?? 'id'
  const hasIdColumn = columns.includes('id')
  // A column of moments is given the room it needs: the moment is read
  // in the table, and the text of the backend is in the tooltip.
  const isMomentColumn = (field: string): boolean => {
    const type = fieldMeta(collection, field)?.type
    if (type === 'date' || type === 'timestamp') return true
    return rows.some((row) => formatMoment(row[field]) !== null)
  }
  const header = (
    <tr>
      {columns.map((field) => (
        <th
          key={field}
          scope="col"
          title={field}
          style={
            field === identity ? 'width: 240px' : isMomentColumn(field) ? 'width: 126px' : undefined
          }
        >
          {columnLabel(collection, field)}
        </th>
      ))}
    </tr>
  )
  const body =
    rows.length > 0
      ? rows.map((row, index) => {
          const id = String(row.id ?? '')
          const cells = columns.map((field, position) => {
            const value = row[field]
            const isNull = isEmpty(value)
            const { text, title } = cellValue(collection, field, value)
            const classes = isNull ? 'null' : field === 'id' ? 'mono' : ''
            // The first cell of the row opens the record with the
            // keyboard, and the whole row opens it with the mouse.
            if (position === 0) {
              return (
                <td class={classes} key={field}>
                  <button
                    class="row-open"
                    type="button"
                    title={title ?? text}
                    onClick={(event) => {
                      event.stopPropagation()
                      props.open(id)
                    }}
                  >
                    <span class="row-title">{text}</span>
                    {/* The identifier of the record is written under the
                    name of the record: the caller reads the row and
                    knows which record it is. */}
                    {identity !== 'id' && !hasIdColumn && id ? (
                      <span class="row-id">{id}</span>
                    ) : null}
                    <span class="visually-hidden">, open the record of {collection.label}</span>
                  </button>
                </td>
              )
            }
            return (
              <td class={classes} key={field} title={title ?? undefined}>
                {text}
              </td>
            )
          })
          return (
            <tr key={id || index} onClick={() => props.open(id)}>
              {cells}
            </tr>
          )
        })
      : [
          <tr key="empty">
            <td class="empty" colspan={columns.length}>
              <strong>
                {props.searching ? 'No row matches this query.' : 'This collection has no row.'}
              </strong>
              {props.searching
                ? 'Change the search or the filter of the query.'
                : 'A record of this collection can be created here.'}
              {/* A record does not fix a query that matches nothing: the
              button belongs to the collection that has no row. */}
              {collection.actions.includes('create') && !props.searching ? (
                <div class="notice-actions">
                  <button class="ghost" type="button" onClick={props.create}>
                    New record
                  </button>
                </div>
              ) : null}
            </td>
          </tr>,
        ]
  return (
    <div class="table-wrap">
      <table>
        <caption class="visually-hidden">The rows of {collection.label}</caption>
        <thead>{header}</thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  )
}

/**
 * The view of the aggregate of a collection.
 *
 * The aggregate groups the rows that share the same values and counts
 * them. The metrics take count, sum:amount, avg:amount, min:amount,
 * max:amount.
 */
export function AggregateView(): JSX.Element {
  const studio = useStudio()
  const collection = studio.collection
  const [answer, setAnswer] = useState<Aggregate | null>(null)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)

  useEffect(() => {
    if (!collection) return
    if (studio.aggregate.groupBy.trim().length === 0) return
    let live = true
    const params = new URLSearchParams()
    if (studio.aggregate.groupBy.trim()) params.set('group_by', studio.aggregate.groupBy.trim())
    if (studio.aggregate.metrics.trim()) params.set('metrics', studio.aggregate.metrics.trim())
    if (studio.aggregate.filter.trim()) params.set('filter', studio.aggregate.filter.trim())
    setLoading(true)
    studio.api
      .get<Aggregate>(`/aggregate/${encodeURIComponent(collection.key)}?${params.toString()}`)
      .then((result) => {
        if (!live) return
        setAnswer(result)
        setFailure(null)
      })
      .catch((error: unknown) => {
        if (!live) return
        setFailure(error)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [studio.api, studio.aggregate, studio.aggregateRun, collection?.key])

  if (!collection) {
    return <div class="notice">Choose a collection first.</div>
  }
  const groups = answer?.data ?? []
  const columns = Object.keys(groups[0]?.group ?? {})
  return (
    <>
      <div class="toolbar">
        <h1 tabindex={-1}>Aggregate of {collection.label}</h1>
        <label class="toolbar-label" for="aggregate-group">
          Group by
        </label>
        <input
          id="aggregate-group"
          type="text"
          placeholder="status, author"
          value={studio.aggregate.groupBy}
          onInput={(event) => studio.writeAggregate({ groupBy: event.currentTarget.value })}
        />
        <label class="toolbar-label" for="aggregate-metrics">
          Metrics
        </label>
        <input
          id="aggregate-metrics"
          type="text"
          placeholder="count, sum:amount"
          value={studio.aggregate.metrics}
          onInput={(event) => studio.writeAggregate({ metrics: event.currentTarget.value })}
        />
        <label class="toolbar-label" for="aggregate-filter">
          Filter
        </label>
        <input
          id="aggregate-filter"
          type="text"
          placeholder={'{"status":{"_eq":"published"}}'}
          value={studio.aggregate.filter}
          onInput={(event) => studio.writeAggregate({ filter: event.currentTarget.value })}
        />
        <button class="primary" type="button" onClick={() => studio.runAggregate()}>
          Run
        </button>
      </div>
      <p class="toolbar-hints">
        The aggregate groups the rows that share the same values and counts them. The metrics take
        count, sum:amount, avg:amount, min:amount, max:amount.
      </p>
      <div class="results-table" aria-busy={loading ? 'true' : undefined}>
        {loading ? (
          <div class="loading">Running the aggregate of {collection.label}.</div>
        ) : failure ? (
          <Notice error={failure} retry={() => studio.runAggregate()} />
        ) : studio.aggregate.groupBy.trim().length === 0 ? (
          // An aggregate without a grouping counts every row of the collection:
          // the studio asks for the fields to group by rather than showing a
          // number without a meaning.
          <div class="empty-panel">
            <strong>Choose the fields to group by.</strong>
            The aggregate groups the rows that share the same values. Write the fields to group by,
            for example status, author.
          </div>
        ) : groups.length === 0 ? (
          <div class="table-wrap">
            <table>
              <caption class="visually-hidden">The aggregate of {collection.label}</caption>
              <tbody>
                <tr>
                  <td class="empty">
                    <strong>This aggregate has no group.</strong>
                    Change the grouping or the metrics of the aggregate.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div class="table-wrap">
            <table>
              <caption class="visually-hidden">The aggregate of {collection.label}</caption>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                  <th scope="col">count</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column}>{renderValue(group.group[column])}</td>
                    ))}
                    <td>{String(group.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div class="pager">
        <button class="ghost" type="button" hidden>
          Previous
        </button>
        <button class="ghost" type="button" hidden>
          Next
        </button>
        <span>
          {answer
            ? `${plural(answer.meta.groups, 'group')}${answer.meta.truncated ? ' (truncated)' : ''}`
            : ''}
        </span>
      </div>
    </>
  )
}

/**
 * The view of the audit log of the workspace.
 *
 * The log is a page of the backend: the studio keeps the cursor of the
 * pages, so the entries past the first page are reachable.
 */
export function AuditView(): JSX.Element {
  const studio = useStudio()
  const [page, setPage] = useState<AuditPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<unknown>(null)
  const [cursors, setCursors] = useState<(string | null)[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let live = true
    const params = new URLSearchParams()
    params.set('limit', '50')
    if (cursor) params.set('cursor', cursor)
    setLoading(true)
    studio.api
      .get<AuditPage>(`/audit?${params.toString()}`)
      .then((answer) => {
        if (!live) return
        setPage(answer)
        setFailure(null)
      })
      .catch((error: unknown) => {
        if (!live) return
        setFailure(error)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [studio.api, cursor, revision])

  const entries = page?.data ?? []
  const columns = [
    { key: 'occurredAt', label: 'Occurred at' },
    { key: 'action', label: 'Action' },
    { key: 'collection', label: 'Collection' },
    { key: 'recordId', label: 'Record' },
    { key: 'principalId', label: 'Principal' },
    { key: 'source', label: 'Source' },
    { key: 'changedFields', label: 'Changed fields' },
  ]
  return (
    <>
      <div class="toolbar">
        <h1 tabindex={-1}>The audit log of the workspace</h1>
      </div>
      <div class="results-table" aria-busy={loading ? 'true' : undefined}>
        {loading ? (
          <div class="loading">Loading the audit log of the workspace.</div>
        ) : failure ? (
          <Notice error={failure} retry={() => setRevision((n) => n + 1)} />
        ) : (
          <div class="table-wrap">
            <table>
              <caption class="visually-hidden">The audit log of the workspace</caption>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.length > 0 ? (
                  entries.map((entry, index) => (
                    <tr key={index}>
                      {columns.map((column) => {
                        const cell = auditCell(entry, column.key, studio.schema?.collections ?? [])
                        return (
                          <td class="mono" title={cell.title}>
                            {cell.text}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td class="empty" colspan={columns.length}>
                      <strong>The audit log is empty.</strong>
                      Nothing has been changed in this workspace yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div class="pager">
        <button
          class="ghost"
          type="button"
          disabled={cursors.length === 0}
          onClick={() => {
            const stack = cursors.slice(0, -1)
            setCursors(stack)
            setCursor(stack[stack.length - 1] ?? null)
          }}
        >
          Previous
        </button>
        <button
          class="ghost"
          type="button"
          disabled={!page?.meta.nextCursor}
          onClick={() => {
            setCursors([...cursors, cursor])
            setCursor(page?.meta.nextCursor ?? null)
          }}
        >
          Next
        </button>
        <span>{plural(entries.length, 'entry', 'entries')}</span>
      </div>
    </>
  )
}

/**
 * The value of a cell of the audit log, in the words of a person.
 *
 * The studio shows the moment, the action and the fields that changed;
 * the text of the backend stays in the tooltip of the cell.
 */
function auditCell(
  entry: Record<string, unknown>,
  key: string,
  collections: CollectionMetadata[]
): { text: string; title?: string } {
  const value = entry[key]
  if (key === 'occurredAt') {
    const moment = formatMoment(value)
    return moment ? { text: moment, title: String(value) } : { text: renderValue(value) }
  }
  if (key === 'action') {
    const action = typeof value === 'string' ? value : ''
    if (action.length === 0) return { text: '—' }
    return { text: action.charAt(0).toUpperCase() + action.slice(1), title: action }
  }
  if (key === 'collection' && typeof value === 'string') {
    const target = collections.find((entry) => entry.key === value)
    return { text: target?.label ?? value, title: value }
  }
  if (key === 'changedFields' && Array.isArray(value)) {
    return { text: value.join(', '), title: value.join(', ') }
  }
  if (isEmpty(value)) return { text: '—' }
  const text = renderValue(value)
  return { text, title: text }
}
