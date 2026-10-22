/**
 * The client of the broker of the platform (spec §3).
 *
 * The studio authenticates its callers against the broker of the platform
 * with the authorization code flow and PKCE. The studio is a **client** of
 * the broker: it registers itself as one, it holds the secret of its
 * client and it never holds a credential of an operator.
 *
 * The module owns the protocol of the flow: the discovery, the
 * authorization request, the exchange of the code and the verification of
 * the token of the identity. It reads no file and it touches no database.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

/** The document of the discovery of the broker. */
export interface OidcDiscovery {
  readonly issuer: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly userinfoEndpoint?: string
  readonly jwksUri?: string
}

/** The tokens of an exchange. */
export interface OidcTokens {
  readonly accessToken: string
  readonly idToken?: string
  readonly tokenType: string
  readonly expiresIn?: number
  readonly refreshToken?: string
}

/** The claims of the principal of a caller. */
export interface OidcProfile {
  readonly subject: string
  readonly email?: string
  readonly name?: string
  readonly roles: readonly string[]
  readonly tenantId?: string
}

/** The options of the client. */
export interface OidcClientOptions {
  /** The base url of the broker. */
  readonly hubUrl: string
  /** The client id of the studio at the broker. */
  readonly clientId: string
  /** The secret of the client, when it has one. */
  readonly clientSecret?: string
  /** The scopes the studio asks for. */
  readonly scope: string
  /** The redirect uri of the login. */
  readonly redirectUri: string
}

/** The problem of a login that could not be completed. */
export class OidcError extends Error {
  override readonly name = 'OidcError'
  /** The code of the failure, as the broker named it. */
  readonly code: string
  /** The status of the answer of the broker. */
  readonly status: number

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message)
    this.code = options.code ?? 'oidc_error'
    this.status = options.status ?? 502
  }
}

/** The parameters of an authorization request. */
export interface AuthorizationRequest {
  /** The state of the request: it is bound to the browser and to the login. */
  readonly state: string
  /** The nonce of the request: it is bound to the token of the identity. */
  readonly nonce: string
  /** The challenge of the proof key of the exchange. */
  readonly codeChallenge: string
}

/** The client of the broker. */
export class OidcClient {
  readonly #options: OidcClientOptions
  #discovery?: OidcDiscovery
  #jwks?: ReturnType<typeof createRemoteJWKSet>

  constructor(options: OidcClientOptions) {
    this.#options = options
  }

