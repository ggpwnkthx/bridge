/**
 * The studio.
 *
 * The script of the browser reads the collections of the workspace from
 * the studio, renders them, and sends the changes of the caller back to
 * the studio. It never talks to the backend and it never holds a token:
 * the studio holds it, and the studio is the only thing that knows the
 * gateway.
 *
 * The studio shows what the backend answers and nothing else: the
 * collections it lists are the collections the caller may use, the fields
 * it offers to edit are the fields the caller may write, and a refusal is
 * shown with its code.
 */

import { Api, ApiError } from './api'
import { clear, h, isEmpty, renderValue } from './dom'

/** The metadata of a field of a collection. */
interface FieldMetadata {
  name: string
  type: string
  required: boolean
  nullable: boolean
  maxLength?: number
  minLength?: number
  enum?: string[]
  minimum?: number
  maximum?: number
  label?: string
  description?: string
}

/** The metadata of a collection. */
interface CollectionMetadata {
  key: string
  label: string
  description?: string
  actions: string[]
  readableFields: string[]
  writableFields: string[]
  filterableFields: string[]
  fields: FieldMetadata[]
  relations: { name: string; target: string; type: string }[]
}

/** The metadata of the deployment, for the caller. */
interface SchemaMetadata {
  apiVersion: string
  schemaVersion: string
  policyBundleVersion: string
  limits: { maxLimit: number; defaultLimit: number }
  collections: CollectionMetadata[]
}

/** The session of the caller. */
interface SessionInfo {
  principal: { subject: string; email?: string; name?: string; roles: string[] }
  workspace: string
  csrfToken: string
  gateway: { subject: string; roles: string[]; workspaceId?: string } | null
}

/** A row of a collection. */
type Row = Record<string, unknown>

/** The state of the studio. */
const state = {
  workspace: document.body.dataset.workspace ?? '',
  api: new Api(document.body.dataset.workspace ?? ''),
  session: null as SessionInfo | null,
  schema: null as SchemaMetadata | null,
  collection: null as string | null,
  view: 'data' as 'data' | 'aggregate' | 'audit',
  search: '',
  sort: '',
  filter: '',
  limit: 50,
  cursors: [] as (string | null)[],
  cursor: null as string | null,
  idempotencyKey: '',
  aggregate: { groupBy: '', metrics: '', filter: '' },
}

/** The elements of the document. */
const elements = {
  identity: document.getElementById('identity') as HTMLElement,
  workspace: document.getElementById('workspace') as HTMLElement,
  collections: document.getElementById('collections') as HTMLElement,
  content: document.getElementById('content') as HTMLElement,
  drawer: document.getElementById('drawer') as HTMLElement,
  backdrop: document.getElementById('drawer-backdrop') as HTMLElement,
  toasts: document.getElementById('toasts') as HTMLElement,
}

/** The start of the studio. */
async function main(): Promise<void> {
  if (!state.workspace) {
    elements.content.append(
      h('div', { class: 'notice error' }, 'The studio does not know its workspace.')
    )
    return
  }
  try {
    const session = await state.api.get<{ data: SessionInfo }>('/session')
    state.session = session.data
    state.api.setCsrf(session.data.csrfToken)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'AUTHENTICATION_REQUIRED') {
      window.location.href = `/login?workspace=${encodeURIComponent(state.workspace)}`
      return
    }
    throw error
  }
  renderIdentity()
  elements.workspace.textContent = state.workspace

  try {
    const schema = await state.api.get<{ data: SchemaMetadata }>('/schema')
    state.schema = schema.data
  } catch (error) {
    report(error)
    return
  }
  renderCollections()
  const first = state.schema.collections[0]
  if (first) await selectCollection(first.key)
  else
    elements.content.append(
      h('div', { class: 'notice' }, 'This caller may not use any collection of this workspace.')
    )
}

/** The identity of the caller, in the frame of the application. */
function renderIdentity(): void {
  clear(elements.identity)
  const principal = state.session?.principal
  if (!principal) return
  elements.identity.append(
    h('span', {}, h('strong', {}, principal.name ?? principal.email ?? principal.subject)),
    h('span', {}, principal.roles.length > 0 ? principal.roles.join(', ') : 'no role')
  )
}

