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
import { clear, h, isEmpty, plural, renderValue } from './dom'
import type { Child } from './dom'

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
  nextCursor: null as string | null,
  idempotencyKey: '',
  aggregate: { groupBy: '', metrics: '', filter: '' },
  // The number of the last request of each view: an answer that arrives
  // late never overwrites the answer of a newer request.
  requestRows: 0,
  requestAggregate: 0,
  requestAudit: 0,
}

/** The elements of the document. */
const elements = {
  app: document.getElementById('app') as HTMLElement,
  identity: document.getElementById('identity') as HTMLElement,
  workspace: document.getElementById('workspace') as HTMLElement,
  collections: document.getElementById('collections') as HTMLElement,
  content: document.getElementById('content') as HTMLElement,
  drawer: document.getElementById('drawer') as HTMLElement,
  backdrop: document.getElementById('drawer-backdrop') as HTMLElement,
  toasts: document.getElementById('toasts') as HTMLElement,
  menu: document.getElementById('menu') as HTMLButtonElement | null,
  sidebar: document.getElementById('sidebar') as HTMLElement | null,
  sidebarScrim: document.getElementById('sidebar-scrim') as HTMLElement | null,
}

/** The toolbar of the query of a collection. */
let toolbar: {
  root: HTMLElement
  heading: HTMLElement
  run?: HTMLButtonElement
} | null = null

/** The area of the results of the view that is open. */
let results: {
  table: HTMLElement
  pager: HTMLElement
  previous: HTMLButtonElement
  next: HTMLButtonElement
  count: HTMLElement
} | null = null

/** The element that opened the drawer, for the focus that comes back. */
let drawerOpener: HTMLElement | null = null

/** The note of the collection, under the toolbar. */
let collectionNote: HTMLElement | null = null

/** The actions of the drawer, for the change of their state. */
let drawerActions: HTMLElement | null = null

/** The message of a failure, inside the drawer. */
let drawerNotice: HTMLElement | null = null

/** Whether a change of the state is in flight. */
let pending = false

/** Whether the delete of the record waits for a second answer. */
let deleteArmed = false

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
    report(error, elements.content, () => window.location.reload())
    return
  }
  renderIdentity()
  elements.workspace.textContent = state.workspace

  try {
    const schema = await state.api.get<{ data: SchemaMetadata }>('/schema')
    state.schema = schema.data
  } catch (error) {
    report(error, elements.content, () => window.location.reload())
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
    h(
      'span',
      { class: 'identity-roles' },
      principal.roles.length > 0 ? principal.roles.join(', ') : 'no role'
    )
  )
}

