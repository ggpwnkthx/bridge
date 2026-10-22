/**
 * The HTTP boundary of the studio (spec §8).
 *
 * The module owns the routes, the parsing of the requests and the mapping
 * of the failures to the answers. It establishes the context of a request
 * before it does anything: a request of the studio carries the session of
 * the caller, and the identity of the gateway when the studio is deployed
 * behind it.
 *
 * The studio never calls the backend directly: every call goes through the
 * gateway, with the token of the caller. The studio does not decide what
 * the caller may do either: the metadata of the collections that the
 * backend answers is the answer of the policies of the deployment.
 */

import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { BridgeConfig } from '../platform/config'
import type { Assets } from '../platform/assets'
import type { Logger } from '../observability/logger'
import { type OidcClient, OidcError } from '../domains/identity/oidc'
import type { LoginStateStore, Session, SessionStore } from '../domains/identity/session'
import { randomIdentifier } from '../domains/identity/session'
import {
  LOGIN_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  loginCookie,
  loginDeletionCookie,
  parseCookies,
  sessionCookie,
  sessionDeletionCookie,
} from '../domains/identity/cookies'
import { verifyGatewayIdentity, type GatewayIdentity } from '../domains/gateway/identity'
import { BackendError, DepotClient } from '../domains/studio/depot'
import {
  QueryError,
  readAggregateQuery,
  readAuditQuery,
  readListQuery,
} from '../domains/studio/queries'
import { StudioError, errorEnvelope } from './errors'

/** The variables of the context of a request. */
export interface AppVariables {
  requestId: string
  session?: Session
  gateway?: GatewayIdentity
}

/** The environment of the application. */
export type AppEnv = { Variables: AppVariables }

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

