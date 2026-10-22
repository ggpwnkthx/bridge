/**
 * The tests of the values of the fields of a record.
 */

import { describe, expect, test } from 'bun:test'
import { fieldValue, typedValue } from '../../src/client/values'

describe('the values of the fields of a record', () => {
  test('an integer is written as a number', () => {
    expect(typedValue({ type: 'integer' }, '42')).toBe(42)
    expect(typedValue({ type: 'integer' }, '-7')).toBe(-7)
  })

  test('a decimal is written as a text, as the backend wants it', () => {
    expect(typedValue({ type: 'decimal' }, '42.5')).toBe('42.5')
  })

  test('a json is written as the document it is', () => {
    expect(typedValue({ type: 'json' }, '{"status":"published"}')).toEqual({
      status: 'published',
    })
  })

  test('a value the studio cannot type is written as it was read', () => {
    expect(typedValue({ type: 'integer' }, 'twelve')).toBe('twelve')
    expect(typedValue({ type: 'json' }, '{not json')).toBe('{not json')
  })

  test('a text is written with its lines', () => {
    expect(typedValue({ type: 'text' }, 'a body\nwith its lines')).toBe('a body\nwith its lines')
  })

  test('a boolean is written as it is', () => {
    expect(fieldValue({ type: 'boolean' }, false, true)).toEqual({ write: true, value: false })
    expect(fieldValue({ type: 'boolean' }, true, null)).toEqual({ write: true, value: true })
  })

  test('a field that held a value and that was emptied is written as null', () => {
    expect(fieldValue({ type: 'text' }, '', 'a body')).toEqual({ write: true, value: null })
    expect(fieldValue({ type: 'uuid' }, '', 'a-uuid')).toEqual({ write: true, value: null })
  })

  test('a field that held nothing is not written', () => {
    expect(fieldValue({ type: 'text' }, '', null)).toEqual({ write: false, value: null })
    expect(fieldValue({ type: 'text' }, '', undefined)).toEqual({ write: false, value: null })
  })

  test('a field that was changed is written with the type of the field', () => {
    expect(fieldValue({ type: 'integer' }, '42', null)).toEqual({ write: true, value: 42 })
    expect(fieldValue({ type: 'text' }, 'a body', 'an other body')).toEqual({
      write: true,
      value: 'a body',
    })
  })
})
