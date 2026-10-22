/**
 * The sessions of the studio (spec §5).
 *
 * A session of the studio holds the token of the caller and the profile
 * the broker published. It lives on the server: the browser holds an
 * opaque identifier in a cookie and nothing else, so a script of the
 * studio cannot read the token of the caller.
 *
 * The store of this module is in the process. A deployment with several
 * replicas needs a shared store, and the interface of this module is the
 * one it needs: the interface is small on purpose.
 */

import { randomBytes } from 'node:crypto'

/** The profile of the caller of a session. */
export interface SessionPrincipal {
  readonly subject: string
  readonly email?: string
  readonly name?: string
  readonly roles: readonly string[]
  readonly tenantId?: string
}

/** A session of the studio. */
export interface Session {
  readonly id: string
  readonly principal: SessionPrincipal
  /** The token the studio calls the gateway with. */
  readonly accessToken: string
  /** The token of the identity, when the broker issued one. */
  readonly idToken?: string
  /** The moment the session ends. */
  readonly expiresAt: number
  /** The token the browser sends with every change of the state. */
  readonly csrfToken: string
}

/** A login that is in flight. */
export interface LoginState {
  readonly id: string
  readonly state: string
  readonly nonce: string
  readonly codeVerifier: string
  readonly workspaceId?: string
  readonly expiresAt: number
}

/** The store of the sessions of the studio. */
export interface SessionStore {
  /** The session of an identifier, when it is alive. */
  get: (id: string) => Session | undefined
  /** Stores a session. */
  set: (session: Session) => void
  /** Deletes a session. */
  delete: (id: string) => void
  /** The number of the sessions that are alive. */
  size: () => number
}

/** The options of the store. */
export interface SessionStoreOptions {
  /** The lifetime of a session, in seconds. */
  readonly ttlSeconds: number
  /** The maximum number of the sessions that are alive at the same time. */
  readonly maxSessions?: number
}

/** The store of the sessions, in the process. */
export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, Session>()
  readonly #ttlMs: number
  readonly #maxSessions: number

  constructor(options: SessionStoreOptions) {
    this.#ttlMs = options.ttlSeconds * 1000
    this.#maxSessions = options.maxSessions ?? 10_000
  }

  get(id: string): Session | undefined {
    const session = this.#sessions.get(id)
    if (!session) return undefined
    if (session.expiresAt <= Date.now()) {
      this.#sessions.delete(id)
      return undefined
    }
    return session
  }

  set(session: Session): void {
    if (this.#sessions.size >= this.#maxSessions) {
      this.#evict()
    }
    const expiresAt = Number.isFinite(session.expiresAt)
      ? session.expiresAt
      : Date.now() + this.#ttlMs
    this.#sessions.set(session.id, { ...session, expiresAt })
  }

  delete(id: string): void {
    this.#sessions.delete(id)
  }

  size(): number {
    return this.#sessions.size
  }

  /** Removes the sessions that are expired, and the oldest one if needed. */
  #evict(): void {
    const now = Date.now()
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(id)
    }
    while (this.#sessions.size >= this.#maxSessions) {
      const oldest = this.#sessions.keys().next()
      if (oldest.done) break
      this.#sessions.delete(oldest.value)
    }
  }
}

/** The store of the logins that are in flight. */
export interface LoginStateStore {
  /** The state of a login, when it is alive. */
  take: (state: string) => LoginState | undefined
  /** Stores a login that is in flight. */
  set: (login: LoginState) => void
}

/** The store of the logins, in the process. */
export class MemoryLoginStateStore implements LoginStateStore {
  readonly #states = new Map<string, LoginState>()

  take(state: string): LoginState | undefined {
    const login = this.#states.get(state)
    this.#states.delete(state)
    if (!login) return undefined
    if (login.expiresAt <= Date.now()) return undefined
    return login
  }

  set(login: LoginState): void {
    if (this.#states.size > 1_000) {
      const now = Date.now()
      for (const [key, value] of this.#states) {
        if (value.expiresAt <= now) this.#states.delete(key)
      }
    }
    this.#states.set(login.state, login)
  }
}

/** An identifier of a session or of a login. */
export function randomIdentifier(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
