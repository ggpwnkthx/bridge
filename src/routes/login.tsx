/**
 * The login of the studio.
 *
 * The caller signs in against the broker of the platform: the studio
 * keeps the state of the login that is in flight, and it sends the
 * browser to the broker with a challenge of its own.
 */

import { createHash } from 'node:crypto'
import type { Context } from 'hono'
import type { AppEnv } from '../app/context'
import { loginCookie } from '../domains/identity/cookies'
import { randomIdentifier } from '../domains/identity/session'

/** The login of a caller. */
const handler = async (c: Context<AppEnv>): Promise<Response> => {
  const dependencies = c.get('runtime')
  const workspace = c.req.query('workspace')
  const state = randomIdentifier()
  const nonce = randomIdentifier(16)
  const verifier = randomIdentifier(48)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  dependencies.logins.set({
    id: randomIdentifier(16),
    state,
    nonce,
    codeVerifier: verifier,
    ...(workspace ? { workspaceId: workspace } : {}),
    expiresAt: Date.now() + 10 * 60 * 1000,
  })
  const url = await dependencies.oidc.authorizationUrl({ state, nonce, codeChallenge: challenge })
  c.header('set-cookie', loginCookie(state, 600, { secure: dependencies.config.secureCookies }))
  return c.redirect(url, 302)
}

export default handler
