/**
 * The contract of the assets of the studio.
 */

import { describe, expect, test } from 'bun:test'
import { OidcClient } from '../../src/domains/identity/oidc'
import { MemoryLoginStateStore, MemorySessionStore } from '../../src/domains/identity/session'
import type { Assets } from '../../src/platform/assets'
import { readConfig } from '../../src/platform/config'
import { silentLogger } from '../../src/observability/logger'
import { createStudioApp } from '../../src/server'

/** The workspace of the tests. */
const WORKSPACE = '22222222-2222-4222-8222-222222222222'

/** The assets of the tests. */
const assets: Assets = {
  async file(path) {
    if (path !== 'static/client.js') return null
    return {
      body: new TextEncoder().encode('export const studio = true').buffer,
      contentType: 'text/javascript',
    }
  },
}

/** Builds the studio of the tests. */
function studio() {
  const config = readConfig({
    NODE_ENV: 'test',
    BRIDGE_PUBLIC_URL: 'http://studio.test',
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
      scope: config.hub.scope,
      redirectUri: config.hub.redirectUri,
    }),
    assets,
    logger: silentLogger(),
  })
}

describe('the assets of the studio', () => {
  test('the page of the studio carries the workspace of the path', async () => {
    const app = studio()
    const answer = await app.request(`/w/${WORKSPACE}`)
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toContain('text/html')
    const body = await answer.text()
    expect(body).toContain(`data-workspace="${WORKSPACE}"`)
    expect(body).not.toContain('__BRIDGE_WORKSPACE__')
  })

  test('the page of the studio carries the script of the browser', async () => {
    const app = studio()
    const answer = await app.request(`/w/${WORKSPACE}`)
    const body = await answer.text()
    expect(body).toContain('<script type="module" src="/static/client.js">')
    expect(body).toContain('/static/styles.css')
  })

  test('the script of the browser is served', async () => {
    const app = studio()
    const answer = await app.request('/static/client.js')
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toContain('text/javascript')
    expect(await answer.text()).toContain('export const studio')
  })

  test('an asset that does not exist is refused', async () => {
    const app = studio()
    const answer = await app.request('/static/nothing.js')
    expect(answer.status).toBe(404)
    const body = (await answer.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('a path that climbs out of the assets is refused', async () => {
    const app = studio()
    const answer = await app.request('/static/../package.json')
    expect(answer.status).toBe(404)
  })
})