/** The collections of the workspace, in the side bar. */
function renderCollections(): void {
  clear(elements.collections)
  for (const collection of state.schema?.collections ?? []) {
    const actions = collection.actions.map((action) =>
      h('span', { class: 'tag' }, action[0]?.toUpperCase() ?? action)
    )
    elements.collections.append(
      h(
        'button',
        {
          class: `collection${state.collection === collection.key ? ' active' : ''}`,
          type: 'button',
          on: {
            click: () => {
              void selectCollection(collection.key)
            },
          },
        },
        h('span', { class: 'collection-label', title: collection.key }, collection.label),
        h('span', { class: 'collection-actions' }, ...actions)
      )
    )
  }
}

/** The collection that is shown. */
function currentCollection(): CollectionMetadata | undefined {
  return state.schema?.collections.find((collection) => collection.key === state.collection)
}

/** Shows a collection. */
async function selectCollection(key: string): Promise<void> {
  state.collection = key
  state.view = 'data'
  state.cursor = null
  state.cursors = []
  renderCollections()
  await renderRows()
}

/** The rows of the collection, with the toolbar of the query. */
async function renderRows(): Promise<void> {
  const collection = currentCollection()
  if (!collection) return
  clear(elements.content)

  const search = h('input', {
    type: 'search',
    placeholder: `Search in ${collection.label}`,
    value: state.search,
    on: {
      input: (event) => {
        state.search = (event.target as HTMLInputElement).value
      },
    },
  })
  const sort = h('input', {
    type: 'text',
    placeholder: 'sort, -field',
    value: state.sort,
    on: {
      input: (event) => {
        state.sort = (event.target as HTMLInputElement).value
      },
    },
  })
  const limit = h('input', {
    type: 'number',
    value: String(state.limit),
    min: '1',
    max: String(state.schema?.limits.maxLimit ?? 200),
    on: {
      input: (event) => {
        state.limit = Number((event.target as HTMLInputElement).value) || 50
      },
    },
  })
  const run = h(
    'button',
    {
      class: 'primary',
      type: 'button',
      on: {
        click: () => {
          state.cursor = null
          state.cursors = []
          void renderRows()
        },
      },
    },
    'Apply'
  )

  const advanced = h(
    'details',
    { class: 'advanced' },
    h('summary', {}, 'The filter of the query'),
    h('textarea', {
      value: state.filter,
      placeholder: '{"status":{"_eq":"published"}}',
      on: {
        input: (event) => {
          state.filter = (event.target as HTMLTextAreaElement).value
        },
      },
    })
  )

  elements.content.append(
    h(
      'div',
      { class: 'toolbar' },
      h('h1', {}, collection.label),
      search,
      sort,
      h('span', { class: 'muted' }, 'rows'),
      limit,
      run,
      h('span', { class: 'spacer' }),
      collection.actions.includes('create')
        ? h(
            'button',
            {
              class: 'ghost',
              type: 'button',
              on: {
                click: () => {
                  openRecord(collection.key, null)
                },
              },
            },
            'New record'
          )
        : null,
      advanced
    )
  )

  try {
    const params = new URLSearchParams()
    params.set('limit', String(state.limit))
    if (state.search.trim().length > 0) params.set('search', state.search.trim())
    if (state.sort.trim().length > 0) params.set('sort', state.sort.trim())
    if (state.filter.trim().length > 0) params.set('filter', state.filter.trim())
    if (state.cursor) params.set('cursor', state.cursor)
    const page = await state.api.get<{
      data: Row[]
      meta: { limit: number; nextCursor: string | null; count?: number }
    }>(`/items/${encodeURIComponent(collection.key)}?${params.toString()}`)
    renderTable(collection, page.data, page.meta)
  } catch (error) {
    report(error)
  }
}

