/**
 * The configuration of the studio (spec §2).
 *
 * The studio is configured by its environment: it names the gateway it
 * calls, the broker it authenticates its callers against and the
 * workspaces it may serve. Nothing of the deployment of the data backend
 * is configured here: the studio reads the collections, the fields and the
 * permissions of a workspace through the API of the backend, and it never
 * reaches the database.
 *
 * The module owns the shape of the environment and the rules that a
 * production environment has to satisfy. A configuration that could not be
 * used is refused at the start of the process, and not in the middle of a
 * request.
 */

import { z } from 'zod'

/** The pattern of an identifier of a workspace. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The schema of the environment of the studio. */
const EnvironmentSchema = z.object({
  /** The environment of the process: `production` or `development`. */
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  /** The address the process listens on. */
  BRIDGE_HOST: z.string().min(1).default('0.0.0.0'),
  /** The port the process listens on. */
  BRIDGE_PORT: z.coerce.number().int().min(1).max(65_535).default(8081),
  /**
   * The url the browser reaches the studio under.
   *
   * It is the redirect uri of the login: the broker sends the browser back
   * to it, and it has to be registered with the broker.
   */
  BRIDGE_PUBLIC_URL: z.url().default('http://localhost:8081'),
  /**
   * The base url of the gateway.
   *
   * Every call to the data backend goes through it: the gateway signs the
   * identity of the caller and the backend verifies that signature.
   */
  BRIDGE_GATEWAY_URL: z.url().default('http://localhost:8080'),
  /** The base url of the broker of the platform. */
  BRIDGE_HUB_URL: z.url().default('http://localhost:8082'),
  /** The client id of the studio at the broker. */
  BRIDGE_HUB_CLIENT_ID: z.string().min(1).default('bridge'),
  /** The secret of the client of the studio at the broker, when it has one. */
  BRIDGE_HUB_CLIENT_SECRET: z.string().min(1).optional(),
  /** The scopes the studio asks for at the broker. */
  BRIDGE_HUB_SCOPE: z.string().min(1).default('openid profile email groups'),
  /** The workspaces the studio may serve, separated by commas. */
  BRIDGE_WORKSPACES: z.string().default(''),
  /** The lifetime of a session of the studio, in seconds. */
  BRIDGE_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  /** Whether the cookies of the studio carry the `Secure` attribute. */
  BRIDGE_SECURE_COOKIES: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /**
   * The public key of the gateway, as a PEM.
   *
   * It is the key of the signature `v5` of the identity of a request: the
   * studio verifies the identity of the caller with it and it cannot mint
   * one. The symmetric format of the earlier releases (`v4`) is not
   * understood: the gateway removed it in its `1.0` release.
   */
  BRIDGE_GATEWAY_IDENTITY_PUBLIC_KEY: z.string().min(1).optional(),
  /**
   * Whether the studio refuses a request that did not go through the
   * gateway.
   *
   * It is the default of a production environment: the studio holds a
   * credential of the broker and it must not be reachable from anywhere
   * else.
   */
  BRIDGE_REQUIRE_GATEWAY_IDENTITY: z.enum(['true', 'false']).optional(),
  /**
   * Whether the workspace of the identity of the gateway has to be the
   * workspace of the studio.
   *
   * It is the default: the gateway decides which workspace a caller uses,
   * and the studio does not choose another one.
   */
  BRIDGE_BIND_GATEWAY_WORKSPACE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Whether the studio answers the probes of the deployment. */
  BRIDGE_PROBES: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
})

/** The configuration of the studio, as the process uses it. */
export interface BridgeConfig {
  readonly environment: 'production' | 'development' | 'test'
  readonly production: boolean
  readonly host: string
  readonly port: number
  /** The url the browser reaches the studio under. */
  readonly publicUrl: string
  /** The base url of the gateway. */
  readonly gatewayUrl: string
  /** The base url of the broker. */
  readonly hubUrl: string
  readonly hub: {
    readonly clientId: string
    readonly clientSecret?: string
    readonly scope: string
    /** The redirect uri of the login of the studio. */
    readonly redirectUri: string
  }
  /** The workspaces the studio may serve. */
  readonly workspaces: readonly string[]
  readonly sessionTtlSeconds: number
  readonly secureCookies: boolean
  /** The key with which the identity of the gateway is verified. */
  readonly gatewayIdentityKey?: {
    readonly version: 'v5'
    readonly key: string
  }
  readonly requireGatewayIdentity: boolean
  readonly bindGatewayWorkspace: boolean
  readonly probes: boolean
}