/** Builds the application. */
export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { config } = dependencies

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID()
    c.set('requestId', requestId)
    c.header('x-request-id', requestId)
    const started = Date.now()
    try {
      await next()
    } finally {
      dependencies.logger.info('the request was answered', {
        requestId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        durationMs: Date.now() - started,
      })
    }
  })

  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? 'unknown'
    if (error instanceof StudioError) {
      return c.json(errorEnvelope(error, requestId), error.status as ContentfulStatusCode)
    }
    if (error instanceof BackendError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details.length > 0 ? { details: error.details } : {}),
          },
          requestId: error.requestId,
        },
        error.status as ContentfulStatusCode
      )
    }
    if (error instanceof QueryError) {
      return c.json(errorEnvelope(new StudioError('INVALID_QUERY', error.message), requestId), 400)
    }
    dependencies.logger.error('the request could not be completed', {
      requestId,
      error: error instanceof Error ? error.message : 'unknown error',
    })
    return c.json(
      errorEnvelope(
        new StudioError('INTERNAL_ERROR', 'the request could not be completed', { status: 500 }),
        requestId
      ),
      500
    )
  })

  app.notFound((c) => {
    const requestId = c.get('requestId') ?? 'unknown'
    return c.json(
      errorEnvelope(
        new StudioError('NOT_FOUND', 'this path does not exist', { status: 404 }),
        requestId
      ),
      404
    )
  })

  // The probes of the deployment.
  if (config.probes) {
    app.get('/healthz', (c) => c.json({ status: 'ok', service: 'bridge', version: '0.1.0' }))
    app.get('/readyz', (c) => c.json({ status: 'ready' }))
  }

  // The assets of the user interface.
  app.get('/assets/*', async (c) => {
    const path = c.req.path.replace(/^\//, '')
    const file = await dependencies.assets.file(path)
    if (!file) return c.notFound()
    return new Response(file.body, {
      status: 200,
      headers: {
        'content-type': file.contentType,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      },
    })
  })

  app.get('/', (c) => {
    const workspace = config.workspaces[0]
    if (workspace) return c.redirect(`/w/${workspace}/`, 302)
    return c.redirect('/login', 302)
  })

  // The login of the studio, against the broker of the platform.
  app.get('/login', async (c) => {
    const workspace = c.req.query('workspace')
    const state = randomIdentifier()
    const nonce = randomIdentifier(16)
    const verifier = randomIdentifier(48)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    dependencies.logins.set({
      id: randomIdentifier(16),
      state,
      nonce,
      codeVerifier: verifier,
      ...(workspace ? { workspaceId: workspace } : {}),
      expiresAt: Date.now() + 10 * 60 * 1000,
    })
    const url = await dependencies.oidc.authorizationUrl({ state, nonce, codeChallenge: challenge })
    c.header('set-cookie', loginCookie(state, 600, { secure: config.secureCookies }))
    return c.redirect(url, 302)
  })

  app.get('/auth/callback', async (c) => {
    const cookies = parseCookies(c.req.header('cookie'))
    const cookieState = cookies.get(LOGIN_COOKIE_NAME)
    const state = c.req.query('state')
    const code = c.req.query('code')
    const login = state ? dependencies.logins.take(state) : undefined
    c.header('set-cookie', loginDeletionCookie({ secure: config.secureCookies }), { append: true })

    if (!login || !code || !cookieState || cookieState !== login.state) {
      return redirectToStudio(c, dependencies, login?.workspaceId, 'the login was not completed')
    }
    try {
      const tokens = await dependencies.oidc.exchange(code, login.codeVerifier)
      const claims = tokens.idToken
        ? await dependencies.oidc.verifyIdToken(tokens.idToken, login.nonce)
        : undefined
      const profile = await dependencies.oidc.profile(tokens.accessToken, tokens.idToken)
      const subject = profile.subject
      if (claims && typeof claims.sub === 'string' && claims.sub !== subject) {
        throw new OidcError('the profile and the token of the identity disagree', {
          code: 'subject_mismatch',
          status: 401,
        })
      }
      const session: Session = {
        id: randomIdentifier(),
        principal: {
          subject,
          ...(profile.email ? { email: profile.email } : {}),
          ...(profile.name ? { name: profile.name } : {}),
          roles: profile.roles,
          ...(profile.tenantId ? { tenantId: profile.tenantId } : {}),
        },
        accessToken: tokens.accessToken,
        ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
        expiresAt: Date.now() + config.sessionTtlSeconds * 1000,
        csrfToken: randomIdentifier(24),
      }
      dependencies.sessions.set(session)
      c.header(
        'set-cookie',
        sessionCookie(session.id, config.sessionTtlSeconds, {
          secure: config.secureCookies,
        }),
        { append: true }
      )
      dependencies.logger.info('a caller logged in', {
        requestId: c.get('requestId'),
        subject: session.principal.subject,
      })
      return redirectToStudio(c, dependencies, login.workspaceId)
    } catch (error) {
      dependencies.logger.warn('the login could not be completed', {
        requestId: c.get('requestId'),
        error: error instanceof Error ? error.message : 'unknown error',
      })
      return redirectToStudio(c, dependencies, login.workspaceId, 'the login was refused')
    }
  })

  app.post('/logout', (c) => {
    const cookies = parseCookies(c.req.header('cookie'))
    const session = cookies.get(SESSION_COOKIE_NAME)
    if (session) dependencies.sessions.delete(session)
    c.header('set-cookie', sessionDeletionCookie({ secure: config.secureCookies }))
    return c.body(null, 204)
  })

  // The studio itself, and the api it speaks.
  const scope = '/w/:workspaceId'
  const api = `${scope}/api`

  app.get(`${scope}/`, async (c) => {
    const workspace = workspaceOf(c, dependencies)
    const shell = await dependencies.assets.shell()
    if (!shell) {
      return c.json(
        errorEnvelope(
          new StudioError('NOT_READY', 'the studio was built without its assets', { status: 503 }),
          c.get('requestId') ?? 'unknown'
        ),
        503
      )
    }
    return c.html(shell.replace(/__BRIDGE_WORKSPACE__/g, workspace))
  })

  app.get(`${api}/session`, async (c) => {
    const session = await establish(c, dependencies)
    const gateway = c.get('gateway')
    return c.json({
      data: {
        principal: {
          subject: session.principal.subject,
          ...(session.principal.email ? { email: session.principal.email } : {}),
          ...(session.principal.name ? { name: session.principal.name } : {}),
          roles: session.principal.roles,
          ...(session.principal.tenantId ? { tenantId: session.principal.tenantId } : {}),
        },
        workspace: workspaceOf(c, dependencies),
        csrfToken: session.csrfToken,
        gateway: gateway
          ? {
              subject: gateway.subject,
              roles: gateway.roles,
              ...(gateway.workspaceId ? { workspaceId: gateway.workspaceId } : {}),
            }
          : null,
      },
    })
  })

  app.get(`${api}/schema`, async (c) => {
    const client = await clientOf(c, dependencies)
    const schema = await client.schema()
    return c.json({ data: schema })
  })

  app.get(`${api}/schema/:collection`, async (c) => {
    const client = await clientOf(c, dependencies)
    const collection = await client.collection(c.req.param('collection'))
    return c.json({ data: collection })
  })

  app.get(`${api}/items/:collection`, async (c) => {
    const client = await clientOf(c, dependencies)
    const query = readListQuery(new URL(c.req.url).searchParams)
    const page = await client.list(c.req.param('collection'), query)
    return c.json({ data: page.data, meta: page.meta })
  })

  app.get(`${api}/items/:collection/:id`, async (c) => {
    const client = await clientOf(c, dependencies)
    const record = await client.get(c.req.param('collection'), c.req.param('id'))
    return c.json({ data: record.row, etag: record.etag })
  })

  app.post(`${api}/items/:collection`, async (c) => {
    const client = await clientOf(c, dependencies)
    const body = await readBody(c)
    const idempotencyKey = idempotencyKeyOf(c)
    const receipt = await client.create(c.req.param('collection'), body, idempotencyKey)
    return c.json({ data: receipt }, 201)
  })

  app.patch(`${api}/items/:collection/:id`, async (c) => {
    const client = await clientOf(c, dependencies)
    const body = await readBody(c)
    const etag = c.req.header('if-match')
    if (!etag) {
      throw new StudioError('INVALID_REQUEST', 'the validator of the record is required', {
        status: 400,
      })
    }
    const record = await client.update(c.req.param('collection'), c.req.param('id'), body, etag)
    return c.json({ data: record.row, etag: record.etag })
  })

  app.delete(`${api}/items/:collection/:id`, async (c) => {
    const client = await clientOf(c, dependencies)
    const etag = c.req.header('if-match')
    if (!etag) {
      throw new StudioError('INVALID_REQUEST', 'the validator of the record is required', {
        status: 400,
      })
    }
    await client.remove(c.req.param('collection'), c.req.param('id'), etag)
    return c.body(null, 204)
  })

  app.get(`${api}/aggregate/:collection`, async (c) => {
    const client = await clientOf(c, dependencies)
    const query = readAggregateQuery(new URL(c.req.url).searchParams)
    const result = await client.aggregate(c.req.param('collection'), query)
    return c.json({ data: result.data, meta: result.meta })
  })

  app.get(`${api}/audit`, async (c) => {
    const client = await clientOf(c, dependencies)
    const query = readAuditQuery(new URL(c.req.url).searchParams)
    const page = await client.audit(query)
    return c.json({ data: page.data, meta: page.meta })
  })

  return app
}

