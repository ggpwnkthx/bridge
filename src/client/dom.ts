/**
 * The helpers of the document.
 *
 * The user interface is written without a framework: the studio renders
 * a table of rows and a drawer, and a handful of helpers are enough for
 * it. Every element is created with `h`, so nothing of the interface is
 * built with an inner html and nothing of a row of the backend can become
 * markup.
 */

/** A child of an element. */
export type Child = Node | string | number | null | undefined | false

/** The attributes of an element. */
export interface Attributes {
  readonly class?: string
  readonly id?: string
  readonly type?: string
  readonly value?: string
  readonly placeholder?: string
  readonly title?: string
  readonly href?: string
  readonly hidden?: boolean
  readonly disabled?: boolean
  readonly checked?: boolean
  readonly name?: string
  readonly rows?: number
  readonly min?: string
  readonly max?: string
  readonly step?: string
  readonly form?: string
  readonly spellcheck?: boolean
  readonly dataset?: Record<string, string>
  readonly on?: Partial<{
    [Event in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[Event]) => void
  }>
}

/** Creates an element. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (name === 'on') {
      for (const [event, handler] of Object.entries(value as Record<string, EventListener>)) {
        element.addEventListener(event, handler)
      }
      continue
    }
    if (name === 'dataset') {
      for (const [key, item] of Object.entries(value as Record<string, string>)) {
        element.dataset[key] = item
      }
      continue
    }
    if (value === true) {
      element.setAttribute(name, '')
      continue
    }
    element.setAttribute(name, String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    element.append(typeof child === 'object' ? child : document.createTextNode(String(child)))
  }
  return element
}

/** Removes the children of an element. */
export function clear(element: Element): void {
  while (element.firstChild) element.removeChild(element.firstChild)
}

/** Renders a value of a row. */
export function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** Reports whether a value is empty. */
export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}