/** The table of the rows. */
function renderTable(
  collection: CollectionMetadata,
  rows: Row[],
  meta: { limit: number; nextCursor: string | null; count?: number }
): void {
  const columns = collection.readableFields.length > 0 ? collection.readableFields : ['id']
  const header = h('tr', {}, ...columns.map((field) => h('th', { title: field }, field)))
  const body = rows.map((row) =>
    h(
      'tr',
      {
        on: {
          click: () => {
            void openRecord(collection.key, String(row.id ?? ''))
          },
        },
      },
      ...columns.map((field) => {
        const value = row[field]
        const isNull = isEmpty(value)
        return h(
          'td',
          { class: isNull ? 'null' : field === 'id' ? 'mono' : '' },
          isNull ? '—' : renderValue(value)
        )
      })
    )
  )

  const pager = h(
    'div',
    { class: 'pager' },
    h(
      'button',
      {
        class: 'ghost',
        type: 'button',
        disabled: state.cursors.length === 0,
        on: {
          click: () => {
            state.cursors.pop()
            state.cursor = state.cursors[state.cursors.length - 1] ?? null
            void renderRows()
          },
        },
      },
      'Previous'
    ),
    h(
      'button',
      {
        class: 'ghost',
        type: 'button',
        disabled: !meta.nextCursor,
        on: {
          click: () => {
            if (!meta.nextCursor) return
            state.cursors.push(state.cursor)
            state.cursor = meta.nextCursor
            void renderRows()
          },
        },
      },
      'Next'
    ),
    h('span', {}, `${rows.length} row(s)${meta.count !== undefined ? ` of ${meta.count}` : ''}`)
  )

  elements.content.append(
    h(
      'div',
      { class: 'table-wrap' },
      h('table', {}, h('thead', {}, header), h('tbody', {}, ...body))
    ),
    pager
  )
}

/** The drawer of a record: it shows a row and it edits it. */
async function openRecord(key: string, id: string | null): Promise<void> {
  const collection = state.schema?.collections.find((entry) => entry.key === key)
  if (!collection) return
  // The key of a creation is bound to the form of the record: a creation
  // that is sent twice answers with the same receipt, and not with two
  // records.
  state.idempotencyKey = crypto.randomUUID()
  let row: Row = {}
  let etag = ''
  if (id) {
    try {
      const answer = await state.api.get<{ data: Row; etag: string }>(
        `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}`
      )
      row = answer.data
      etag = answer.etag
    } catch (error) {
      report(error)
      return
    }
  }
  renderDrawer(collection, row, etag, id)
}

/** The content of the drawer. */
function renderDrawer(
  collection: CollectionMetadata,
  row: Row,
  etag: string,
  id: string | null
): void {
  clear(elements.drawer)
  const writable = new Set(collection.writableFields)
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>()

  const fields = collection.fields.filter(
    (field) => collection.readableFields.includes(field.name) || writable.has(field.name)
  )

  const form = h(
    'form',
    {
      on: {
        submit: (event) => {
          event.preventDefault()
          void save(collection, id, etag, inputs)
        },
      },
    },
    ...fields.map((field) => {
      const value = row[field.name]
      const input = field.enum
        ? h(
            'select',
            {},
            h('option', { value: '' }, '—'),
            ...field.enum.map((option) => h('option', { value: option }, option))
          )
        : h('input', { type: inputTypeOf(field), value: value === undefined ? '' : String(value) })
      if (input instanceof HTMLSelectElement && typeof value === 'string') {
        input.value = value
      }
      inputs.set(field.name, input)
      const editable = writable.has(field.name)
      if (!editable) input.setAttribute('disabled', '')
      return h(
        'div',
        { class: 'field' },
        h('label', {}, field.label ?? field.name, field.required ? ' *' : ''),
        input,
        field.description ? h('div', { class: 'hint' }, field.description) : null
      )
    })
  )

  const canUpdate = collection.actions.includes('update') && writable.size > 0
  const canCreate = collection.actions.includes('create')
  const canDelete = collection.actions.includes('delete') && id !== null

  elements.drawer.append(
    h(
      'div',
      { class: 'drawer-head' },
      h('h2', {}, id ? `Record ${id}` : `New record of ${collection.label}`),
      h('div', { class: 'meta' }, collection.key)
    ),
    form,
    h(
      'div',
      { class: 'drawer-actions' },
      canCreate && !id
        ? h('button', { class: 'primary', type: 'submit', form: 'record-form' }, 'Create')
        : null,
      canUpdate && id
        ? h(
            'button',
            {
              class: 'primary',
              type: 'button',
              on: { click: () => void save(collection, id, etag, inputs) },
            },
            'Save'
          )
        : null,
      canDelete
        ? h(
            'button',
            {
              class: 'danger',
              type: 'button',
              on: {
                click: () => {
                  void remove(collection, id as string, etag)
                },
              },
            },
            'Delete'
          )
        : null,
      h(
        'button',
        {
          class: 'ghost',
          type: 'button',
          on: {
            click: () => {
              closeDrawer()
            },
          },
        },
        'Close'
      )
    )
  )
  const formElement = elements.drawer.querySelector('form')
  if (formElement) formElement.id = 'record-form'
  elements.drawer.hidden = false
  elements.backdrop.hidden = false
}