/** The collections of the workspace, in the side bar. */
function renderCollections(): void {
  clear(elements.collections)
  for (const collection of state.schema?.collections ?? []) {
    const actions = collection.actions.map((action) =>
      h('span', { class: 'tag' }, action[0]?.toUpperCase() ?? action)
    )
    const active = state.collection === collection.key
    elements.collections.append(
      h(
        'button',
        {
          class: `collection${active ? ' active' : ''}`,
          type: 'button',
          'aria-current': active ? 'true' : undefined,
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

/**
 * The view that is open, in the side bar.
 *
 * The studio has three views: the rows of a collection, the aggregate
 * of a collection and the audit log of the workspace. The side bar says
 * which one is open.
 */
function renderViewState(): void {
  for (const [id, view] of [
    ['show-aggregate', 'aggregate'],
    ['show-audit', 'audit'],
  ] as const) {
    const link = document.getElementById(id)
    if (!link) continue
    const current = state.view === view
    link.classList.toggle('active', current)
    if (current) link.setAttribute('aria-current', 'true')
    else link.removeAttribute('aria-current')
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
  closeSidebar()
  resetContent()
  renderCollections()
  renderViewState()
  await renderRows()
}

/**
 * The collections, off the canvas.
 *
 * On a small screen the collections are behind the way to them, and
 * they leave the canvas as soon as a collection is chosen.
 */
function openSidebar(): void {
  const sidebar = elements.sidebar
  if (!sidebar) return
  sidebar.classList.add('open')
  elements.menu?.setAttribute('aria-expanded', 'true')
  if (elements.sidebarScrim) elements.sidebarScrim.hidden = false
  sidebar.querySelector<HTMLElement>('.collection')?.focus()
}

/** Closes the collections, and gives the focus back to the way to them. */
function closeSidebar(): void {
  const sidebar = elements.sidebar
  if (!sidebar?.classList.contains('open')) return
  sidebar.classList.remove('open')
  elements.menu?.setAttribute('aria-expanded', 'false')
  if (elements.sidebarScrim) elements.sidebarScrim.hidden = true
  elements.menu?.focus()
}

/** Empties the content of the view, for another view. */
function resetContent(): void {
  toolbar?.root.remove()
  toolbar = null
  collectionNote?.remove()
  collectionNote = null
  results?.table.remove()
  results?.pager.remove()
  results = null
  clear(elements.content)
}

/**
 * The area of the results of the view.
 *
 * The area is kept while the view does not change, so the pager keeps
 * the focus of the caller when the rows answer again.
 */
function ensureResults(): NonNullable<typeof results> {
  if (results) return results
  const previous = h(
    'button',
    {
      class: 'ghost',
      type: 'button',
      on: {
        click: () => {
          state.cursors.pop()
          state.cursor = state.cursors[state.cursors.length - 1] ?? null
          void renderRows()
        },
      },
    },
    'Previous'
  )
  const next = h(
    'button',
    {
      class: 'ghost',
      type: 'button',
      on: {
        click: () => {
          if (!state.nextCursor) return
          state.cursors.push(state.cursor)
          state.cursor = state.nextCursor
          void renderRows()
        },
      },
    },
    'Next'
  )
  const count = h('span', {})
  const pager = h('div', { class: 'pager' }, previous, next, count)
  const table = h('div', { class: 'results-table' })
  elements.content.append(table, pager)
  results = { table, pager, previous, next, count }
  return results
}

/**
 * The toolbar of the query of a collection.
 *
 * The toolbar is kept while the collection does not change, so the
 * caller does not lose the focus of the field he is writing in when the
 * rows answer again.
 */
function ensureToolbar(collection: CollectionMetadata): NonNullable<typeof toolbar> {
  if (toolbar) return toolbar
  const heading = h('h1', { tabindex: -1 }, collection.label)
  const search = h('input', {
    id: 'query-search',
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
    id: 'query-sort',
    type: 'text',
    placeholder: 'title, -createdAt',
    value: state.sort,
    on: {
      input: (event) => {
        state.sort = (event.target as HTMLInputElement).value
      },
    },
  })
  const limit = h('input', {
    id: 'query-limit',
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
    'Run'
  )
  const advanced = h(
    'details',
    { class: 'advanced' },
    h('summary', {}, 'The filter of the query'),
    h(
      'label',
      { class: 'visually-hidden', for: 'query-filter' },
      'The filter of the query, in json'
    ),
    h('textarea', {
      id: 'query-filter',
      value: state.filter,
      placeholder: '{"status":{"_eq":"published"}}',
      on: {
        input: (event) => {
          state.filter = (event.target as HTMLTextAreaElement).value
        },
      },
    })
  )
  const root = h(
    'div',
    { class: 'toolbar' },
    heading,
    h('label', { class: 'visually-hidden', for: 'query-search' }, `Search in ${collection.label}`),
    search,
    h('label', { class: 'toolbar-label', for: 'query-sort' }, 'Sort'),
    sort,
    h('label', { class: 'toolbar-label', for: 'query-limit' }, 'Rows per page'),
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
                void openRecord(collection.key, null)
              },
            },
          },
          'New record'
        )
      : null,
    advanced
  )
  elements.content.append(root)
  // What the collection holds, in the words of the backend.
  collectionNote = null
  if (collection.description) {
    collectionNote = h('p', { class: 'collection-description' }, collection.description)
    elements.content.append(collectionNote)
  }
  toolbar = { root, heading, run }
  return toolbar
}

/** The rows of the collection, with the toolbar of the query. */
async function renderRows(): Promise<void> {
  const collection = currentCollection()
  if (!collection) return
  ensureToolbar(collection)
  const area = ensureResults()
  const request = ++state.requestRows
  const run = toolbar?.run
  if (run) run.disabled = true
  setLoading(area, `Loading the rows of ${collection.label}.`)
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
    if (request !== state.requestRows) return
    state.nextCursor = page.meta.nextCursor
    area.table.removeAttribute('aria-busy')
    renderTable(collection, page.data, page.meta)
  } catch (error) {
    if (request !== state.requestRows) return
    report(error, area.table, () => void renderRows())
  } finally {
    if (request === state.requestRows && run) run.disabled = false
  }
}

/**
 * What the studio is doing while it waits.
 *
 * The wait is named, and the area says that it is busy, so the caller
 * reads it and a screen reader hears it.
 */
function setLoading(area: NonNullable<typeof results>, message: string): void {
  clear(area.table)
  area.table.setAttribute('aria-busy', 'true')
  area.table.append(h('div', { class: 'loading' }, message))
}

/** The table of the rows. */
function renderTable(
  collection: CollectionMetadata,
  rows: Row[],
  meta: { limit: number; nextCursor: string | null; count?: number }
): void {
  const area = ensureResults()
  clear(area.table)
  const columns = collection.readableFields.length > 0 ? collection.readableFields : ['id']
  const header = h(
    'tr',
    {},
    ...columns.map((field) => h('th', { scope: 'col', title: field }, field))
  )
  const body =
    rows.length > 0
      ? rows.map((row) => {
          const id = String(row.id ?? '')
          const cells = columns.map((field, index) => {
            const value = row[field]
            const isNull = isEmpty(value)
            const text = isNull ? '—' : renderValue(value)
            const classes = isNull ? 'null' : field === 'id' ? 'mono' : ''
            // The first cell of the row opens the record with the
            // keyboard, and the whole row opens it with the mouse.
            if (index === 0) {
              return h(
                'td',
                { class: classes },
                h(
                  'button',
                  {
                    class: 'row-open',
                    type: 'button',
                    title: isNull ? undefined : text,
                    on: {
                      click: (event) => {
                        event.stopPropagation()
                        void openRecord(collection.key, id, event.currentTarget as HTMLElement)
                      },
                    },
                  },
                  text,
                  h(
                    'span',
                    { class: 'visually-hidden' },
                    `, open the record of ${collection.label}`
                  )
                )
              )
            }
            return h('td', { class: classes, title: isNull ? undefined : text }, text)
          })
          return h(
            'tr',
            {
              on: {
                click: () => {
                  void openRecord(collection.key, id)
                },
              },
            },
            ...cells
          )
        })
      : [
          h(
            'tr',
            {},
            h(
              'td',
              { class: 'empty', colspan: columns.length },
              h(
                'strong',
                {},
                state.search.trim() || state.filter.trim()
                  ? 'No row matches this query.'
                  : 'This collection has no row.'
              ),
              state.search.trim() || state.filter.trim()
                ? 'Change the search or the filter of the query.'
                : 'A record of this collection can be created here.',
              collection.actions.includes('create')
                ? h(
                    'div',
                    { class: 'notice-actions' },
                    h(
                      'button',
                      {
                        class: 'ghost',
                        type: 'button',
                        on: {
                          click: () => {
                            void openRecord(collection.key, null)
                          },
                        },
                      },
                      'New record'
                    )
                  )
                : null
            )
          ),
        ]
  area.table.append(
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('caption', { class: 'visually-hidden' }, `The rows of ${collection.label}`),
        h('thead', {}, header),
        h('tbody', {}, ...body)
      )
    )
  )
  area.previous.hidden = false
  area.next.hidden = false
  area.previous.disabled = state.cursors.length === 0
  area.next.disabled = !meta.nextCursor
  area.count.textContent =
    meta.count !== undefined
      ? `${plural(rows.length, 'row')} of ${new Intl.NumberFormat().format(meta.count)}`
      : plural(rows.length, 'row')
}

