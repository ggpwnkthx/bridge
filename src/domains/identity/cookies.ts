/**
 * The cookies of the studio (spec §5.2).
 *
 * The studio owns two cookies: the one that names the session of the
 * browser and the one that names the login that is in flight. Both are
 * credentials or the holders of a credential, so both are `httpOnly`, both
 * are `sameSite=Lax` and both are `secure` in a production environment.
 */

/** The name of the cookie that carries the session. */
export const SESSION_COOKIE_NAME = 'bridge_session'

/** The name of the cookie that carries the state of a login. */
export const LOGIN_COOKIE_NAME = 'bridge_login'

/** The cookies the studio owns. */
export const STUDIO_COOKIE_NAMES: readonly string[] = [SESSION_COOKIE_NAME, LOGIN_COOKIE_NAME]

/** The attributes of a cookie of the studio. */
export interface CookieAttributes {
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: 'Lax'
  readonly path: string
  /** The lifetime of the cookie, in seconds. */
  readonly maxAge?: number
}

/** The options of the cookies. */
export interface CookieOptions {
  readonly secure: boolean
}

/** Reads the cookies of a request. */
export function parseCookies(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>()
  if (!header) return cookies
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (name.length === 0) continue
    cookies.set(name, decodeURIComponent(value))
  }
  return cookies
}

/** Renders a cookie into the value of a `Set-Cookie` header. */
export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${attributes.path}`)
  parts.push(`SameSite=${attributes.sameSite}`)
  if (attributes.httpOnly) parts.push('HttpOnly')
  if (attributes.secure) parts.push('Secure')
  if (attributes.maxAge !== undefined) parts.push(`Max-Age=${attributes.maxAge}`)
  return parts.join('; ')
}

/** The cookie of a session. */
export function sessionCookie(
  value: string,
  maxAgeSeconds: number,
  options: CookieOptions
): string {
  return serializeCookie(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  })
}

/** The cookie that deletes the session. */
export function sessionDeletionCookie(options: CookieOptions): string {
  return serializeCookie(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  })
}

/** The cookie of a login that is in flight. */
export function loginCookie(value: string, maxAgeSeconds: number, options: CookieOptions): string {
  return serializeCookie(LOGIN_COOKIE_NAME, value, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  })
}

/** The cookie that deletes the state of a login. */
export function loginDeletionCookie(options: CookieOptions): string {
  return serializeCookie(LOGIN_COOKIE_NAME, '', {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  })
}
