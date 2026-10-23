/**
 * The frame of the studio.
 *
 * The frame holds the way to the content: the collections of the
 * workspace, the views of the studio and the identity of the caller. It
 * is the same on every view: only the content changes.
 */

import type { JSX } from 'preact'
import type { CollectionMetadata, SessionInfo } from '../client/types'
import type { View } from './context'

/** The identity of the caller, in the frame of the application. */
export function Identity(props: { session: SessionInfo | null }): JSX.Element {
  const principal = props.session?.principal
  if (!principal) return <div class="identity" id="identity" />
  return (
    <div class="identity" id="identity">
      <span>
        <strong>{principal.name ?? principal.email ?? principal.subject}</strong>
      </span>
      <span class="identity-roles" title="The roles of the caller in this workspace">
        {principal.roles.length > 0 ? principal.roles.join(' · ') : 'no role'}
      </span>
    </div>
  )
}

/** The collections of the workspace, in the side bar. */
export function Collections(props: {
  collections: CollectionMetadata[]
  current: string | null
  select: (key: string) => void
}): JSX.Element {
  return (
    <nav class="collections" id="collections">
      {props.collections.map((collection) => {
        // The actions of the collection are the words of the backend: the
        // studio does not shorten them into letters nobody can read.
        const actions =
          collection.actions.length > 0 ? (
            <span class="collection-actions">{collection.actions.join(' · ')}</span>
          ) : null
        const active = props.current === collection.key
        return (
          <button
            key={collection.key}
            class={`collection${active ? ' active' : ''}`}
            type="button"
            aria-current={active ? 'true' : undefined}
            onClick={() => props.select(collection.key)}
          >
            <span class="collection-text">
              <span class="collection-label" title={collection.key}>
                {collection.label}
              </span>
              {actions}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

/**
 * The side bar of the studio.
 *
 * On a small screen the collections are behind the way to them, and
 * they leave the canvas as soon as a collection is chosen.
 */
export function Sidebar(props: {
  workspace: string
  collections: CollectionMetadata[]
  current: string | null
  view: View
  open: boolean
  select: (key: string) => void
  show: (view: View) => void
  logout: () => void
}): JSX.Element {
  return (
    <aside class={`sidebar${props.open ? ' open' : ''}`} id="sidebar">
      <div class="sidebar-head">
        <span class="sidebar-title">Collections</span>
        <span class="workspace" id="workspace" title={props.workspace}>
          {props.workspace}
        </span>
      </div>
      <Collections collections={props.collections} current={props.current} select={props.select} />
      <div class="sidebar-foot">
        <button
          class={`link${props.view === 'aggregate' ? ' active' : ''}`}
          id="show-aggregate"
          type="button"
          aria-current={props.view === 'aggregate' ? 'true' : undefined}
          onClick={() => props.show('aggregate')}
        >
          Aggregate
        </button>
        <button
          class={`link${props.view === 'audit' ? ' active' : ''}`}
          id="show-audit"
          type="button"
          aria-current={props.view === 'audit' ? 'true' : undefined}
          onClick={() => props.show('audit')}
        >
          Audit log
        </button>
        <button class="link" id="logout" type="button" onClick={props.logout}>
          Log out
        </button>
      </div>
    </aside>
  )
}