/** The drawer of a record: it shows a row and it edits it. */
async function openRecord(
  key: string,
  id: string | null,
  opener?: HTMLElement | null
): Promise<void> {
  const collection = state.schema?.collections.find((entry) => entry.key === key)
  if (!collection) return
  // The key of a creation is bound to the form of the record: a creation
  // that is sent twice answers with the same receipt, and not with two
  // records.
  state.idempotencyKey = crypto.randomUUID()
  drawerOpener =
    opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
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
      report(error, ensureResults().table, () => void openRecord(key, id))
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
  deleteArmed = false
  const writable = new Set(collection.writableFields)
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>()

  const fields = collection.fields.filter(
    (field) => collection.readableFields.includes(field.name) || writable.has(field.name)
  )

  const form = h(
    'form',
    {
      id: 'record-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          void save(collection, id, etag, inputs)
        },
      },
    },
    ...fields.map((field, index) => {
      const value = row[field.name]
      // A field that has no value is an empty field: the studio writes
      // the text "null" in no control, and it sends no value it did not
      // read.
      const text =
        value === undefined || value === null
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value)
      const input = field.enum
        ? h(
            'select',
            {},
            h('option', { value: '' }, '—'),
            ...field.enum.map((option) => h('option', { value: option }, option))
          )
        : field.type === 'text'
          ? h('textarea', { rows: 6 })
          : h('input', { type: inputTypeOf(field), value: text })
      if (input instanceof HTMLSelectElement && typeof value === 'string') {
        input.value = value
      }
      if (input instanceof HTMLTextAreaElement) {
        input.value = text
      }
      // A boolean is a box that is ticked or not: the value of the
      // record is the state of the box.
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = value === true || value === 'true'
      }
      inputs.set(field.name, input)
      const editable = writable.has(field.name)
      if (!editable) input.setAttribute('disabled', '')
      // The label of the field is bound to the control, and the hint of
      // the field is read with it.
      const inputId = `field-${index}`
      const hintId = `field-${index}-hint`
      input.id = inputId
      if (field.description) input.setAttribute('aria-describedby', hintId)
      return h(
        'div',
        { class: 'field' },
        h(
          'label',
          { for: inputId },
          field.label ?? field.name,
          field.required ? ' *' : null,
          field.required ? h('span', { class: 'visually-hidden' }, ' (required)') : null
        ),
        input,
        field.description ? h('div', { class: 'hint', id: hintId }, field.description) : null
      )
    })
  )

  const notice = h('div', { class: 'drawer-notice' })
  const actions = buildActions(collection, writable, id, etag, inputs)

  elements.drawer.append(
    h(
      'div',
      { class: 'drawer-head' },
      h(
        'h2',
        { id: 'drawer-title', tabindex: -1 },
        id ? 'Record ' : `New record of ${collection.label}`,
        id ? h('span', { class: 'mono' }, id) : null
      ),
      h('div', { class: 'meta' }, collection.key)
    ),
    form,
    notice,
    actions
  )
  drawerNotice = notice
  drawerActions = actions

  elements.drawer.hidden = false
  elements.backdrop.hidden = false
  // The page behind the drawer is not reachable with the keyboard while
  // the drawer is open.
  if ('inert' in HTMLElement.prototype) elements.app.inert = true
  const title = elements.drawer.querySelector<HTMLElement>('#drawer-title')
  title?.focus()
}

