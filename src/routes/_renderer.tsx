/**
 * The renderer of the studio.
 *
 * Every page of the studio is a tree of components, and the renderer
 * turns that tree into a document: the tree of the page is rendered by
 * preact, and the script of the browser takes it over when it answers.
 */

import type { Context, Next } from 'hono'
import { renderToString } from 'preact/compat/server'
import type { AppEnv } from '../app/context'
import { Document } from '../components/document'

/** The renderer of every page of the studio. */
export default async function renderer(c: Context<AppEnv>, next: Next): Promise<void> {
  c.setRenderer(async (content, head) => {
    const children = await content
    const html = renderToString(<Document title={head?.title}>{children}</Document>)
    return c.html(html)
  })
  await next()
}
