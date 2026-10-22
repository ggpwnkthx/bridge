#!/usr/bin/env bun
/**
 * The smoke test of the development stack.
 *
 * It drives the login of a caller the way a browser does, from the studio
 * to the broker, to the identity provider of the tenant and back, and it
 * reads a collection through the gateway and the backend.
 *
 *   bun run scripts/dev-smoke.ts
 *
 * The environment:
 *
 *   DEV_BRIDGE_URL  the url of the studio     (default: http://localhost:8081)
 *   DEV_WORKSPACE   the workspace of the test (default: 22222222-2222-4222-8222-222222222222)
 *   DEV_EMAIL       the account of the fixture (default: alice@shuttle.test)
 *   DEV_PASSWORD    its password              (default: alice-password)
 */

const BRIDGE_URL = process.env.DEV_BRIDGE_URL ?? 'http://localhost:8081'
const WORKSPACE = process.env.DEV_WORKSPACE ?? '22222222-2222-4222-8222-222222222222'
const EMAIL = process.env.DEV_EMAIL ?? 'alice@shuttle.test'
const PASSWORD = process.env.DASSWORD ?? process.env.DEV_PASSWORD ?? 'alice-password'

/** The cookies of the browser. */
const cookies = new Map<string, string>()

/** The header of the cookies of the browser. */
function cookieHeader(): string {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

/** Keeps the cookies of an answer. */
function capture(response: Response): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  for (const cookie of headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';')
    if (!pair) continue
    const index = pair.indexOf('=')
    if (index === -1) continue
    const name = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    if (value.length === 0) cookies.delete(name)
    else cookies.set(name, value)
  }
}

/** Sends a request with the cookies of the browser. */
async function send(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const jar = cookieHeader()
  if (jar.length > 0) headers.set('cookie', jar)
  const response = await fetch(url, { ...init, headers, redirect: 'manual' })
  capture(response)
  return response
}

/** Reports a step of the test. */
function step(message: string): void {
  console.log(`▸ ${message}`)
}

/** Fails the test. */
function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  // 1. The studio sends the browser to the broker.
  step('the login of the studio')
  const start = await send(`${BRIDGE_URL}/login?workspace=${WORKSPACE}`)
  if (start.status !== 302) fail(`the studio did not start the login: ${start.status}`)
  let location = start.headers.get('location')
  let base = BRIDGE_URL
  if (!location) fail('the studio did not send the browser to the broker')

  // 2. The flow of the browser: the broker, the provider of the tenant and
  //    the callback of the studio.
  for (let hop = 0; hop < 15; hop += 1) {
    if (!location) fail('the flow of the login stopped')
    location = new URL(location, base).toString()
    if (location.startsWith(`${BRIDGE_URL}/auth/callback`)) break
    if (location.includes('/interaction/')) {
      step('the identity provider of the tenant')
      const submitted = await send(location, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: EMAIL, password: PASSWORD }).toString(),
      })
      const next = submitted.headers.get('location')
      if (!next) fail('the identity provider refused the credentials')
      base = location
      location = next
      continue
    }
    const response = await send(location)
    const next = response.headers.get('location')
    if (!next) {
      fail(`the flow of the login stopped at ${location} (${response.status})`)
    }
    base = location
    location = next
  }
  if (!location?.startsWith(`${BRIDGE_URL}/auth/callback`)) {
    fail('the flow of the login did not return to the studio')
  }

  step('the callback of the studio')
  const callback = await send(location)
  if (callback.status !== 302) fail(`the callback of the studio failed: ${callback.status}`)
  const sessionCookie = [...cookies.keys()].find((name) => name.includes('session'))
  if (!sessionCookie) fail('the login did not create a session')

  // 3. The studio reads the catalog of the workspace through the gateway
  //    and the backend.
  step('the catalog of the workspace')
  const schema = await send(`${BRIDGE_URL}/w/${WORKSPACE}/api/schema`)
  const text = await schema.text()
  if (!schema.ok) fail(`the studio did not read the catalog: ${schema.status} ${text}`)
  const body = JSON.parse(text) as { data?: { collections?: { key: string }[] } }
  const collections = body.data?.collections?.map((collection) => collection.key) ?? []
  if (collections.length === 0) fail('the catalog of the workspace is empty')
  step(`the collections are ${collections.join(', ')}`)

  // 4. A row of a collection, through the whole platform.
  step('a row of a collection')
  const items = await send(`${BRIDGE_URL}/w/${WORKSPACE}/api/items/${collections[0]}`)
  const itemsText = await items.text()
  if (!items.ok) fail(`the studio did not read the collection: ${items.status} ${itemsText}`)

  // 5. A change of the state, with the token of the session.
  step('a change of the state')
  const session = await send(`${BRIDGE_URL}/w/${WORKSPACE}/api/session`)
  const sessionBody = (await session.json()) as { data?: { csrfToken?: string } }
  const csrf = sessionBody.data?.csrfToken
  if (!csrf) fail('the studio did not answer the token of the session')
  const created = await send(`${BRIDGE_URL}/w/${WORKSPACE}/api/items/${collections[0]}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-csrf': csrf },
    body: JSON.stringify({ title: 'The smoke test of the development stack' }),
  })
  const createdText = await created.text()
  if (!created.ok) {
    fail(`the studio did not write the collection: ${created.status} ${createdText}`)
  }
  const createdBody = JSON.parse(createdText) as { data?: { id?: string } }
  step(`the row ${createdBody.data?.id ?? ''} was written`)

  console.log('')
  console.log('  the stack answers')
  console.log('')
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