/** The actions of the drawer: the change of the record, or the removal of it. */
function buildActions(
  collection: CollectionMetadata,
  writable: Set<string>,
  id: string | null,
  etag: string,
  inputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
): HTMLElement {
  const canUpdate = collection.actions.includes('update') && writable.size > 0
  const canCreate = collection.actions.includes('create')
  const canDelete = collection.actions.includes('delete') && id !== null
  const root = h('div', { class: 'drawer-actions' })

  // The delete of a record waits for a second answer, in the drawer of
  // the record itself: the question and its answer are in the language
  // of the studio.
  if (deleteArmed) {
    root.append(
      h(
        'span',
        { class: 'drawer-question' },
        'Delete the record ',
        h('span', { class: 'mono' }, id),
        ` of ${collection.label}?`
      ),
      h(
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
      ),
      h(
        'button',
        {
          class: 'ghost',
          type: 'button',
          on: {
            click: () => {
              deleteArmed = false
              refreshActions(collection, writable, id, etag, inputs, '[data-action="delete"]')
            },
          },
        },
        'Keep it'
      )
    )
    return root
  }

  root.append(
    h(
      'div',
      { class: 'drawer-buttons' },
      canCreate && !id
        ? h(
            'button',
            { class: 'primary', type: 'submit', form: 'record-form', 'data-action': 'create' },
            'Create'
          )
        : null,
      canUpdate && id
        ? h(
            'button',
            {
              class: 'primary',
              type: 'button',
              'data-action': 'save',
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
              'data-action': 'delete',
              on: {
                click: () => {
                  deleteArmed = true
                  refreshActions(collection, writable, id, etag, inputs, '[data-action="delete"]')
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
          'data-action': 'close',
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
  return root
}

/** Rebuilds the actions of the drawer, and moves the focus to one of them. */
function refreshActions(
  collection: CollectionMetadata,
  writable: Set<string>,
  id: string | null,
  etag: string,
  inputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  focus?: string
): void {
  if (!drawerActions) return
  const next = buildActions(collection, writable, id, etag, inputs)
  drawerActions.replaceWith(next)
  drawerActions = next
  const target = focus ? next.querySelector<HTMLElement>(focus) : null
  target?.focus()
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
  inputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
): Promise<void> {
  // A change that is in flight is not sent again.
  if (pending) return
  const body: Record<string, unknown> = {}
  for (const [name, input] of inputs) {
    if (input.hasAttribute('disabled')) continue
    if (input instanceof HTMLSelectElement && input.value === '') continue
    const raw =
      input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value
    if (typeof raw === 'string' && raw.trim() === '') continue
    body[name] = raw
  }
  pending = true
  setActionsBusy(true)
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
    focusHeading()
  } catch (error) {
    // The form keeps what the caller wrote: the answer of the backend
    // is shown under it.
    showDrawerError(error)
  } finally {
    pending = false
    setActionsBusy(false)
  }
}

/** Deletes a record. */
async function remove(collection: CollectionMetadata, id: string, etag: string): Promise<void> {
  if (pending) return
  pending = true
  setActionsBusy(true)
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
    focusHeading()
  } catch (error) {
    showDrawerError(error)
  } finally {
    pending = false
    setActionsBusy(false)
  }
}

/** Holds the actions of the drawer while a change is in flight. */
function setActionsBusy(busy: boolean): void {
  if (!drawerActions) return
  for (const button of Array.from(drawerActions.querySelectorAll<HTMLButtonElement>('button'))) {
    button.disabled = busy
  }
}

/** The failure of a change, in the drawer of the record. */
function showDrawerError(error: unknown): void {
  if (!drawerNotice) return
  clear(drawerNotice)
  drawerNotice.append(errorNotice(error))
}

/** Closes the drawer. */
function closeDrawer(): void {
  if (elements.drawer.hidden) return
  elements.drawer.hidden = true
  elements.backdrop.hidden = true
  if ('inert' in HTMLElement.prototype) elements.app.inert = false
  const opener = drawerOpener
  drawerOpener = null
  drawerActions = null
  drawerNotice = null
  deleteArmed = false
  clear(elements.drawer)
  if (opener && document.contains(opener)) opener.focus()
  else focusHeading()
}

/** Moves the focus to the heading of the view. */
function focusHeading(): void {
  const heading = toolbar?.heading ?? elements.content.querySelector<HTMLElement>('h1')
  heading?.focus()
}

/**
 * Keeps the focus of the keyboard inside the drawer.
 *
 * The page behind the drawer is inert when the browser knows it; this
 * is the way for the browsers that do not.
 */
function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    elements.drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    )
  ).filter((element) => element.offsetParent !== null)
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return
  const active = document.activeElement
  if (event.shiftKey && (active === first || !elements.drawer.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/** The view of the aggregate of a collection. */
async function renderAggregate(): Promise<void> {
  const collection = currentCollection()
  resetContent()
  renderViewState()
  if (!collection) {
    elements.content.append(h('div', { class: 'notice' }, 'Choose a collection first.'))
    return
  }
  const heading = h('h1', { tabindex: -1 }, `Aggregate of ${collection.label}`)
  const groupBy = h('input', {
    id: 'aggregate-group',
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
    id: 'aggregate-metrics',
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
    id: 'aggregate-filter',
    type: 'text',
    placeholder: '{"status":{"_eq":"published"}}',
    value: state.aggregate.filter,
    on: {
      input: (event) => {
        state.aggregate.filter = (event.target as HTMLInputElement).value
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
          void runAggregate(collection)
        },
      },
    },
    'Run'
  )
  const root = h(
    'div',
    { class: 'toolbar' },
    heading,
    h('label', { class: 'toolbar-label', for: 'aggregate-group' }, 'Group by'),
    groupBy,
    h('label', { class: 'toolbar-label', for: 'aggregate-metrics' }, 'Metrics'),
    metrics,
    h('label', { class: 'toolbar-label', for: 'aggregate-filter' }, 'Filter'),
    filter,
    run
  )
  elements.content.append(root)
  toolbar = { root, heading, run }
  const area = ensureResults()
  area.previous.hidden = true
  area.next.hidden = true
  await runAggregate(collection)
}

/** Runs the aggregate and renders its groups. */
async function runAggregate(collection: CollectionMetadata): Promise<void> {
  const area = ensureResults()
  const request = ++state.requestAggregate
  setLoading(area, `Running the aggregate of ${collection.label}.`)
  try {
    const params = new URLSearchParams()
    if (state.aggregate.groupBy.trim()) params.set('group_by', state.aggregate.groupBy.trim())
    if (state.aggregate.metrics.trim()) params.set('metrics', state.aggregate.metrics.trim())
    if (state.aggregate.filter.trim()) params.set('filter', state.aggregate.filter.trim())
    const answer = await state.api.get<{
      data: { group: Record<string, unknown>; count: number }[]
      meta: { groups: number; truncated: boolean }
    }>(`/aggregate/${encodeURIComponent(collection.key)}?${params.toString()}`)
    if (request !== state.requestAggregate) return
    area.table.removeAttribute('aria-busy')
    clear(area.table)
    const columns = Object.keys(answer.data[0]?.group ?? {})
    if (answer.data.length === 0) {
      area.table.append(
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('caption', { class: 'visually-hidden' }, `The aggregate of ${collection.label}`),
            h(
              'tbody',
              {},
              h(
                'tr',
                {},
                h(
                  'td',
                  { class: 'empty' },
                  h('strong', {}, 'This aggregate has no group.'),
                  'Change the grouping or the metrics of the aggregate.'
                )
              )
            )
          )
        )
      )
      area.count.textContent = plural(answer.meta.groups, 'group')
      return
    }
    area.table.append(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          {},
          h('caption', { class: 'visually-hidden' }, `The aggregate of ${collection.label}`),
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ...columns.map((column) => h('th', { scope: 'col' }, column)),
              h('th', { scope: 'col' }, 'count')
            )
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
      )
    )
    area.count.textContent = `${plural(answer.meta.groups, 'group')}${
      answer.meta.truncated ? ' (truncated)' : ''
    }`
  } catch (error) {
    if (request !== state.requestAggregate) return
    report(error, area.table, () => void runAggregate(collection))
  }
}

