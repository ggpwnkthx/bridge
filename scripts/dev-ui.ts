#!/usr/bin/env bun
/**
 * The test of the interface of the studio, in a browser.
 *
 * It drives the studio against the development machine the way a caller
 * does: the login at the broker, the collections, the drawer of a
 * record, and a change that goes through the gateway to the backend.
 *
 * It checks two things:
 *
 *   - the shapes the studio shows: a field that has no value is an
 *     empty field, a field of lines is a field of lines, and a field
 *     that cannot be empty does not offer the empty choice;
 *   - the accessibility of the studio, with axe, in the rows and in the
 *     drawer of a record.
 *
 *   bun run scripts/dev-ui.ts
 *
 * The environment:
 *
 *   DEV_BRIDGE_URL  the url of the studio     (default: http://localhost:8081)
 *   DEV_WORKSPACE   the workspace of the test (default: 22222222-2222-4222-8222-222222222222)
 *   DEV_EMAIL       the account of the fixture (default: alice@shuttle.test)
 *   DEV_PASSWORD    its password              (default: alice-password)
 *   DEV_HEADLESS    "0" opens a visible browser
 */

import { chromium, type Page } from 'playwright-core'

const BRIDGE_URL = process.env.DEV_BRIDGE_URL ?? 'http://localhost:8081'
const WORKSPACE = process.env.DEV_WORKSPACE ?? '22222222-2222-4222-8222-222222222222'
const EMAIL = process.env.DEV_EMAIL ?? 'alice@shuttle.test'
const PASSWORD = process.env.DEV_PASSWORD ?? 'alice-password'
const HEADLESS = process.env.DEV_HEADLESS !== '0'

/** The failures of the test. */
const failures: string[] = []

/** Reports a check of the studio. */
function check(what: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${what}`)
    return
  }
  failures.push(detail ? `${what} — ${detail}` : what)
  console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ''}`)
}

/** Reports a step of the test. */
function step(message: string): void {
  console.log(`▸ ${message}`)
}

/** Waits for the studio to answer. */
async function waitForStudio(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${BRIDGE_URL}/healthz`)
      if (response.ok) return true
    } catch {
      // The studio is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

/** Signs the caller in, the way a browser does. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${BRIDGE_URL}/w/${WORKSPACE}`, { waitUntil: 'domcontentloaded' })
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // The caller is signed in when the frame of the studio is on the
    // screen: the url alone says nothing, the studio answers that url
    // with a login before it answers with its frame.
    const signed = await page
      .waitForSelector('.toolbar, .notice', { timeout: 3000 })
      .then(() => true)
      .catch(() => false)
    if (signed && page.url().includes(`/w/${WORKSPACE}`)) return
    // The page of the identity provider is not the studio: it asks for
    // the account and the password of the caller.
    await page
      .waitForSelector('input, button[type=submit], input[type=submit]', { timeout: 10000 })
      .catch(() => undefined)
    const fields = await page.$$eval('input', (inputs) =>
      inputs.map((input) => ({ name: input.name, type: input.type }))
    )
    for (const field of fields) {
      if (field.type === 'text' || field.type === 'email')
        await page.fill(`[name="${field.name}"]`, EMAIL)
      if (field.type === 'password') await page.fill(`[name="${field.name}"]`, PASSWORD)
    }
    const submit = await page.$('button[type=submit], input[type=submit]')
    if (!submit) {
      await page.waitForTimeout(1500)
      continue
    }
    // The form of the identity provider answers with a redirect: the
    // test waits for the page it answers with.
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => undefined),
      submit.click(),
    ])
    await page.waitForTimeout(2000)
  }
}

/** The path of the axe core, for the page. */
function axePath(): string {
  return Bun.resolveSync('axe-core/axe.min.js', process.cwd())
}

/**
 * The violations of axe in a page.
 *
 * Only the serious and the critical ones stop the test: the others are
 * reported, and they are the work of the next pass.
 */
async function violations(page: Page): Promise<{ impact: string; help: string; nodes: number }[]> {
  await page.addScriptTag({ path: axePath() })
  const results = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document) => Promise<unknown> } }).axe
    const report = (await axe.run(document)) as {
      violations: { impact?: string; help: string; nodes: unknown[] }[]
    }
    return report.violations
  })
  return results.map((violation) => ({
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    nodes: violation.nodes.length,
  }))
}

