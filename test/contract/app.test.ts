/**
 * The contract of the http surface of the studio.
 *
 * The tests run the studio against a broker and against a backend that
 * are both local: the login is a real login against a real discovery, the
 * exchange is a real exchange and the calls of the studio are the calls
 * the studio makes.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { createStudioApp } from '../../src/server'
import { OidcClient } from '../../src/domains/identity/oidc'
import { MemoryLoginStateStore, MemorySessionStore } from '../../src/domains/identity/session'
import { emptyAssets } from '../../src/platform/assets'
import { readConfig } from '../../src/platform/config'
import { silentLogger } from '../../src/observability/logger'

/** The workspace of the tests. */
const WORKSPACE = '22222222-2222-4222-8222-222222222222'
/** The client of the studio at the broker. */
const CLIENT_ID = 'bridge-test'
/** The subject of the caller. */
const SUBJECT = 'b1c2d3e4-1111-4111-8111-111111111111'

/** The broker of the tests. */
let hub: ReturnType<typeof Bun.serve>
/** The backend of the tests, behind the gateway. */
let backend: ReturnType<typeof Bun.serve>
/** The key of the broker of the tests. */
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
/** The nonce of the login that is in flight. */
let nonce = ''

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  signingKey = pair.privateKey
  const jwk = await exportJWK(pair.publicKey)
  Object.assign(jwk, { kid: 'test-key', alg: 'RS256', use: 'sig' })

  hub = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({
          issuer: `http://localhost:${hub.port}`,
          authorization_endpoint: `http://localhost:${hub.port}/oauth/authorize`,
          token_endpoint: `http://localhost:${hub.port}/oauth/token`,
          userinfo_endpoint: `http://localhost:${hub.port}/oauth/userinfo`,
          jwks_uri: `http://localhost:${hub.port}/oauth/jwks`,
        })
      }
      if (url.pathname === '/oauth/authorize') {
        nonce = url.searchParams.get('nonce') ?? ''
        const redirect = new URL(url.searchParams.get('redirect_uri') ?? '/')
        redirect.searchParams.set('code', 'the-code')
        redirect.searchParams.set('state', url.searchParams.get('state') ?? '')
        return new Response(null, { status: 302, headers: { location: redirect.toString() } })
      }
      if (url.pathname === '/oauth/token') {
        const idToken = await new SignJWT({ nonce, email: 'alice@example.com', name: 'Alice' })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer(`http://localhost:${hub.port}`)
          .setAudience(CLIENT_ID)
          .setSubject(SUBJECT)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(signingKey)
        return Response.json({
          access_token: 'the-access-token',
          id_token: idToken,
          token_type: 'Bearer',
          expires_in: 300,
        })
      }
      if (url.pathname === '/oauth/userinfo') {
        return Response.json({
          sub: SUBJECT,
          email: 'alice@example.com',
          name: 'Alice',
          roles: ['editor'],
        })
      }
      if (url.pathname === '/oauth/jwks') {
        return Response.json({ keys: [jwk] })
      }
      return new Response('not found', { status: 404 })
    },
  })

  backend = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const authorization = request.headers.get('authorization')
      if (authorization !== 'Bearer the-access-token') {
        return Response.json(
          { error: { code: 'UNAUTHENTICATED', message: 'the caller is not known' } },
          { status: 401 }
        )
      }
      if (url.pathname === `/ws/${WORKSPACE}/v1/me`) {
        return Response.json({
          data: {
            principalId: SUBJECT,
            tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            workspaceId: WORKSPACE,
            routeId: 'data-api',
            apiVersion: 'v1',
          },
        })
      }
      if (url.pathname === `/ws/${WORKSPACE}/v1/schema`) {
        return Response.json({
          data: {
            apiVersion: 'v1',
            schemaVersion: '1',
            policyBundleVersion: '1',
            limits: { maxLimit: 200, defaultLimit: 50 },
            collections: [
              {
                key: 'articles',
                label: 'Articles',
                schemaVersion: '1',
                actions: ['read', 'create', 'update', 'delete'],
                readableFields: ['id', 'title', 'status'],
                writableFields: ['title', 'status'],
                filterableFields: ['status'],
                fields: [
                  { name: 'id', type: 'uuid', required: true, nullable: false },
                  { name: 'title', type: 'string', required: true, nullable: false },
                  { name: 'status', type: 'string', required: false, nullable: true },
                ],
                relations: [],
              },
            ],
          },
        })
      }
      if (url.pathname === `/ws/${WORKSPACE}/v1/items/articles` && request.method === 'GET') {
        return Response.json({
          data: [{ id: 'r1', version: 1, title: 'Hello', status: 'published' }],
          meta: { limit: 50, nextCursor: null },
        })
      }
      if (url.pathname === `/ws/${WORKSPACE}/v1/items/articles` && request.method === 'POST') {
        const key = request.headers.get('idempotency-key')
        if (!key) {
          return Response.json(
            { error: { code: 'INVALID_REQUEST', message: 'the idempotency key is required' } },
            { status: 400 }
          )
        }
        return Response.json({ data: { id: 'r2', version: 1 } }, { status: 201 })
      }
      if (url.pathname === `/ws/${WORKSPACE}/v1/audit`) {
        return Response.json({ data: [], meta: { limit: 50, nextCursor: null } })
      }
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'this path does not exist' } },
        { status: 404 }
      )
    },
  })
})