/** The type of the input of a field. */
function inputTypeOf(field: FieldMetadata): string {
  switch (field.type) {
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'checkbox'
    case 'date':
    case 'timestamp':
      return 'text'
    default:
      return 'text'
  }
}

/** Saves a record. */
async function save(
  collection: CollectionMetadata,
  id: string | null,
  etag: string,
  inputs: Map<string, HTMLInputElement | HTMLSelectElement>
): Promise<void> {
  const body: Record<string, unknown> = {}
  for (const [name, input] of inputs) {
    if (input.hasAttribute('disabled')) continue
    if (input instanceof HTMLSelectElement && input.value === '') continue
    const raw =
      input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value
    if (typeof raw === 'string' && raw.trim() === '') continue
    body[name] = raw
  }
  try {
    if (id) {
      await state.api.send(
        'PATCH',
        `/items/${encodeURIComponent(collection.key)}/${encodeURIComponent(id)}`,
        body,
        { etag }
      )
      toast('The record was saved.', 'ok')
    } else {
      await state.api.send('POST', `/items/${encodeURIComponent(collection.key)}`, body, {
        idempotencyKey: state.idempotencyKey,
      })
      toast('The record was created.', 'ok')
    }
    closeDrawer()
    await renderRows()
  } catch (error) {
    report(error)
  }
}

/** Deletes a record. */
async function remove(collection: CollectionMetadata, id: string, etag: string): Promise<void> {
  if (!window.confirm(`Delete the record ${id} of ${collection.label}?`)) return
  try {
    await state.api.send(
      'DELETE',
      `/items/${encodeURIComponent(collection.key)}/${encodeURIComponent(id)}`,
      undefined,
      { etag }
    )
    toast('The record was deleted.', 'ok')
    closeDrawer()
    await renderRows()
  } catch (error) {
    report(error)
  }
}

/** Closes the drawer. */
function closeDrawer(): void {
  elements.drawer.hidden = true
  elements.backdrop.hidden = true
  clear(elements.drawer)
}

/** The view of the aggregate of a collection. */
async function renderAggregate(): Promise<void> {
  const collection = currentCollection()
  clear(elements.content)
  if (!collection) {
    elements.content.append(h('div', { class: 'notice' }, 'Choose a collection first.'))
    return
  }
  const groupBy = h('input', {
    type: 'text',
    placeholder: 'status, author',
    value: state.aggregate.groupBy,
    on: {
      input: (event) => {
        state.aggregate.groupBy = (event.target as HTMLInputElement).value
      },
    },
  })
  const metrics = h('input', {
    type: 'text',
    placeholder: 'count, sum:amount',
    value: state.aggregate.metrics,
    on: {
      input: (event) => {
        state.aggregate.metrics = (event.target as HTMLInputElement).value
      },
    },
  })
  const filter = h('input', {
    type: 'text',
    placeholder: '{"status":{"_eq":"published"}}',
    value: state.aggregate.filter,
    on: {
      input: (event) => {
        state.aggregate.filter = (event.target as HTMLInputElement).value
      },
    },
  })

  elements.content.append(
    h(
      'div',
      { class: 'toolbar' },
      h('h1', {}, `Aggregate of ${collection.label}`),
      groupBy,
      metrics,
      filter,
      h(
        'button',
        {
          class: 'primary',
          type: 'button',
          on: {
            click: () => {
              void runAggregate(collection)
            },
          },
        },
        'Run'
      )
    ),
    h('div', { id: 'aggregate-result' })
  )
  await runAggregate(collection)
}

