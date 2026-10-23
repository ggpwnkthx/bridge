/**
 * The types of the studio.
 *
 * The renderer of the studio is written with preact: the content of a
 * page is a tree of components, and the renderer turns it into a
 * document.
 */

import type { VNode } from 'preact'

declare module 'hono' {
  interface ContextRenderer {
    // biome-ignore lint/style/useShorthandFunctionType: the interface of hono is merged with this one.
    (content: VNode | Promise<VNode>, head?: { title?: string }): Response | Promise<Response>
  }
}
