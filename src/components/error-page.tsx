/**
 * The failures of the studio, as pages.
 *
 * A page of failure shows what happened, in the words of a person, and
 * it keeps the code of the backend: the code is the stable part.
 */

import type { JSX } from 'preact'

/** The page of a failure of the studio. */
export function ErrorPage(props: {
  code: string
  message: string
  requestId: string
}): JSX.Element {
  return (
    <main class="content" id="content">
      <div class="notice error">
        <strong>{props.code}</strong> — {props.message}
        <div class="hint">request {props.requestId}</div>
      </div>
    </main>
  )
}

/** The page of a path that does not exist. */
export function NotFoundPage(): JSX.Element {
  return (
    <main class="content" id="content">
      <div class="notice">
        <strong>This path does not exist.</strong>
        <div class="hint">The studio has no page for this path.</div>
      </div>
    </main>
  )
}
