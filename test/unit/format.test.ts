/**
 * The words of the studio.
 *
 * The studio reads the values of the backend as a person reads them: a
 * moment is a moment, a list is a list, and the name of a field is the
 * name the caller knows.
 */

import { describe, expect, test } from 'bun:test'
import {
  cellValue,
  columnLabel,
  columnsOf,
  fieldMeta,
  formatMoment,
  humanizeName,
  identityField,
  isEmpty,
  plural,
  renderValue,
} from '../../src/client/format'
import type { CollectionMetadata } from '../../src/client/types'

/** The collection of the tests. */
const collection: CollectionMetadata = {
  key: 'articles',
  label: 'Articles',
  actions: ['read'],
  readableFields: ['id', 'title', 'publishedAt', 'tags'],
  writableFields: ['title'],
  filterableFields: [],
  fields: [
    { name: 'id', type: 'uuid', required: true, nullable: false },
    { name: 'title', type: 'string', required: true, nullable: false, label: 'The title' },
    { name: 'publishedAt', type: 'timestamp', required: false, nullable: true },
    { name: 'tags', type: 'json', required: false, nullable: true },
  ],
  relations: [],
}

describe('the words of the studio', () => {
  test('a name of a field is a name of a person', () => {
    expect(humanizeName('published_at')).toBe('Published at')
    expect(humanizeName('publishedAt')).toBe('Published at')
    expect(humanizeName('title')).toBe('Title')
    expect(humanizeName('')).toBe('')
  })

  test('the heading of a column is the label of the backend', () => {
    expect(columnLabel(collection, 'title')).toBe('The title')
    expect(columnLabel(collection, 'publishedAt')).toBe('Published at')
  })

  test('the field that tells two rows apart comes first', () => {
    expect(identityField(['id', 'title'])).toBe('title')
    expect(identityField(['id', 'slug'])).toBe('id')
    expect(identityField([])).toBe('id')
    expect(columnsOf(collection)[0]).toBe('title')
  })

  test('a moment is a moment', () => {
    const moment = formatMoment('2026-10-22T18:10:13.000Z')
    expect(moment).not.toBeNull()
    expect(moment).not.toContain('2026-10-22T18:10:13.000Z')
    expect(formatMoment('a title')).toBeNull()
    expect(formatMoment(null)).toBeNull()
  })

  test('a cell shows what the caller reads', () => {
    expect(cellValue(collection, 'title', 'Hello')).toEqual({ text: 'Hello', title: 'Hello' })
    expect(cellValue(collection, 'title', null)).toEqual({ text: '—' })
    const moment = cellValue(collection, 'publishedAt', '2026-10-22T18:10:13.000Z')
    expect(moment.title).toBe('2026-10-22T18:10:13.000Z')
  })

  test('a list of values is a list of values', () => {
    expect(cellValue(collection, 'tags', ['a', 'b']).text).toBe('a, b')
    expect(cellValue(collection, 'tags', [{ a: 1 }]).text).toBe('[{"a":1}]')
  })

  test('the metadata of a field is found by its name', () => {
    expect(fieldMeta(collection, 'title')?.label).toBe('The title')
    expect(fieldMeta(collection, 'nothing')).toBeUndefined()
  })

  test('a value is read as text', () => {
    expect(renderValue('a')).toBe('a')
    expect(renderValue(2)).toBe('2')
    expect(renderValue(null)).toBe('—')
    expect(renderValue({ a: 1 })).toBe('{"a":1}')
    expect(isEmpty('')).toBe(true)
    expect(isEmpty(0)).toBe(false)
  })

  test('a count is written the way the language writes it', () => {
    expect(plural(1, 'row')).toBe('1 row')
    expect(plural(2, 'row')).toBe('2 rows')
    expect(plural(2, 'entry', 'entries')).toBe('2 entries')
  })
})