/** The view of the audit log of the workspace. */
async function renderAudit(): Promise<void> {
  resetContent()
  renderViewState()
  const heading = h('h1', { tabindex: -1 }, 'The audit log of the workspace')
  const root = h('div', { class: 'toolbar' }, heading)
  elements.content.append(root)
  toolbar = { root, heading }
  const area = ensureResults()
  area.previous.hidden = true
  area.next.hidden = true
  const request = ++state.requestAudit
  setLoading(area, 'Loading the audit log of the workspace.')
  try {
    const answer = await state.api.get<{
      data: Record<string, unknown>[]
      meta: { limit: number; nextCursor: string | null }
    }>('/audit?limit=50')
    if (request !== state.requestAudit) return
    area.table.removeAttribute('aria-busy')
    clear(area.table)
    const columns = [
      'occurredAt',
      'action',
      'collection',
      'recordId',
      'principalId',
      'source',
      'changedFields',
    ]
    const rows =
      answer.data.length > 0
        ? answer.data.map((entry) =>
            h(
              'tr',
              {},
              ...columns.map((column) => h('td', { class: 'mono' }, renderValue(entry[column])))
            )
          )
        : [
            h(
              'tr',
              {},
              h(
                'td',
                { class: 'empty', colspan: columns.length },
                h('strong', {}, 'The audit log is empty.'),
                'Nothing has been changed in this workspace yet.'
              )
            ),
          ]
    area.table.append(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          {},
          h('caption', { class: 'visually-hidden' }, 'The audit log of the workspace'),
          h(
            'thead',
            {},
            h('tr', {}, ...columns.map((column) => h('th', { scope: 'col' }, column)))
          ),
          h('tbody', {}, ...rows)
        )
      )
    )
    area.count.textContent = plural(answer.data.length, 'entry', 'entries')
  } catch (error) {
    if (request !== state.requestAudit) return
    report(error, area.table, () => void renderAudit())
  }
}