/** Runs the aggregate and renders its groups. */
async function runAggregate(collection: CollectionMetadata): Promise<void> {
  const target = document.getElementById('aggregate-result')
  if (!target) return
  clear(target)
  try {
    const params = new URLSearchParams()
    if (state.aggregate.groupBy.trim()) params.set('group_by', state.aggregate.groupBy.trim())
    if (state.aggregate.metrics.trim()) params.set('metrics', state.aggregate.metrics.trim())
    if (state.aggregate.filter.trim()) params.set('filter', state.aggregate.filter.trim())
    const answer = await state.api.get<{
      data: { group: Record<string, unknown>; count: number }[]
      meta: { groups: number; truncated: boolean }
    }>(`/aggregate/${encodeURIComponent(collection.key)}?${params.toString()}`)
    const columns = Object.keys(answer.data[0]?.group ?? {})
    target.append(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          {},
          h(
            'thead',
            {},
            h('tr', {}, ...columns.map((column) => h('th', {}, column)), h('th', {}, 'count'))
          ),
          h(
            'tbody',
            {},
            ...answer.data.map((group) =>
              h(
                'tr',
                {},
                ...columns.map((column) => h('td', {}, renderValue(group.group[column]))),
                h('td', {}, String(group.count))
              )
            )
          )
        )
      ),
      h(
        'div',
        { class: 'pager' },
        `${answer.meta.groups} group(s)${answer.meta.truncated ? ' (truncated)' : ''}`
      )
    )
  } catch (error) {
    report(error, target)
  }
}

/** The view of the audit log of the workspace. */
async function renderAudit(): Promise<void> {
  clear(elements.content)
  elements.content.append(
    h('div', { class: 'toolbar' }, h('h1', {}, 'The audit log of the workspace'))
  )
  try {
    const answer = await state.api.get<{
      data: Record<string, unknown>[]
      meta: { limit: number; nextCursor: string | null }
    }>('/audit?limit=50')
    const columns = [
      'occurredAt',
      'action',
      'collection',
      'recordId',
      'principalId',
      'source',
      'changedFields',
    ]
    elements.content.append(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, ...columns.map((column) => h('th', {}, column)))),
          h(
            'tbody',
            {},
            ...answer.data.map((entry) =>
              h(
                'tr',
                {},
                ...columns.map((column) => h('td', { class: 'mono' }, renderValue(entry[column])))
              )
            )
          )
        )
      ),
      h('div', { class: 'pager' }, `${answer.data.length} entr(y/ies)`)
    )
  } catch (error) {
    report(error)
  }
}

/** Reports a failure to the caller of the studio. */
function report(error: unknown, target: HTMLElement = elements.content): void {
  if (error instanceof ApiError) {
    toast(`${error.code}: ${error.message}`, 'error')
    clear(target)
    target.append(
      h(
        'div',
        { class: 'notice error' },
        h('strong', {}, error.code),
        ' — ',
        error.message,
        h('div', { class: 'hint' }, `request ${error.requestId}`)
      )
    )
    return
  }
  toast('the studio could not complete the request', 'error')
}

/** Shows a message. */
function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const element = h('div', { class: `toast ${kind}` }, message)
  elements.toasts.append(element)
  window.setTimeout(() => {
    element.remove()
  }, 6_000)
}

/** The wiring of the studio. */
function wire(): void {
  elements.backdrop.addEventListener('click', () => {
    closeDrawer()
  })
  document.getElementById('logout')?.addEventListener('click', () => {
    void state.api.absolute('/logout').finally(() => {
      window.location.href = '/login'
    })
  })
  document.getElementById('show-aggregate')?.addEventListener('click', () => {
    state.view = 'aggregate'
    void renderAggregate()
  })
  document.getElementById('show-audit')?.addEventListener('click', () => {
    state.view = 'audit'
    void renderAudit()
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer()
  })
}

wire()
void main()