afterAll(() => {
  hub?.stop(true)
  backend?.stop(true)
})

/** Builds the studio of the tests. */
function studio() {
  const config = readConfig({
    NODE_ENV: 'test',
    BRIDGE_PUBLIC_URL: 'http://studio.test',
    BRIDGE_GATEWAY_URL: `http://localhost:${backend.port}`,
    BRIDGE_HUB_URL: `http://localhost:${hub.port}`,
    BRIDGE_HUB_CLIENT_ID: CLIENT_ID,
    BRIDGE_HUB_CLIENT_SECRET: 'the-secret',
    BRIDGE_WORKSPACES: WORKSPACE,
    BRIDGE_SECURE_COOKIES: 'false',
  })
  return createStudioApp({
    config,
    sessions: new MemorySessionStore({ ttlSeconds: 600 }),
    logins: new MemoryLoginStateStore(),
    oidc: new OidcClient({
      hubUrl: config.hubUrl,
      clientId: config.hub.clientId,
      clientSecret: config.hub.clientSecret,
      scope: config.hub.scope,
      redirectUri: config.hub.redirectUri,
    }),
    assets: emptyAssets(),
    logger: silentLogger(),
  })
}

/** The value of a cookie of an answer. */
function cookieOf(response: Response, name: string): string {
  const cookies = response.headers.getSetCookie()
  for (const cookie of cookies) {
    const [pair] = cookie.split(';')
    if (!pair) continue
    const separator = pair.indexOf('=')
    if (separator < 0) continue
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim()
    }
  }
  return ''
}

/** Logs a caller in and returns the cookie of the session. */
async function login(app: ReturnType<typeof studio>): Promise<string> {
  const start = await app.request('/login')
  expect(start.status).toBe(302)
  const location = start.headers.get('location') ?? ''
  // The browser follows the redirect: the broker reads the nonce of the
  // request and it binds it to the token of the identity.
  await fetch(location, { redirect: 'manual' })
  const state = new URL(location).searchParams.get('state') ?? ''
  const callback = await app.request(`/auth/callback?code=the-code&state=${state}`, {
    headers: { cookie: `bridge_login=${state}` },
  })
  expect(callback.status).toBe(302)
  expect(callback.headers.get('location')).not.toContain('error=')
  return cookieOf(callback, 'bridge_session')
}

