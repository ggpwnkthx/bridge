/**
 * The answer of the broker.
 *
 * The broker sends the browser back with a code: the studio exchanges it
 * for a token, it reads the profile of the caller and it opens a
 * session for it.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../../app/context'
import { redirectToStudio } from '../../app/context'
import {
  LOGIN_COOKIE_NAME,
  loginDeletionCookie,
  parseCookies,
  sessionCookie,
} from '../../domains/identity/cookies'
import { OidcError } from '../../domains/identity/oidc'
import { randomIdentifier, type Session } from '../../domains/identity/session'

/** The answer of the broker to the login of a caller. */
const handler = async (c: Context<AppEnv>): Promise<Response> => {
  const dependencies = c.get('runtime')
  const cookies = parseCookies(c.req.header('cookie'))
  const cookieState = cookies.get(LOGIN_COOKIE_NAME)
  const state = c.req.query('state')
  const code = c.req.query('code')
  const login = state ? dependencies.logins.take(state) : undefined
  c.header('set-cookie', loginDeletionCookie({ secure: dependencies.config.secureCookies }), {
    append: true,
  })

  if (!login || !code || !cookieState || cookieState !== login.state) {
    return redirectToStudio(c, login?.workspaceId, 'the login was not completed')
  }
  try {
    const tokens = await dependencies.oidc.exchange(code, login.codeVerifier)
    const claims = tokens.idToken
      ? await dependencies.oidc.verifyIdToken(tokens.idToken, login.nonce)
      : undefined
    const profile = await dependencies.oidc.profile(tokens.accessToken, tokens.idToken)
    const subject = profile.subject
    if (claims && typeof claims.sub === 'string' && claims.sub !== subject) {
      throw new OidcError('the profile and the token of the identity disagree', {
        code: 'subject_mismatch',
        status: 401,
      })
    }
    const session: Session = {
      id: randomIdentifier(),
      principal: {
        subject,
        ...(profile.email ? { email: profile.email } : {}),
        ...(profile.name ? { name: profile.name } : {}),
        roles: profile.roles,
        ...(profile.tenantId ? { tenantId: profile.tenantId } : {}),
      },
      accessToken: tokens.accessToken,
      ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
      expiresAt: Date.now() + dependencies.config.sessionTtlSeconds * 1000,
      csrfToken: randomIdentifier(24),
    }
    dependencies.sessions.set(session)
    c.header(
      'set-cookie',
      sessionCookie(session.id, dependencies.config.sessionTtlSeconds, {
        secure: dependencies.config.secureCookies,
      }),
      { append: true }
    )
    dependencies.logger.info('a caller logged in', {
      requestId: c.get('requestId'),
      subject: session.principal.subject,
    })
    return redirectToStudio(c, login.workspaceId)
  } catch (error) {
    dependencies.logger.warn('the login could not be completed', {
      requestId: c.get('requestId'),
      error: error instanceof Error ? error.message : 'unknown error',
    })
    return redirectToStudio(c, login.workspaceId, 'the login was refused')
  }
}

export default handler
