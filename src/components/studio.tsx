/**
 * The studio.
 *
 * The studio shows the collections of a workspace, the rows of the
 * collection that is chosen, the aggregate of the collection and the
 * audit log of the workspace. It shows what the backend answers and
 * nothing else: the collections it lists are the collections the caller
 * may use, the fields it offers to edit are the fields the caller may
 * write, and a refusal is shown with its code.
 */

import type { JSX } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Api, ApiError } from '../client/api'
import type { CollectionMetadata, SchemaMetadata, SessionInfo } from '../client/types'
import { StudioContext, type Query, type View } from './context'
import { Drawer } from './drawer'
import { Identity, Sidebar } from './frame'
import { Notice, Toasts, type Toast } from './notice'
import { AggregateView, AuditView, RowsView } from './views'

/** The query a collection starts with. */
const EMPTY_QUERY: Query = { search: '', sort: '', filter: '', limit: 50 }

/** The studio of a workspace. */
export function Studio(props: { workspace: string }): JSX.Element {
  const workspace = props.workspace
  const api = useMemo(() => new Api(workspace), [workspace])
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [schema, setSchema] = useState<SchemaMetadata | null>(null)
  const [collection, setCollection] = useState<string | null>(null)
  const [view, setView] = useState<View>('data')
  const [draft, setDraft] = useState<Query>({ ...EMPTY_QUERY })
  const [query, setQuery] = useState<Query>({ ...EMPTY_QUERY })
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursors, setCursors] = useState<(string | null)[]>([])
  const [aggregate, setAggregate] = useState({ groupBy: '', metrics: '', filter: '' })
  const [aggregateRun, setAggregateRun] = useState(0)
  const [revision, setRevision] = useState(0)
  const [failure, setFailure] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<{ key: string; id: string | null } | null>(null)
  const [closing, setClosing] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sidebar, setSidebar] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  const wasOpen = useRef(false)
  const messages = useRef(0)

  const select = useCallback(
    (key: string) => {
      setCollection(key)
      setView('data')
      setCursor(null)
      setCursors([])
      setSidebar(false)
      // The query of the collection that is shown is the query that is
      // written.
      setQuery({ ...draft })
    },
    [draft]
  )

  const show = useCallback((next: View) => {
    setView(next)
    setSidebar(false)
  }, [])

  const run = useCallback(() => {
    setCursor(null)
    setCursors([])
    setQuery({ ...draft })
  }, [draft])

  const write = useCallback((patch: Partial<Query>) => {
    setDraft((current) => ({ ...current, ...patch }))
  }, [])

  const writeAggregate = useCallback((patch: Partial<typeof aggregate>) => {
    setAggregate((current) => ({ ...current, ...patch }))
  }, [])

  const runAggregate = useCallback(() => {
    setAggregateRun((n) => n + 1)
  }, [])

  const page = useCallback(
    (direction: 'next' | 'previous', next?: string | null) => {
      if (direction === 'next') {
        if (!next) return
        setCursors([...cursors, cursor])
        setCursor(next)
        return
      }
      const stack = cursors.slice(0, -1)
      setCursors(stack)
      setCursor(stack[stack.length - 1] ?? null)
    },
    [cursors, cursor]
  )

  const open = useCallback((key: string, id: string | null) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDrawer({ key, id })
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawer(null)
  }, [])

  const toast = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    messages.current += 1
    setToasts((current) => [...current, { id: messages.current, message, kind }])
  }, [])

  const refresh = useCallback(() => {
    setRevision((n) => n + 1)
  }, [])

  // The session of the caller and the metadata of the deployment are
  // read once: the studio shows what the backend answers.
  useEffect(() => {
    let live = true
    const boot = async (): Promise<void> => {
      try {
        const answer = await api.get<{ data: SessionInfo }>('/session')
        if (!live) return
        api.setCsrf(answer.data.csrfToken)
        setSession(answer.data)
      } catch (error) {
        if (!live) return
        if (error instanceof ApiError && error.code === 'AUTHENTICATION_REQUIRED') {
          window.location.href = `/login?workspace=${encodeURIComponent(workspace)}`
          return
        }
        setFailure(error)
        return
      }
      try {
        const answer = await api.get<{ data: SchemaMetadata }>('/schema')
        if (!live) return
        setSchema(answer.data)
        const first = answer.data.collections[0]
        if (first) {
          setCollection(first.key)
        } else {
          setNotice('This caller may not use any collection of this workspace.')
        }
      } catch (error) {
        if (!live) return
        setFailure(error)
      }
    }
    void boot()
    return () => {
      live = false
    }
  }, [api, workspace])

  // The page behind the drawer is not reachable with the keyboard while
  // the drawer is open.
  useEffect(() => {
    const element = frame.current
    if (!element) return
    if ('inert' in HTMLElement.prototype) element.inert = drawer !== null
  }, [drawer])

  // The focus goes back to the way the record was opened, once the
  // drawer has left the screen and the page behind it is reachable
  // again.
  useEffect(() => {
    if (wasOpen.current && !drawer) {
      const target = opener.current
      opener.current = null
      if (target && document.contains(target)) target.focus()
      else document.querySelector<HTMLElement>('#content h1')?.focus()
    }
    wasOpen.current = drawer !== null
  }, [drawer])

  // The escape key is the way out of the collections, on a small screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (!sidebar) return
      setSidebar(false)
      document.getElementById('menu')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebar])

  const collections = schema?.collections ?? []
  const current: CollectionMetadata | null =
    collections.find((entry) => entry.key === collection) ?? null
  const opened = drawer ? (collections.find((entry) => entry.key === drawer.key) ?? null) : null

  const value = {
    api,
    workspace,
    session,
    schema,
    collection: current,
    view,
    draft,
    query,
    write,
    run,
    cursor,
    cursors,
    page,
    aggregate,
    writeAggregate,
    runAggregate,
    aggregateRun,
    select,
    show,
    open,
    toast,
    refresh,
    revision,
  }

  return (
    <StudioContext.Provider value={value}>
      <div class="app" id="app" data-workspace={workspace} ref={frame}>
        <header class="topbar">
          <button
            class="menu"
            id="menu"
            type="button"
            aria-expanded={sidebar ? 'true' : 'false'}
            aria-controls="sidebar"
            onClick={() => {
              if (sidebar) {
                setSidebar(false)
                document.getElementById('menu')?.focus()
                return
              }
              setSidebar(true)
              document.querySelector<HTMLElement>('.collection')?.focus()
            }}
          >
            Collections
          </button>
          <div class="brand">
            <span class="brand-mark">Bridge</span>
            <span class="brand-sub">the studio of the headless data backend</span>
          </div>
          <Identity session={session} />
        </header>
        <div class="layout">
          <Sidebar
            workspace={workspace}
            collections={collections}
            current={collection}
            view={view}
            open={sidebar}
            select={select}
            show={show}
            logout={() => {
              void api.absolute('/logout').finally(() => {
                window.location.href = '/login'
              })
            }}
          />
          <main class="content" id="content" tabindex={-1}>
            {failure ? (
              <Notice error={failure} retry={() => window.location.reload()} />
            ) : notice ? (
              <div class="notice">{notice}</div>
            ) : !schema ? (
              <div class="placeholder">Loading the studio…</div>
            ) : view === 'aggregate' ? (
              <AggregateView />
            ) : view === 'audit' ? (
              <AuditView />
            ) : (
              <RowsView />
            )}
          </main>
        </div>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the scrim is a curtain; the escape key and the way to the collections close the collections. */}
      <div
        class="sidebar-scrim"
        id="sidebar-scrim"
        hidden={!sidebar}
        onClick={() => setSidebar(false)}
      />
      <div
        class="drawer-backdrop"
        id="drawer-backdrop"
        hidden={!drawer}
        aria-hidden="true"
        onClick={() => setClosing((n) => n + 1)}
      />
      {drawer && opened ? (
        <Drawer
          collection={opened}
          id={drawer.id}
          closing={closing}
          onClose={closeDrawer}
          onChanged={() => {
            refresh()
            document.querySelector<HTMLElement>('#content h1')?.focus()
          }}
        />
      ) : null}
      <Toasts
        toasts={toasts}
        dismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
    </StudioContext.Provider>
  )
}