/** Reports a failure to the caller of the studio. */
function report(error: unknown, target: HTMLElement = elements.content, retry?: () => void): void {
  clear(target)
  target.append(errorNotice(error, retry))
}

/**
 * The notice of a failure.
 *
 * A refusal of the backend is shown with its code, its message and the
 * identifier of its request. The studio does not change a word of it.
 */
function errorNotice(error: unknown, retry?: () => void): HTMLElement {
  if (error instanceof ApiError) {
    toast(h('span', {}, h('strong', {}, error.code), ' — ', error.message), 'error')
    return h(
      'div',
      { class: 'notice error' },
      h('strong', {}, error.code),
      ' — ',
      error.message,
      h('div', { class: 'hint' }, `request ${error.requestId}`),
      retry
        ? h(
            'div',
            { class: 'notice-actions' },
            h(
              'button',
              {
                class: 'ghost',
                type: 'button',
                on: {
                  click: () => {
                    retry()
                  },
                },
              },
              'Try again'
            )
          )
        : null
    )
  }
  // The request did not answer at all: nothing was changed.
  toast('The studio could not reach the server.', 'error')
  return h(
    'div',
    { class: 'notice error' },
    h('strong', {}, 'The studio could not reach the server.'),
    h('div', { class: 'hint' }, 'The request did not answer. Nothing was changed.'),
    retry
      ? h(
          'div',
          { class: 'notice-actions' },
          h(
            'button',
            {
              class: 'ghost',
              type: 'button',
              on: {
                click: () => {
                  retry()
                },
              },
            },
            'Try again'
          )
        )
      : null
  )
}

