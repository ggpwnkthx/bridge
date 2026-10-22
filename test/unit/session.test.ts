/**
 * The tests of the sessions of the studio.
 */

import { describe, expect, test } from 'bun:test'
import {
  MemoryLoginStateStore,
  MemorySessionStore,
  type Session,
} from '../../src/domains/identity/session'

/** A session of the tests. */
function session(id: string, expiresAt: number): Session {
  return {
    id,
    principal: { subject: 'b1c2d3e4-1111-4111-8111-111111111111', roles: [] },
    accessToken: 'the-token',
    expiresAt,
    csrfToken: 'the-csrf',
  }
}

describe('the sessions of the studio', () => {
  test('it holds a session and gives it back', () => {
    const store = new MemorySessionStore({ ttlSeconds: 60 })
    store.set(session('a', Date.now() + 60_000))
    expect(store.get('a')?.accessToken).toBe('the-token')
    expect(store.size()).toBe(1)
  })

  test('it forgets a session that is expired', () => {
    const store = new MemorySessionStore({ ttlSeconds: 60 })
    store.set(session('a', Date.now() - 1))
    expect(store.get('a')).toBeUndefined()
    expect(store.size()).toBe(0)
  })

  test('it deletes a session', () => {
    const store = new MemorySessionStore({ ttlSeconds: 60 })
    store.set(session('a', Date.now() + 60_000))
    store.delete('a')
    expect(store.get('a')).toBeUndefined()
  })

  test('it does not grow without a bound', () => {
    const store = new MemorySessionStore({ ttlSeconds: 60, maxSessions: 3 })
    for (let index = 0; index < 10; index += 1) {
      store.set(session(`session-${index}`, Date.now() + 60_000))
    }
    expect(store.size()).toBeLessThanOrEqual(3)
  })
})

describe('the logins that are in flight', () => {
  test('a login is used once', () => {
    const store = new MemoryLoginStateStore()
    store.set({
      id: 'id',
      state: 'state',
      nonce: 'nonce',
      codeVerifier: 'verifier',
      expiresAt: Date.now() + 60_000,
    })
    expect(store.take('state')?.nonce).toBe('nonce')
    expect(store.take('state')).toBeUndefined()
  })

  test('a login that is expired is refused', () => {
    const store = new MemoryLoginStateStore()
    store.set({
      id: 'id',
      state: 'state',
      nonce: 'nonce',
      codeVerifier: 'verifier',
      expiresAt: Date.now() - 1,
    })
    expect(store.take('state')).toBeUndefined()
  })
})