async function main(): Promise<void> {
  if (!(await waitForStudio())) {
    console.error(
      `the studio does not answer at ${BRIDGE_URL}: start the stack with "bun run dev:stack"`
    )
    process.exit(1)
  }

  const browser = await chromium.launch({ headless: HEADLESS })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => failures.push(`the page failed: ${error.message}`))

  step('the login of the caller')
  await signIn(page)
  // The console is watched from here: the studio asks for its session
  // before the login, and that refusal is the login itself.
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`the console of the browser: ${message.text()}`)
  })
  check('the studio answers after the login', page.url().includes(`/w/${WORKSPACE}`), page.url())
  await page.waitForSelector('.row-open', { timeout: 15000 })

  step('the rows of the collection')
  const rows = await page.$$eval('.row-open', (buttons) => buttons.length)
  check('the studio shows the rows of the collection', rows > 0, `${rows} rows`)

  step('the accessibility of the rows')
  for (const violation of await violations(page)) {
    check(
      `no violation of axe in the rows: ${violation.help}`,
      violation.impact !== 'serious' && violation.impact !== 'critical',
      `${violation.impact}, ${violation.nodes} nodes`
    )
    if (violation.impact === 'serious' || violation.impact === 'critical') continue
    console.log(`       (${violation.impact}) ${violation.help}`)
  }

  step('the drawer of a record')
  await page.click('.row-open')
  await page.waitForSelector('.drawer .field', { timeout: 10000 })
  const fields = await page.$$eval('.drawer .field', (nodes) =>
    nodes.map((node) => {
      const label = node.querySelector('label')?.textContent ?? ''
      const control = node.querySelector<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('input, select, textarea')
      return {
        label,
        tag: control?.tagName ?? '',
        value: control?.value ?? '',
        options: control?.tagName === 'SELECT' ? control.querySelectorAll('option').length : 0,
      }
    })
  )
  for (const field of fields) {
    check(
      `the field "${field.label}" does not show the word null`,
      !field.value.includes('null'),
      field.value
    )
  }
  const body = fields.find((field) => field.label.toLowerCase().startsWith('body'))
  check('a field of lines is a field of lines', body?.tag === 'TEXTAREA', body?.tag ?? 'no field')
  const status = fields.find((field) => field.label.toLowerCase().startsWith('status'))
  check(
    'a field that cannot be empty does not offer the empty choice',
    status === undefined || status.options > 1,
    status ? `${status.options} choices` : 'no field'
  )

  step('the accessibility of the drawer')
  for (const violation of await violations(page)) {
    check(
      `no violation of axe in the drawer: ${violation.help}`,
      violation.impact !== 'serious' && violation.impact !== 'critical',
      `${violation.impact}, ${violation.nodes} nodes`
    )
    if (violation.impact === 'serious' || violation.impact === 'critical') continue
    console.log(`       (${violation.impact}) ${violation.help}`)
  }

  step('the change of a record')
  const identity = await page.evaluate(() => {
    const head = document.querySelector('.drawer-head') as HTMLElement | null
    return {
      title: document.getElementById('drawer-title')?.textContent ?? '',
      collection: head?.dataset.collection ?? '',
      record: head?.dataset.record ?? '',
    }
  })
  const recordId = identity.record
  const collection = identity.collection
  check('the drawer names the record it shows', recordId.length > 0, identity.title)

  const read = async (): Promise<Record<string, unknown>> =>
    await page.evaluate(
      async ({ workspace, collection: key, id }) => {
        const answer = await fetch(`/w/${workspace}/api/items/${key}/${id}`)
        const body = (await answer.json()) as { data: Record<string, unknown> }
        return body.data
      },
      { workspace: WORKSPACE, collection, id: recordId }
    )

  if (body) {
    const lines = 'The body of the test.\nA second line, written by the studio.'
    await page.fill('.drawer textarea', lines)
    await page.click('[data-action="save"]')
    await page.waitForTimeout(2000)
    const answer = await read()
    check('the body of the record keeps its lines', answer.body === lines, String(answer.body))

    step('the clearing of a field')
    await page.click('.row-open')
    await page.waitForSelector('.drawer .field', { timeout: 10000 })
    await page.fill('.drawer textarea', '')
    await page.click('[data-action="save"]')
    await page.waitForTimeout(2000)
    const cleared = await read()
    check(
      'a field that was emptied is written as null',
      cleared.body === null,
      String(cleared.body)
    )
  }

  await browser.close()

  if (failures.length > 0) {
    console.error('')
    console.error(`✗ ${failures.length} failure(s) of the interface of the studio`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log('')
  console.log('  the interface of the studio is sound')
}

main().catch((error: unknown) => {
  console.error(
    `✗ the test of the interface failed: ${error instanceof Error ? error.message : error}`
  )
  process.exit(1)
})