/** The problem of a configuration that cannot be used. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError'
  /** The problems of the configuration, one per line. */
  readonly details: readonly string[]

  constructor(details: readonly string[]) {
    super(`invalid configuration: ${details.join('; ')}`)
    this.details = details
  }
}

/**
 * Reads the configuration of the studio.
 *
 * The environment is read once, at the start of the process: a setting
 * that changes while the process runs would change the trust boundary of
 * the studio halfway through its life.
 */
export function readConfig(env: Record<string, string | undefined>): BridgeConfig {
  const parsed = EnvironmentSchema.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => {
        const path = issue.path.length ? issue.path.join('.') : '(root)'
        return `${path}: ${issue.message}`
      })
    )
  }
  const value = parsed.data
  const production = value.NODE_ENV === 'production'
  const details: string[] = []

  const workspaces = value.BRIDGE_WORKSPACES.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  for (const workspace of workspaces) {
    if (!UUID_PATTERN.test(workspace)) {
      details.push(`BRIDGE_WORKSPACES: "${workspace}" is not the identifier of a workspace`)
    }
  }
  if (new Set(workspaces).size !== workspaces.length) {
    details.push('BRIDGE_WORKSPACES: a workspace is named twice')
  }
  if (production && workspaces.length === 0) {
    details.push('BRIDGE_WORKSPACES is required in a production environment')
  }

  const publicUrl = value.BRIDGE_PUBLIC_URL.replace(/\/+$/, '')
  const redirectUri = `${publicUrl}/auth/callback`
  const gatewayIdentityKey = identityKeyOf(value)
  if (production && !gatewayIdentityKey) {
    details.push(
      'BRIDGE_GATEWAY_IDENTITY_PUBLIC_KEY is required in a production environment: the studio verifies the identity of the gateway'
    )
  }

  const requireGatewayIdentity =
    value.BRIDGE_REQUIRE_GATEWAY_IDENTITY === undefined
      ? production
      : value.BRIDGE_REQUIRE_GATEWAY_IDENTITY === 'true'
  if (requireGatewayIdentity && !gatewayIdentityKey) {
    details.push('the identity of the gateway cannot be required without a key to verify it with')
  }

  if (details.length > 0) throw new ConfigError(details)

  return {
    environment: value.NODE_ENV,
    production,
    host: value.BRIDGE_HOST,
    port: value.BRIDGE_PORT,
    publicUrl,
    gatewayUrl: value.BRIDGE_GATEWAY_URL.replace(/\/+$/, ''),
    hubUrl: value.BRIDGE_HUB_URL.replace(/\/+$/, ''),
    hub: {
      clientId: value.BRIDGE_HUB_CLIENT_ID,
      ...(value.BRIDGE_HUB_CLIENT_SECRET ? { clientSecret: value.BRIDGE_HUB_CLIENT_SECRET } : {}),
      scope: value.BRIDGE_HUB_SCOPE,
      redirectUri,
    },
    workspaces,
    sessionTtlSeconds: value.BRIDGE_SESSION_TTL_SECONDS,
    secureCookies: value.BRIDGE_SECURE_COOKIES,
    ...(gatewayIdentityKey ? { gatewayIdentityKey } : {}),
    requireGatewayIdentity,
    bindGatewayWorkspace: value.BRIDGE_BIND_GATEWAY_WORKSPACE,
    probes: value.BRIDGE_PROBES,
  }
}

/**
 * The key the identity of the gateway is verified with.
 *
 * The asymmetric key is preferred: an upstream that holds the public key
 * can verify an identity and it cannot mint one.
 */
function identityKeyOf(value: {
  BRIDGE_GATEWAY_IDENTITY_PUBLIC_KEY?: string
}): BridgeConfig['gatewayIdentityKey'] {
  if (value.BRIDGE_GATEWAY_IDENTITY_PUBLIC_KEY) {
    return { version: 'v5', key: value.BRIDGE_GATEWAY_IDENTITY_PUBLIC_KEY }
  }
  return undefined
}
