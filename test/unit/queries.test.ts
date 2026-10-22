/**
 * The tests of the parameters of the queries of the studio.
 */

import { describe, expect, test } from 'bun:test'
import {
  QueryError,
  readAggregateQuery,
  readAuditQuery,
  readListQuery,
} from '../../src/domains/studio/queries'

describe('the queries of the studio', () => {
  test('it reads the parameters of a list', () => {
    const query = readListQuery(
      new URLSearchParams('limit=25&sort=-createdAt&search=hello&include_count=true')
    )
    expect(query.limit).toBe(25)
    expect(query.sort).toEqual(['-createdAt'])
    expect(query.search).toBe('hello')
    expect(query.includeCount).toBe(true)
  })

  test('it reads the filter as a json document', () => {
    const query = readListQuery(new URLSearchParams('filter={"status":{"_eq":"published"}}'))
    expect(query.filter).toEqual({ status: { _eq: 'published' } })
  })

  test('it refuses a filter that is not json', () => {
    expect(() => readListQuery(new URLSearchParams('filter=oops'))).toThrow(QueryError)
  })

  test('it refuses a limit that is out of the bounds', () => {
    expect(() => readListQuery(new URLSearchParams('limit=201'))).toThrow(QueryError)
    expect(() => readListQuery(new URLSearchParams('limit=0'))).toThrow(QueryError)
    expect(() => readListQuery(new URLSearchParams('limit=ten'))).toThrow(QueryError)
  })

  test('it refuses more fields than the contract allows', () => {
    const fields = Array.from({ length: 51 }, (_, index) => `field${index}`).join(',')
    expect(() => readListQuery(new URLSearchParams(`fields=${fields}`))).toThrow(QueryError)
  })

  test('it refuses more sorts than the contract allows', () => {
    expect(() => readListQuery(new URLSearchParams('sort=a,b,c,d'))).toThrow(QueryError)
  })

  test('it reads the parameters of an aggregate', () => {
    const query = readAggregateQuery(
      new URLSearchParams('group_by=status&metrics=count,sum:amount&limit=10')
    )
    expect(query.groupBy).toEqual(['status'])
    expect(query.metrics).toEqual(['count', 'sum:amount'])
    expect(query.limit).toBe(10)
  })

  test('it reads the parameters of the audit log', () => {
    const query = readAuditQuery(new URLSearchParams('limit=10&cursor=2026-01-01T00:00:00Z|abc'))
    expect(query.limit).toBe(10)
    expect(query.cursor).toBe('2026-01-01T00:00:00Z|abc')
  })
})
