/**
 * The entry point of the studio (spec §9).
 *
 * The process reads its configuration, builds the application and serves
 * it. A configuration that could not be used stops the process before it
 * listens: a studio that starts with a broken configuration would answer
 * requests it cannot serve correctly.
 */

import { OidcClient } from './domains/identity/oidc'
import { MemoryLoginStateStore, MemorySessionStore } from './domains/identity/session'
import { createLogger } from './observability/logger'
import { createAssets } from './platform/assets'
import { readConfig } from './platform/config'
import { startServer } from './platform/bun/server'
import { createStudioApp } from './server'

const config = readConfig(process.env)
const logger = createLogger({
  level: config.production ? 'info' : 'debug',
})

const oidc = new OidcClient({
  hubUrl: config.hubUrl,
  clientId: config.hub.clientId,
  ...(config.hub.clientSecret ? { clientSecret: config.hub.clientSecret } : {}),
  scope: config.hub.scope,
  redirectUri: config.hub.redirectUri,
})

const app = createStudioApp({
  config,
  sessions: new MemorySessionStore({ ttlSeconds: config.sessionTtlSeconds }),
  logins: new MemoryLoginStateStore(),
  oidc,
  assets: createAssets({ directory: new URL('../dist/client', import.meta.url).pathname }),
  logger,
})

const server = startServer({
  hostname: config.host,
  port: config.port,
  app,
})

logger.info('the studio is listening', {
  url: server.url,
  publicUrl: config.publicUrl,
  gatewayUrl: config.gatewayUrl,
  hubUrl: config.hubUrl,
  workspaces: config.workspaces.length,
})

const shutdown = async (): Promise<void> => {
  logger.info('the studio is draining')
  await server.stop()
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown()
})
process.on('SIGTERM', () => {
  void shutdown()
})
