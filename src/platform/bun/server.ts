/**
 * The server of the studio (spec §9.2).
 *
 * The studio is a Bun server: it serves the user interface and the api
 * of the studio, and it holds the sessions of the callers in its own
 * process.
 */

import type { Hono } from 'hono'

/** The application that the server serves. */
export type Fetchable = Pick<Hono, 'fetch'>

/** The options of the server. */
export interface ServerOptions {
  readonly hostname: string
  readonly port: number
  readonly app: Fetchable
  /** The maximum time a connection may stay idle, in seconds. */
  readonly idleTimeoutSeconds?: number
}

/** The server of the studio. */
export interface Server {
  readonly url: string
  stop: () => Promise<void>
}

/** Starts the server. */
export function startServer(options: ServerOptions): Server {
  const server = Bun.serve({
    hostname: options.hostname,
    port: options.port,
    fetch: options.app.fetch,
    ...(options.idleTimeoutSeconds ? { idleTimeout: options.idleTimeoutSeconds } : {}),
  })
  return {
    url: `http://${server.hostname}:${server.port}`,
    stop: async () => {
      await server.stop(true)
    },
  }
}
