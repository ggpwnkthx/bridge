/**
 * The values of the fields of a record.
 *
 * The studio writes the value the field declares: a number for an
 * integer, the document for a json, and the text for everything else.
 * The backend is the authority on what a record may hold, and the studio
 * does not change a value it cannot type.
 *
 * A field that the caller emptied and that held a value is written as
 * null: the caller cleared it. A field that held nothing is not written
 * at all.
 */

/** The metadata of a field of a collection, as the studio needs it. */
export interface FieldType {
  type: string
  nullable?: boolean
}

/** The value the studio writes for a field. */
export interface FieldValue {
  /** Whether the field is written at all. */
  write: boolean
  /** The value of the field, when it is written. */
  value: unknown
}

/**
 * The value of a field, in the type the field declares.
 *
 * A value the studio cannot type is written as it was read: the backend
 * refuses it, and the refusal is shown as it is.
 */
export function typedValue(field: FieldType, raw: string): unknown {
  switch (field.type) {
    case 'integer': {
      const number = Number(raw)
      return Number.isSafeInteger(number) ? number : raw
    }
    case 'json': {
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    }
    default:
      return raw
  }
}

/**
 * The value the studio writes for a field, or nothing.
 *
 * @param field the metadata of the field
 * @param raw the value of the control of the field
 * @param held the value the record held, before the caller touched it
 */
export function fieldValue(field: FieldType, raw: string | boolean, held: unknown): FieldValue {
  // A box is ticked or not: a boolean is never empty.
  if (typeof raw === 'boolean') return { write: true, value: raw }
  if (raw.trim().length === 0) {
    const had = held !== undefined && held !== null && held !== ''
    return had ? { write: true, value: null } : { write: false, value: null }
  }
  return { write: true, value: typedValue(field, raw) }
}
