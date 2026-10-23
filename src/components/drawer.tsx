/**
 * The drawer of a record.
 *
 * The drawer shows a row and it edits it: it holds the fields the
 * caller may write, it writes nothing the caller did not change, and it
 * asks before it throws a change away.
 */

import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { cellValue, columnLabel, humanizeName, identityField } from '../client/format'
import type { CollectionMetadata, FieldMetadata, Row } from '../client/types'
import { fieldValue } from '../client/values'
import { useStudio } from './context'
import { Notice } from './notice'

/** A control of the drawer: the value the caller wrote. */
type Values = Record<string, string | boolean>

/**
 * The drawer of a record.
 *
 * The drawer reads the record when it opens, and it writes it when the
 * caller asks for it. A change that was not saved waits for a second
 * answer, in the same language as the removal of a record.
 */
export function Drawer(props: {
  collection: CollectionMetadata
  id: string | null
  /** The number of the requests to close the drawer: the curtain asks. */
  closing: number
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const studio = useStudio()
  const { collection, id } = props
  const [row, setRow] = useState<Row | null>(null)
  const [etag, setEtag] = useState('')
  const [values, setValues] = useState<Values>({})
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<unknown>(null)
  const [notice, setNotice] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [discardArmed, setDiscardArmed] = useState(false)
  const title = useRef<HTMLHeadingElement | null>(null)
  // The key of a creation is bound to the form of the record: a
  // creation that is sent twice answers with the same receipt, and not
  // with two records.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  // The record is read when the drawer opens.
  useEffect(() => {
    let live = true
    setLoading(true)
    setFailure(null)
    if (!id) {
      setRow({})
      setEtag('')
      setValues(initialValues(collection, {}))
      setLoading(false)
      return
    }
    studio.api
      .get<{ data: Row; etag: string }>(
        `/items/${encodeURIComponent(collection.key)}/${encodeURIComponent(id)}`
      )
      .then((answer) => {
        if (!live) return
        setRow(answer.data)
        setEtag(answer.etag)
        setValues(initialValues(collection, answer.data))
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (!live) return
        setFailure(error)
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [studio.api, collection.key, id])

  // The drawer takes the focus when it opens.
  useEffect(() => {
    if (loading) return
    title.current?.focus()
  }, [loading])

  const writable = useMemo(() => new Set(collection.writableFields), [collection])
  const fields = collection.fields.filter(
    (field) => collection.readableFields.includes(field.name) || writable.has(field.name)
  )

  const dirty = useMemo(() => isDirty(collection, values, row), [collection, values, row])

  const close = (): void => {
    // The changes that were not saved are not thrown away without an
    // answer: the drawer asks before it closes.
    if (dirty) {
      setDiscardArmed(true)
      return
    }
    props.onClose()
  }

  // The curtain of the drawer asks for the same answer as the button
  // that closes it.
  useEffect(() => {
    if (props.closing === 0) return
    close()
  }, [props.closing])

  const save = async (): Promise<void> => {
    // A change that is in flight is not sent again.
    if (pending) return
    const body: Record<string, unknown> = {}
    for (const field of fields) {
      if (!writable.has(field.name)) continue
      const raw = values[field.name]
      if (raw === undefined) continue
      // The studio writes the value the field declares, and it writes
      // nothing for a field the caller did not change.
      const written = fieldValue(field, raw, row?.[field.name])
      if (!written.write) continue
      body[field.name] = written.value
    }
    setPending(true)
    try {
      if (id) {
        await studio.api.send(
          'PATCH',
          `/items/${encodeURIComponent(collection.key)}/${encodeURIComponent(id)}`,
          body,
          { etag }
        )
        studio.toast('The record was saved.', 'ok')
      } else {
        await studio.api.send('POST', `/items/${encodeURIComponent(collection.key)}`, body, {
          idempotencyKey,
        })
        studio.toast('The record was created.', 'ok')
      }
      props.onChanged()
      props.onClose()
    } catch (error) {
      // The form keeps what the caller wrote: the answer of the backend
      // is shown under it.
      setNotice(error)
    } finally {
      setPending(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (pending || !id) return
    setPending(true)
    try {
      await studio.api.send(
        'DELETE',
        `/items/${encodeURIComponent(collection.key)}/${encodeURIComponent(id)}`,
        undefined,
        { etag }
      )
      studio.toast('The record was deleted.', 'ok')
      props.onChanged()
      props.onClose()
    } catch (error) {
      setNotice(error)
    } finally {
      setPending(false)
    }
  }

  const identity = identityField(
    collection.readableFields.length > 0 ? collection.readableFields : ['id']
  )
  const named = row && id ? cellValue(collection, identity, row[identity]).text : ''
  const heading = id
    ? named && named !== '—'
      ? named
      : 'Record'
    : `New record of ${collection.label}`

  return (
    <div
      class="drawer"
      id="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
          return
        }
        if (event.key === 'Tab') trapFocus(event, event.currentTarget)
      }}
    >
      <div class="drawer-head" data-collection={collection.key} data-record={id ?? ''}>
        <h2 id="drawer-title" tabindex={-1} ref={title}>
          {heading}
        </h2>
        <div class="meta">
          {collection.key}
          {id ? <span class="mono">{id}</span> : null}
        </div>
      </div>
      {loading ? (
        <div class="loading">Loading the record.</div>
      ) : failure ? (
        <Notice error={failure} />
      ) : (
        <form
          id="record-form"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {fields.map((field, index) => (
            <Field
              key={field.name}
              collection={collection}
              collections={studio.schema?.collections ?? []}
              field={field}
              index={index}
              editable={writable.has(field.name)}
              value={values[field.name]}
              write={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
            />
          ))}
        </form>
      )}
      {notice ? (
        <div class="drawer-notice">
          <Notice error={notice} />
        </div>
      ) : null}
      <Actions
        collection={collection}
        id={id}
        pending={pending}
        deleteArmed={deleteArmed}
        discardArmed={discardArmed}
        save={() => void save()}
        remove={() => void remove()}
        close={close}
        discard={() => props.onClose()}
        keepEditing={() => {
          setDiscardArmed(false)
          const first = document.querySelector<HTMLElement>(
            '.drawer .field input, .drawer .field select, .drawer .field textarea'
          )
          first?.focus()
        }}
        armDelete={() => setDeleteArmed(true)}
        keepDelete={() => {
          setDeleteArmed(false)
          const target = document.querySelector<HTMLElement>('.drawer [data-action="delete"]')
          target?.focus()
        }}
      />
    </div>
  )
}

/** The actions of the drawer: the change of the record, or the removal of it. */
function Actions(props: {
  collection: CollectionMetadata
  id: string | null
  pending: boolean
  deleteArmed: boolean
  discardArmed: boolean
  save: () => void
  remove: () => void
  close: () => void
  discard: () => void
  keepEditing: () => void
  armDelete: () => void
  keepDelete: () => void
}): JSX.Element {
  const { collection, id } = props
  const canUpdate = collection.actions.includes('update') && collection.writableFields.length > 0
  const canCreate = collection.actions.includes('create')
  const canDelete = collection.actions.includes('delete') && id !== null

  // The changes that were not saved wait for a second answer, in the
  // same language as the deletion of a record.
  if (props.discardArmed) {
    return (
      <div class="drawer-actions">
        <span class="drawer-question">Discard the changes you made?</span>
        <button class="danger" type="button" data-action="discard" onClick={props.discard}>
          Discard
        </button>
        <button class="ghost" type="button" data-action="keep" onClick={props.keepEditing}>
          Keep editing
        </button>
      </div>
    )
  }

  // The delete of a record waits for a second answer, in the drawer of
  // the record itself: the question and its answer are in the language
  // of the studio.
  if (props.deleteArmed) {
    return (
      <div class="drawer-actions">
        <span class="drawer-question">
          Delete the record <span class="mono">{id}</span> of {collection.label}?
        </span>
        <button class="danger" type="button" onClick={props.remove}>
          Delete
        </button>
        <button class="ghost" type="button" onClick={props.keepDelete}>
          Keep it
        </button>
      </div>
    )
  }

  return (
    <div class="drawer-actions">
      <div class="drawer-buttons">
        {canCreate && !id ? (
          <button
            class="primary"
            type="submit"
            form="record-form"
            data-action="create"
            disabled={props.pending}
          >
            Create
          </button>
        ) : null}
        {canUpdate && id ? (
          <button
            class="primary"
            type="button"
            data-action="save"
            disabled={props.pending}
            onClick={props.save}
          >
            Save
          </button>
        ) : null}
        {canDelete ? (
          <button
            class="danger"
            type="button"
            data-action="delete"
            disabled={props.pending}
            onClick={props.armDelete}
          >
            Delete
          </button>
        ) : null}
        <button class="ghost" type="button" data-action="close" onClick={props.close}>
          Close
        </button>
      </div>
    </div>
  )
}

/** A field of the record, in the drawer. */
function Field(props: {
  collection: CollectionMetadata
  collections: CollectionMetadata[]
  field: FieldMetadata
  index: number
  editable: boolean
  value: string | boolean | undefined
  write: (value: string | boolean) => void
}): JSX.Element {
  const { collection, field, index } = props
  const inputId = `field-${index}`
  const hintId = `field-${index}-hint`
  const value = props.value
  const common = {
    id: inputId,
    disabled: !props.editable,
    'aria-describedby': field.description ? hintId : undefined,
  }
  const control = field.enum ? (
    <select
      {...common}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => props.write(event.currentTarget.value)}
    >
      {/* A field that cannot be empty does not offer the empty choice: the
      studio never offers a state the record cannot hold. */}
      {field.nullable ? <option value="">—</option> : null}
      {field.enum.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  ) : field.type === 'text' ? (
    <textarea
      {...common}
      rows={6}
      value={typeof value === 'string' ? value : ''}
      onInput={(event) => props.write(event.currentTarget.value)}
    />
  ) : field.type === 'boolean' ? (
    <input
      {...common}
      type="checkbox"
      checked={value === true}
      onChange={(event) => props.write(event.currentTarget.checked)}
    />
  ) : field.type === 'number' || field.type === 'integer' ? (
    <input
      {...common}
      type="number"
      value={typeof value === 'string' ? value : ''}
      onInput={(event) => props.write(event.currentTarget.value)}
    />
  ) : (
    <input
      {...common}
      type="text"
      value={typeof value === 'string' ? value : ''}
      onInput={(event) => props.write(event.currentTarget.value)}
    />
  )
  return (
    <div class="field">
      <label for={inputId}>
        {columnLabel(collection, field.name)}
        {field.required ? ' *' : null}
        {field.required ? <span class="visually-hidden"> (required)</span> : null}
      </label>
      {control}
      {field.description ? (
        <div class="hint" id={hintId}>
          {field.description}
        </div>
      ) : null}
      {relationHint(props, field)}
    </div>
  )
}

/**
 * The hint of a field that holds the identifier of another record.
 *
 * The studio does not resolve the relation — that is the work of the
 * backend — but it says what the identifier is the identifier of.
 */
function relationHint(
  props: { collection: CollectionMetadata; collections: CollectionMetadata[] },
  field: FieldMetadata
): JSX.Element | null {
  const relation = props.collection.relations.find(
    (entry) =>
      entry.name === field.name ||
      `${entry.name}_id` === field.name ||
      entry.name.startsWith(`${field.name}_`)
  )
  if (!relation) return null
  const target = props.collections.find((entry) => entry.key === relation.target)
  const name = target?.label ?? humanizeName(relation.target)
  return <div class="hint">the identifier of a record of {name}</div>
}

/** The values of the form of a record, as they are read from the row. */
function initialValues(collection: CollectionMetadata, row: Row): Values {
  const values: Values = {}
  for (const field of collection.fields) {
    const value = row[field.name]
    // A field that has no value is an empty field: the studio writes
    // the text "null" in no control, and it sends no value it did not
    // read.
    if (value === undefined || value === null) {
      values[field.name] = field.type === 'boolean' ? false : ''
      continue
    }
    if (typeof value === 'object') {
      values[field.name] = JSON.stringify(value)
      continue
    }
    values[field.name] = typeof value === 'boolean' ? value : String(value)
  }
  return values
}

/**
 * Whether the drawer holds changes that were not saved.
 *
 * The studio compares what the caller wrote with what the record held:
 * the drawer asks before it throws a change away.
 */
function isDirty(collection: CollectionMetadata, values: Values, row: Row | null): boolean {
  if (!row) return false
  for (const field of collection.fields) {
    if (!collection.writableFields.includes(field.name)) continue
    const raw = values[field.name]
    if (raw === undefined) continue
    const held = row[field.name]
    const written = fieldValue(field, raw, held)
    if (!written.write) continue
    if (held === undefined || held === null) {
      if (written.value === null) continue
      return true
    }
    if (written.value !== held) return true
  }
  return false
}

/**
 * Keeps the focus of the keyboard inside the drawer.
 *
 * The page behind the drawer is inert when the browser knows it; this
 * is the way for the browsers that do not.
 */
function trapFocus(event: KeyboardEvent, drawer: HTMLElement): void {
  const focusable = Array.from(
    drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    )
  ).filter((element) => element.offsetParent !== null)
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return
  const active = document.activeElement
  if (event.shiftKey && (active === first || !drawer.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
