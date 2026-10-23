/**
 * The context of a request of the studio.
 *
 * The routes of the studio are the files of `src/routes`, and they are
 * the routes of honox: every file is a path of the studio, and the
 * files of a directory are the routes of that directory.
 *
 * A route does not hold the dependencies of the studio: it reads them
 * from the context of the request, where the middleware of the studio
 * put them. The dependencies are given to the application when it is
 * built, and a test builds the studio with the dependencies it needs.
 */

import type { Context } from 'hono'
import { verifyGatewayIdentity, type GatewayIdentity } from '../domains/gateway/identity'
import type { OidcClient } from '../domains/identity/oidc'
import { parseCookies, SESSION_COOKIE_NAME } from '../domains/identity/cookies'
import type { LoginStateStore, Session, SessionStore } from '../domains/identity/session'
import { randomIdentifier } from '../domains/identity/session'
import { DepotClient } from '../domains/studio/depot'
import type { Assets } from '../platform/assets'
import type { BridgeConfig } from '../platform/config'
import type { Logger } from '../observability/logger'
import { StudioError } from './errors'

/** The variables of the context of a request. */
export interface AppVariables {
  /** The identifier of the request, for the logs of the deployment. */
  requestId: string
  /** The dependencies of the studio. */
  runtime: AppDependencies
  /** The session of the caller, when the request carries one. */
  session?: Session
  /** The identity of the gateway, when the request went through it. */
  gateway?: GatewayIdentity
}

/** The environment of the application. */
export type AppEnv = { Variables: AppVariables }

/**
 * The context of a route of the studio.
 *
 * The path of the route is part of its type: the parameters of the path
 * are read without a doubt, and the studio refuses to read a parameter
 * the route does not have.
 */
export type RouteContext<Path extends string = string> = Context<AppEnv, Path>

/** The dependencies of the application. */
export interface AppDependencies {
  readonly config: BridgeConfig
  readonly sessions: SessionStore
  readonly logins: LoginStateStore
  readonly oidc: OidcClient
  readonly assets: Assets
  readonly logger: Logger
  readonly fetch?: typeof globalThis.fetch
}

/** The pattern of an identifier of a workspace. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The methods that change the state of the studio. */
const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/**
 * The workspace of a request.
 *
 * The workspace is the one of the path of the studio, and it has to be
 * one of the workspaces the deployment of the studio serves.
 */
export function workspaceOf(c: Context<AppEnv>): string {
  const dependencies = c.get('runtime')
  const workspace = c.req.param('workspaceId') ?? ''
  if (!UUID_PATTERN.test(workspace)) {
    throw new StudioError('INVALID_WORKSPACE', 'the workspace of the path is not an identifier', {
      status: 404,
    })
  }
  const allowed = dependencies.config.workspaces
  if (allowed.length > 0 && !allowed.includes(workspace)) {
    throw new StudioError('WORKSPACE_NOT_ALLOWED', 'this studio does not serve this workspace', {
      status: 403,
    })
  }
  return workspace
}

/**
 * Establishes the context of a request of the api of the studio.
 *
 * The identity of the gateway is verified when the deployment gave a key
 * to verify it with, and it is required when the deployment says so. The
 * subject of the gateway and the subject of the session have to be the
 * same: the caller of the gateway is the one who logged in.
 */
export async function establish(c: Context<AppEnv>): Promise<Session> {
  const session = await readSession(c)
  const gateway = await readGateway(c)
  if (gateway && gateway.subject !== session.principal.subject) {
    throw new StudioError(
      'IDENTITY_MISMATCH',
      'the caller of the gateway is not the one who logged in',
      { status: 403 }
    )
  }
  if (MUTATIONS.has(c.req.method)) {
    checkCsrf(c, session)
  }
  return session
}

/** The session of a request. */
async function readSession(c: Context<AppEnv>): Promise<Session> {
  const dependencies = c.get('runtime')
  const cookies = parseCookies(c.req.header('cookie'))
  const identifier = cookies.get(SESSION_COOKIE_NAME)
  const session = identifier ? dependencies.sessions.get(identifier) : undefined
  if (!session) {
    throw new StudioError('AUTHENTICATION_REQUIRED', 'the caller is not logged in', {
      status: 401,
    })
  }
  c.set('session', session)
  return session
}