/**
 * The workspace of a request.
 *
 * The workspace is the one of the path of the studio, and it has to be
 * one of the workspaces the deployment of the studio serves.
 */
function workspaceOf(c: Context<AppEnv>, dependencies: AppDependencies): string {
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
async function establish(c: Context<AppEnv>, dependencies: AppDependencies): Promise<Session> {
  const session = await readSession(c, dependencies)
  const gateway = await readGateway(c, dependencies)
  if (gateway && gateway.subject !== session.principal.subject) {
    throw new StudioError(
      'IDENTITY_MISMATCH',
      'the caller of the gateway is not the one who logged in',
      { status: 403 }
    )
  }
  if (MUTATIONS.has(c.req.method)) {
    checkCsrf(c, session, dependencies)
  }
  return session
}

/** The session of a request. */
async function readSession(c: Context<AppEnv>, dependencies: AppDependencies): Promise<Session> {
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
async function readGateway(
  c: Context<AppEnv>,
  dependencies: AppDependencies
): Promise<GatewayIdentity | undefined> {
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
    key.version === 'v5'
      ? { version: 'v5', publicKeyPem: key.key }
      : { version: 'v4', derivedKeyBase64: key.key }
  )
  if (!result.ok) {
    throw new StudioError('INVALID_GATEWAY_IDENTITY', result.reason, { status: 403 })
  }
  c.set('gateway', result.identity)
  if (dependencies.config.bindGatewayWorkspace && result.identity.workspaceId) {
    const workspace = workspaceOf(c, dependencies)
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
function checkCsrf(c: Context<AppEnv>, session: Session, dependencies: AppDependencies): void {
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
async function clientOf(c: Context<AppEnv>, dependencies: AppDependencies): Promise<DepotClient> {
  const session = await establish(c, dependencies)
  const workspace = workspaceOf(c, dependencies)
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
function idempotencyKeyOf(c: Context<AppEnv>): string {
  const presented = c.req.header('idempotency-key')
  if (presented && /^[A-Za-z0-9._-]{1,128}$/.test(presented)) return presented
  return randomIdentifier(16)
}

/** The body of a change, as a json document. */
async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
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
function redirectToStudio(
  c: Context<AppEnv>,
  dependencies: AppDependencies,
  workspaceId: string | undefined,
  error?: string
): Response {
  const workspace = workspaceId ?? dependencies.config.workspaces[0]
  const target = workspace
    ? `/w/${workspace}/${error ? `?error=${encodeURIComponent(error)}` : ''}`
    : `/${error ? `?error=${encodeURIComponent(error)}` : ''}`
  c.header('cache-control', 'no-store')
  return c.redirect(target, 302)
}