  /** The document of the discovery, read once. */
  async discovery(): Promise<OidcDiscovery> {
    if (this.#discovery) return this.#discovery
    const url = `${this.#options.hubUrl}/.well-known/openid-configuration`
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      throw new OidcError('the broker did not answer the discovery', {
        code: 'discovery_unavailable',
        status: 502,
      })
    }
    const body = (await response.json()) as Record<string, unknown>
    const issuer = typeof body.issuer === 'string' ? body.issuer : undefined
    const authorizationEndpoint =
      typeof body.authorization_endpoint === 'string' ? body.authorization_endpoint : undefined
    const tokenEndpoint = typeof body.token_endpoint === 'string' ? body.token_endpoint : undefined
    if (!issuer || !authorizationEndpoint || !tokenEndpoint) {
      throw new OidcError('the discovery of the broker is not usable', {
        code: 'discovery_invalid',
        status: 502,
      })
    }
    this.#discovery = {
      issuer,
      authorizationEndpoint,
      tokenEndpoint,
      ...(typeof body.userinfo_endpoint === 'string'
        ? { userinfoEndpoint: body.userinfo_endpoint }
        : {}),
      ...(typeof body.jwks_uri === 'string' ? { jwksUri: body.jwks_uri } : {}),
    }
    return this.#discovery
  }

  /**
   * The url the browser is sent to.
   *
   * The proof key is sent as a challenge: the verifier never leaves the
   * server of the studio.
   */
  async authorizationUrl(request: AuthorizationRequest): Promise<string> {
    const discovery = await this.discovery()
    const url = new URL(discovery.authorizationEndpoint)
    url.searchParams.set('client_id', this.#options.clientId)
    url.searchParams.set('redirect_uri', this.#options.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', this.#options.scope)
    url.searchParams.set('state', request.state)
    url.searchParams.set('nonce', request.nonce)
    url.searchParams.set('code_challenge', request.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    return url.toString()
  }

  /**
   * Exchanges a code for the tokens of the caller.
   *
   * The credentials of the client are sent with the scheme of the basic
   * authentication, and the verifier of the proof key with the body.
   */
  async exchange(code: string, codeVerifier: string): Promise<OidcTokens> {
    const discovery = await this.discovery()
    const headers = new Headers({
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    })
    if (this.#options.clientSecret) {
      headers.set(
        'authorization',
        `Basic ${Buffer.from(
          `${encodeURIComponent(this.#options.clientId)}:${encodeURIComponent(this.#options.clientSecret)}`
        ).toString('base64')}`
      )
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.#options.redirectUri,
      code_verifier: codeVerifier,
    })
    if (!this.#options.clientSecret) body.set('client_id', this.#options.clientId)

    const response = await fetch(discovery.tokenEndpoint, { method: 'POST', headers, body })
    const text = await response.text()
    const payload = parseJson(text)
    if (!response.ok) {
      const error = (payload ?? {}) as { error?: string; error_description?: string }
      throw new OidcError(error.error_description ?? error.error ?? 'the exchange was refused', {
        code: error.error ?? 'exchange_refused',
        status: response.status,
      })
    }
    const tokens = (payload ?? {}) as Record<string, unknown>
    const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : undefined
    if (!accessToken) {
      throw new OidcError('the broker did not issue a token', { code: 'no_token' })
    }
    return {
      accessToken,
      ...(typeof tokens.id_token === 'string' ? { idToken: tokens.id_token } : {}),
      tokenType: typeof tokens.token_type === 'string' ? tokens.token_type : 'Bearer',
      ...(typeof tokens.expires_in === 'number' ? { expiresIn: tokens.expires_in } : {}),
      ...(typeof tokens.refresh_token === 'string' ? { refreshToken: tokens.refresh_token } : {}),
    }
  }

  /**
   * Verifies the token of the identity.
   *
   * The signature is verified with the keys of the broker, the issuer and
   * the audience are checked, and the nonce is checked against the one of
   * the request: a token of another login is refused. An empty nonce
   * skips that check, and it is only used for a token that was verified
   * during the exchange.
   */
  async verifyIdToken(idToken: string, nonce: string): Promise<JWTPayload> {
    const discovery = await this.discovery()
    if (!discovery.jwksUri) {
      throw new OidcError('the broker does not publish its keys', {
        code: 'no_jwks',
        status: 502,
      })
    }
    this.#jwks ??= createRemoteJWKSet(new URL(discovery.jwksUri))
    try {
      const { payload } = await jwtVerify(idToken, this.#jwks, {
        issuer: discovery.issuer,
        audience: this.#options.clientId,
      })
      if (nonce.length > 0 && (typeof payload.nonce !== 'string' || payload.nonce !== nonce)) {
        throw new OidcError('the nonce of the token does not match the login', {
          code: 'nonce_mismatch',
          status: 401,
        })
      }
      return payload
    } catch (error) {
      if (error instanceof OidcError) throw error
      throw new OidcError('the token of the identity does not verify', {
        code: 'id_token_invalid',
        status: 401,
      })
    }
  }

  /**
   * The profile of the caller.
   *
   * The profile of the endpoint of the broker is preferred: it is the
   * freshest answer and it is the one the broker publishes. The claims of
   * the token of the identity are the fallback.
   */
  async profile(accessToken: string, idToken?: string): Promise<OidcProfile> {
    const discovery = await this.discovery()
    if (discovery.userinfoEndpoint) {
      const response = await fetch(discovery.userinfoEndpoint, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      })
      if (response.ok) {
        const body = (await response.json()) as Record<string, unknown>
        const subject = typeof body.sub === 'string' ? body.sub : undefined
        if (subject) return profileOf(body, subject)
      }
    }
    if (!idToken) {
      throw new OidcError('the broker did not answer the profile of the caller', {
        code: 'no_profile',
        status: 502,
      })
    }
    const claims = await this.verifyIdToken(idToken, '')
    const subject = typeof claims.sub === 'string' ? claims.sub : undefined
    if (!subject) {
      throw new OidcError('the token of the identity carries no subject', {
        code: 'no_subject',
        status: 401,
      })
    }
    return profileOf(claims as Record<string, unknown>, subject)
  }
}

/** The profile of a caller, from the claims of a token or of the endpoint. */
function profileOf(claims: Record<string, unknown>, subject: string): OidcProfile {
  const email = typeof claims.email === 'string' ? claims.email : undefined
  const name =
    typeof claims.name === 'string'
      ? claims.name
      : typeof claims.preferred_username === 'string'
        ? claims.preferred_username
        : undefined
  const roles = Array.isArray(claims.roles)
    ? claims.roles.filter((role): role is string => typeof role === 'string')
    : []
  const tenantId = typeof claims.tenant_id === 'string' ? claims.tenant_id : undefined
  return {
    subject,
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    roles,
    ...(tenantId ? { tenantId } : {}),
  }
}

/** Parses a json document, and answers nothing when it is not one. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
