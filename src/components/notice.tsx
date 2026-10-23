/**
 * The notices of the studio.
 *
 * A refusal of the backend is shown with its code, its message and the
 * identifier of its request. The studio does not change a word of it.
 */

import type { JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { ApiError } from '../client/api'

/** The notice of a failure. */
export function Notice(props: { error: unknown; retry?: () => void }): JSX.Element {
  const { error, retry } = props
  if (error instanceof ApiError) {
    return (
      <div class="notice error">
        <strong>{error.code}</strong> — {error.message}
        <div class="hint">request {error.requestId}</div>
        {retry ? (
          <div class="notice-actions">
            <button class="ghost" type="button" onClick={retry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    )
  }
  // The request did not answer at all: nothing was changed.
  return (
    <div class="notice error">
      <strong>The studio could not reach the server.</strong>
      <div class="hint">The request did not answer. Nothing was changed.</div>
      {retry ? (
        <div class="notice-actions">
          <button class="ghost" type="button" onClick={retry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** A message of the studio, on the screen. */
export interface Toast {
  id: number
  message: string
  kind: 'ok' | 'error'
}

/**
 * The messages of the studio.
 *
 * A message that is read stays on the screen: the studio keeps it while
 * the pointer is on it.
 */
export function Toasts(props: { toasts: Toast[]; dismiss: (id: number) => void }): JSX.Element {
  return (
    <div class="toasts" id="toasts" role="status" aria-live="polite">
      {props.toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} dismiss={props.dismiss} />
      ))}
    </div>
  )
}

/** A message of the studio. */
function Toast(props: { toast: Toast; dismiss: (id: number) => void }): JSX.Element {
  const { toast } = props
  const timer = useRef(0)
  const delay = toast.kind === 'error' ? 12000 : 6000
  // The message leaves the screen when the studio is done with it.
  useEffect(() => {
    timer.current = window.setTimeout(() => props.dismiss(toast.id), delay)
    return () => window.clearTimeout(timer.current)
  }, [toast.id])
  // A message that is read stays on the screen.
  const stop = (): void => window.clearTimeout(timer.current)
  const start = (): void => {
    timer.current = window.setTimeout(() => props.dismiss(toast.id), delay)
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer only holds the message on the screen; the live region of the studio announces it.
    <div
      class={`toast ${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : undefined}
      onMouseEnter={stop}
      onMouseLeave={start}
    >
      {toast.message}
    </div>
  )
}