/** Shows a message. */
function toast(message: Child, kind: 'ok' | 'error' = 'ok'): void {
  const element = h(
    'div',
    { class: `toast ${kind}`, ...(kind === 'error' ? { role: 'alert' } : {}) },
    message
  )
  elements.toasts.append(element)
  let timer = 0
  const start = () => {
    timer = window.setTimeout(() => element.remove(), kind === 'error' ? 12000 : 6000)
  }
  const stop = () => {
    window.clearTimeout(timer)
  }
  // A message that is read stays on the screen.
  element.addEventListener('mouseenter', stop)
  element.addEventListener('mouseleave', start)
  start()
}

/** The wiring of the studio. */
function wire(): void {
  elements.backdrop.addEventListener('click', () => {
    closeDrawer()
  })
  elements.menu?.addEventListener('click', () => {
    const sidebar = elements.sidebar
    if (!sidebar) return
    if (sidebar.classList.contains('open')) closeSidebar()
    else openSidebar()
  })
  elements.sidebarScrim?.addEventListener('click', () => {
    closeSidebar()
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
    if (event.key !== 'Escape') return
    // The collections come first: they are the way to the content.
    if (elements.sidebar?.classList.contains('open')) {
      closeSidebar()
      return
    }
    // A text that is being written is not thrown away by a key.
    const target = event.target
    if (target instanceof HTMLTextAreaElement) return
    closeDrawer()
  })
  elements.drawer.addEventListener('keydown', trapFocus)
}

wire()
void main()
