/**
 * The session of the caller.
 *
 * The session is the session of the studio: the token of the caller
 * stays on the server, and the browser holds an identifier and the token
 * of the changes of the state.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../../../../app/context'
import { establish, workspaceOf } from '../../../../app/context'

export const GET = [
  async (c: Context<AppEnv>) => {
    const session = await establish(c)
    const gateway = c.get('gateway')
    return c.json({
      data: {
        principal: {
          subject: session.principal.subject,
          ...(session.principal.email ? { email: session.principal.email } : {}),
          ...(session.principal.name ? { name: session.principal.name } : {}),
          roles: session.principal.roles,
          ...(session.principal.tenantId ? { tenantId: session.principal.tenantId } : {}),
        },
        workspace: workspaceOf(c),
        csrfToken: session.csrfToken,
        gateway: gateway
          ? {
              subject: gateway.subject,
              roles: gateway.roles,
              ...(gateway.workspaceId ? { workspaceId: gateway.workspaceId } : {}),
            }
          : null,
      },
    })
  },
]