/** The identity of the gateway, when it is verified. */
async function readGateway(c: Context<AppEnv>): Promise<GatewayIdentity | undefined> {
  const dependencies = c.get('runtime')
  const key = dependencies.config.gatewayIdentityKey
  if (!key) {
    if (dependencies.config.requireGatewayIdentity) {
      throw new StudioError(
        'GATEWAY_IDENTITY_REQUIRED',
        'the request did not come through the gateway',
        {
          status: 403,
        }
      )
    }
    return undefined
  }
  const url = new URL(c.req.url)
  const result = await verifyGatewayIdentity(
    {
      method: c.req.method,
      path: url.pathname,
      query: url.search,
      host: c.req.header('x-forwarded-host') ?? '',
    },
    c.req.raw.headers,
    { version: 'v5', publicKeyPem: key.key }
  )
  if (!result.ok) {
    throw new StudioError('INVALID_GATEWAY_IDENTITY', result.reason, { status: 403 })
  }
  c.set('gateway', result.identity)
  if (dependencies.config.bindGatewayWorkspace && result.identity.workspaceId) {
    const workspace = workspaceOf(c)
    if (result.identity.workspaceId !== workspace) {
      throw new StudioError(
        'WORKSPACE_MISMATCH',
        'the gateway attributes the request to another workspace',
        { status: 403 }
      )
    }
  }
  return result.identity
}

/** The token that protects a change of the state against a forged request. */
function checkCsrf(c: Context<AppEnv>, session: Session): void {
  const dependencies = c.get('runtime')
  const presented = c.req.header('x-bridge-csrf') ?? ''
  if (!sameSecret(presented, session.csrfToken)) {
    throw new StudioError('CSRF_FAILED', 'the token of the request is missing or it is wrong', {
      status: 403,
    })
  }
  const origin = c.req.header('origin')
  if (origin) {
    const expected = new URL(dependencies.config.publicUrl).origin
    if (origin !== expected) {
      throw new StudioError('ORIGIN_REFUSED', 'the request comes from another site', {
        status: 403,
      })
    }
  }
}

/** Compares two secrets, without leaking their difference through the time. */
function sameSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

/** The client of the backend, for the caller of a request. */
export async function clientOf(c: Context<AppEnv>): Promise<DepotClient> {
  const dependencies = c.get('runtime')
  const session = await establish(c)
  const workspace = workspaceOf(c)
  return new DepotClient({
    gatewayUrl: dependencies.config.gatewayUrl,
    workspaceId: workspace,
    accessToken: session.accessToken,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
  })
}

/**
 * The key of a creation.
 *
 * The key of the browser is used when it carries one: a creation that is
 * sent twice answers with the same receipt, and not with two records. A
 * key that is not a short string is refused by the backend, so the studio
 * makes one of its own.
 */
export function idempotencyKeyOf(c: Context<AppEnv>): string {
  const presented = c.req.header('idempotency-key')
  if (presented && /^[A-Za-z0-9._-]{1,128}$/.test(presented)) return presented
  return randomIdentifier(16)
}

/** The body of a change, as a json document. */
export async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const contentType = c.req.header('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new StudioError('INVALID_REQUEST', 'the body must be a json document', { status: 400 })
  }
  const text = await c.req.text()
  if (text.length === 0) {
    throw new StudioError('INVALID_REQUEST', 'the body is empty', { status: 400 })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new StudioError('INVALID_REQUEST', 'the body is not json', { status: 400 })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StudioError('INVALID_REQUEST', 'the body is not an object', { status: 400 })
  }
  return parsed as Record<string, unknown>
}

/** The answer that sends the browser back to the studio. */
export function redirectToStudio(
  c: Context<AppEnv>,
  workspaceId: string | undefined,
  error?: string
): Response {
  const dependencies = c.get('runtime')
  const workspace = workspaceId ?? dependencies.config.workspaces[0]
  const target = workspace
    ? `/w/${workspace}${error ? `?error=${encodeURIComponent(error)}` : ''}`
    : `/${error ? `?error=${encodeURIComponent(error)}` : ''}`
  c.header('cache-control', 'no-store')
  return c.redirect(target, 302)
}
