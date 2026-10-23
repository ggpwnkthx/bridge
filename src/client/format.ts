/**
 * The words of the studio.
 *
 * The backend names its fields the way a backend does. The studio shows
 * the names the caller knows, and it keeps the name of the backend in
 * the tooltip of the column. Every value is read as text: nothing of a
 * row of the backend becomes markup.
 */

import type { CollectionMetadata, FieldMetadata } from './types'

/** The names a record is known by, in the order the studio prefers them. */
const IDENTITY_NAMES = ['title', 'name', 'label', 'headline', 'subject', 'email']

/**
 * The name of a field, in the words of a person.
 *
 * The backend names its fields the way a backend does. The studio shows
 * the name the caller knows, and keeps the name of the backend in the
 * tooltip of the column.
 */
export function humanizeName(name: string): string {
  const words = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  if (words.length === 0) return name
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The metadata of a field of a collection. */
export function fieldMeta(collection: CollectionMetadata, name: string): FieldMetadata | undefined {
  return collection.fields.find((field) => field.name === name)
}

/**
 * The heading of a column.
 *
 * The label of the backend is the heading; a field without a label is
 * named in the words of a person.
 */
export function columnLabel(collection: CollectionMetadata, name: string): string {
  const label = fieldMeta(collection, name)?.label
  return label && label.trim().length > 0 ? label : humanizeName(name)
}

/**
 * The field that tells two rows apart.
 *
 * The studio shows the field the caller would name first, and falls
 * back on the identifier of the record.
 */
export function identityField(fields: string[]): string {
  for (const name of IDENTITY_NAMES) if (fields.includes(name)) return name
  if (fields.includes('id')) return 'id'
  return fields[0] ?? 'id'
}

/**
 * The columns of the table, in the order the caller reads them.
 *
 * The field that names the row comes first; the rest keep the order of
 * the backend.
 */
export function columnsOf(collection: CollectionMetadata): string[] {
  const fields = collection.readableFields.length > 0 ? collection.readableFields : ['id']
  const identity = identityField(fields)
  return [identity, ...fields.filter((field) => field !== identity)]
}

/**
 * A moment, in the words of a person.
 *
 * The studio shows the time the backend answered, in the time of the
 * machine of the caller, and keeps the text of the backend in the
 * tooltip of the value.
 */
export function formatMoment(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  // The moment is short: a column of a table has room for the day and
  // the hour. The text of the backend stays in the tooltip.
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/**
 * The value of a cell, and the text of the backend behind it.
 *
 * The studio shows the value the caller reads and keeps the value of
 * the backend in the tooltip of the cell.
 */
export function cellValue(
  collection: CollectionMetadata,
  field: string,
  value: unknown
): { text: string; title?: string } {
  if (isEmpty(value)) return { text: '—' }
  const type = fieldMeta(collection, field)?.type
  const moment = type === 'date' || type === 'timestamp' ? formatMoment(value) : null
  if (moment) return { text: moment, title: String(value) }
  // The columns the backend does not declare are read the way they
  // look: a moment is a moment, whatever the name of the column.
  const seen = formatMoment(value)
  if (seen) return { text: seen, title: String(value) }
  // A list of values is a list of values, not a document of json.
  if (Array.isArray(value)) {
    const text = value.every((item) => typeof item === 'string' || typeof item === 'number')
      ? value.join(', ')
      : renderValue(value)
    return { text, title: text }
  }
  const text = renderValue(value)
  return { text, title: text }
}

/** Renders a value of a row. */
export function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** Reports whether a value is empty. */
export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

/**
 * A count and its noun.
 *
 * The studio writes the counts of the backend for the caller, and the
 * count is written the way the language writes it: one row, two rows.
 */
export function plural(count: number, one: string, many?: string): string {
  const form = new Intl.PluralRules().select(count)
  const noun = form === 'one' ? one : (many ?? `${one}s`)
  return `${new Intl.NumberFormat().format(count)} ${noun}`
}
