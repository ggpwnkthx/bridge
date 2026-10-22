/**
 * The contract of the assets of the studio.
 */

import { describe, expect, test } from 'bun:test'
import { createApp } from '../../src/app/app'
import { OidcClient } from '../../src/domains/identity/oidc'
import { MemoryLoginStateStore, MemorySessionStore } from '../../src/domains/identity/session'
import type { Assets } from '../../src/platform/assets'
import { readConfig } from '../../src/platform/config'
import { silentLogger } from '../../src/observability/logger'

/** The workspace of the tests. */
const WORKSPACE = '22222222-2222-4222-8222-222222222222'

/** The assets of the tests. */
const assets: Assets = {
  async shell() {
    return '<html data-workspace="__BRIDGE_WORKSPACE__"></html>'
  },
  async file(path) {
    if (path !== 'assets/studio.js') return null
    return { body: new TextEncoder().encode('export const studio = true').buffer, contentType: 'text/javascript' }
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
  return createApp({
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
  test('the shell carries the workspace of the path', async () => {
    const app = studio()
    const answer = await app.request(`/w/${WORKSPACE}/`)
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toContain('text/html')
    const body = await answer.text()
    expect(body).toContain(`data-workspace="${WORKSPACE}"`)
    expect(body).not.toContain('__BRIDGE_WORKSPACE__')
  })

  test('the script of the browser is served', async () => {
    const app = studio()
    const answer = await app.request('/assets/studio.js')
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toContain('text/javascript')
    expect(await answer.text()).toContain('export const studio')
  })

  test('an asset that does not exist is refused', async () => {
    const app = studio()
    const answer = await app.request('/assets/nothing.js')
    expect(answer.status).toBe(404)
    const body = (await answer.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('a path that climbs out of the assets is refused', async () => {
    const app = studio()
    const answer = await app.request('/assets/../package.json')
    expect(answer.status).toBe(404)
  })
})