describe('the studio', () => {
  test('the probes of the deployment answer', async () => {
    const app = studio()
    const health = await app.request('/healthz')
    expect(health.status).toBe(200)
    expect((await health.json()) as { status: string }).toMatchObject({ status: 'ok' })
  })

  test('the api refuses a caller that is not logged in', async () => {
    const app = studio()
    const answer = await app.request(`/w/${WORKSPACE}/api/session`)
    expect(answer.status).toBe(401)
    const body = (await answer.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED')
  })

  test('a login gives a session and the identity of the caller', async () => {
    const app = studio()
    const session = await login(app)
    expect(session.length).toBeGreaterThan(0)
    const answer = await app.request(`/w/${WORKSPACE}/api/session`, {
      headers: { cookie: `bridge_session=${session}` },
    })
    expect(answer.status).toBe(200)
    const body = (await answer.json()) as {
      data: { principal: { subject: string; email: string }; workspace: string }
    }
    expect(body.data.principal.subject).toBe(SUBJECT)
    expect(body.data.principal.email).toBe('alice@example.com')
    expect(body.data.workspace).toBe(WORKSPACE)
  })

  test('the studio reads the collections of the workspace', async () => {
    const app = studio()
    const session = await login(app)
    const answer = await app.request(`/w/${WORKSPACE}/api/schema`, {
      headers: { cookie: `bridge_session=${session}` },
    })
    expect(answer.status).toBe(200)
    const body = (await answer.json()) as { data: { collections: { key: string }[] } }
    expect(body.data.collections[0]?.key).toBe('articles')
  })

  test('the studio reads the rows of a collection', async () => {
    const app = studio()
    const session = await login(app)
    const answer = await app.request(`/w/${WORKSPACE}/api/items/articles`, {
      headers: { cookie: `bridge_session=${session}` },
    })
    expect(answer.status).toBe(200)
    const body = (await answer.json()) as { data: { title: string }[] }
    expect(body.data[0]?.title).toBe('Hello')
  })

  test('the studio refuses a query that is out of the bounds', async () => {
    const app = studio()
    const session = await login(app)
    const answer = await app.request(`/w/${WORKSPACE}/api/items/articles?limit=1000`, {
      headers: { cookie: `bridge_session=${session}` },
    })
    expect(answer.status).toBe(400)
    const body = (await answer.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_QUERY')
  })

  test('a change of the state needs the token of the session', async () => {
    const app = studio()
    const session = await login(app)
    const answer = await app.request(`/w/${WORKSPACE}/api/items/articles`, {
      method: 'POST',
      headers: { cookie: `bridge_session=${session}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    })
    expect(answer.status).toBe(403)
    const body = (await answer.json()) as { error: { code: string } }
    expect(body.error.code).toBe('CSRF_FAILED')
  })

  test('a change of the state with the token of the session is sent to the backend', async () => {
    const app = studio()
    const session = await login(app)
    const info = await app.request(`/w/${WORKSPACE}/api/session`, {
      headers: { cookie: `bridge_session=${session}` },
    })
    const body = (await info.json()) as { data: { csrfToken: string } }
    const answer = await app.request(`/w/${WORKSPACE}/api/items/articles`, {
      method: 'POST',
      headers: {
        cookie: `bridge_session=${session}`,
        'content-type': 'application/json',
        'x-bridge-csrf': body.data.csrfToken,
        'idempotency-key': 'the-key-of-the-creation',
      },
      body: JSON.stringify({ title: 'Hello' }),
    })
    expect(answer.status).toBe(201)
    const created = (await answer.json()) as { data: { id: string } }
    expect(created.data.id).toBe('r2')
  })

  test('the studio refuses a workspace it does not serve', async () => {
    const app = studio()
    const session = await login(app)
    const answer = await app.request('/w/11111111-1111-4111-8111-111111111111/api/session', {
      headers: { cookie: `bridge_session=${session}` },
    })
    expect(answer.status).toBe(403)
    const body = (await answer.json()) as { error: { code: string } }
    expect(body.error.code).toBe('WORKSPACE_NOT_ALLOWED')
  })

  test('the studio forwards the refusal of the backend', async () => {
    const app = studio()
    const session = await login(app)
    const answer = await app.request(`/w/${WORKSPACE}/api/items/unknown`, {
      headers: { cookie: `bridge_session=${session}` },
    })
    expect(answer.status).toBe(404)
    const body = (await answer.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('a logout deletes the session', async () => {
    const app = studio()
    const session = await login(app)
    const answer = await app.request('/logout', {
      method: 'POST',
      headers: { cookie: `bridge_session=${session}` },
    })
    expect(answer.status).toBe(204)
    const after = await app.request(`/w/${WORKSPACE}/api/session`, {
      headers: { cookie: `bridge_session=${session}` },
    })
    expect(after.status).toBe(401)
  })
})
