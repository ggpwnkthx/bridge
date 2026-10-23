/**
 * The document of the studio.
 *
 * The document holds the frame of the application and nothing else: the
 * collections, the rows and the metadata are read from the api of the
 * studio, and they are rendered by the script of the browser.
 */

import type { ComponentChildren, JSX } from 'preact'

/** The document of a page of the studio. */
export function Document(props: { title?: string; children?: ComponentChildren }): JSX.Element {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="referrer" content="same-origin" />
        <title>{props.title ?? 'Bridge — the studio of the headless data backend'}</title>
        <link rel="stylesheet" href="/static/styles.css" />
        <link rel="icon" href="data:," />
      </head>
      <body>
        {props.children}
        <script type="module" src="/static/client.js" />
      </body>
    </html>
  )
}
