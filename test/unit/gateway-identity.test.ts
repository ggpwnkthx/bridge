/**
 * The tests of the verification of the identity of the gateway.
 */

import { describe, expect, test } from 'bun:test'
import { CompactSign, base64url, exportSPKI, generateKeyPair, type KeyInput } from 'jose'
import { createHmac } from 'node:crypto'
import {
  canonicalPayload,
  verifyGatewayIdentity,
  type VerificationKey,
} from '../../src/domains/gateway/identity'

/** The identity of a caller. */
const identity = {
  subject: 'b1c2d3e4-1111-4111-8111-111111111111',
  email: 'alice@example.com',
  roles: ['reader', 'editor'],
  workspaceId: '22222222-2222-4222-8222-222222222222',
}

/** The request that the identity belongs to. */
const request = {
  method: 'GET',
  path: '/w/22222222-2222-4222-8222-222222222222/api/items/articles',
  query: '?limit=50',
  host: 'studio.example.com',
}

/** The headers of an identity. */
function headersOf(values: Record<string, string>): Headers {
  return new Headers(values)
}

/** Signs an identity, as the gateway does. */
async function sign(
  version: string,
  key: KeyInput,
  headers: Record<string, string>,
  signed: typeof request
): Promise<string> {
  const payload = canonicalPayload(
    {
      subject: headers['x-shuttle-user'] ?? '',
      ...(headers['x-shuttle-email'] ? { email: headers['x-shuttle-email'] } : {}),
      roles: (headers['x-shuttle-roles'] ?? '').split(',').filter((role) => role.length > 0),
      ...(headers['x-shuttle-workspace'] ? { workspaceId: headers['x-shuttle-workspace'] } : {}),
    },
    signed,
    version
  )
  const jws = await new CompactSign(new TextEncoder().encode(payload))
    .setProtectedHeader({ alg: version === 'v5' ? 'ES256' : 'HS256', typ: 'shuttle-identity' })
    .sign(key)
  const [protectedHeader, , signature] = jws.split('.')
  return `${version}=${protectedHeader}..${signature}`
}

describe('the identity of the gateway', () => {
  test('it verifies the signature of the symmetric format', async () => {
    const secret = 'the-secret-of-the-deployment'
    const derived = createHmac('sha256', secret).update('shuttle-identity-signature-v1').digest()
    const key: VerificationKey = { version: 'v4', derivedKeyBase64: derived.toString('base64') }
    const values = {
      'x-shuttle-user': identity.subject,
      'x-shuttle-email': identity.email,
      'x-shuttle-roles': identity.roles.join(','),
      'x-shuttle-workspace': identity.workspaceId ?? '',
    }
    const headers = headersOf(values)
    headers.set('x-shuttle-signature', await sign('v4', derived, values, request))
    const result = await verifyGatewayIdentity(request, headers, key)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.identity.subject).toBe(identity.subject)
      expect(result.identity.roles).toEqual(['reader', 'editor'])
      expect(result.version).toBe('v4')
    }
  })

  test('it verifies the signature of the asymmetric format', async () => {
    const pair = await generateKeyPair('ES256')
    const pem = await exportSPKI(pair.publicKey)
    const key: VerificationKey = { version: 'v5', publicKeyPem: pem }
    const values = {
      'x-shuttle-user': identity.subject,
      'x-shuttle-email': identity.email,
      'x-shuttle-roles': identity.roles.join(','),
      'x-shuttle-workspace': identity.workspaceId ?? '',
    }
    const headers = headersOf(values)
    headers.set('x-shuttle-signature', await sign('v5', pair.privateKey, values, request))
    const result = await verifyGatewayIdentity(request, headers, key)
    expect(result.ok).toBe(true)
  })

  test('it refuses a signature that belongs to another request', async () => {
    const secret = 'the-secret-of-the-deployment'
    const derived = createHmac('sha256', secret).update('shuttle-identity-signature-v1').digest()
    const key: VerificationKey = { version: 'v4', derivedKeyBase64: derived.toString('base64') }
    const values = {
      'x-shuttle-user': identity.subject,
      'x-shuttle-roles': identity.roles.join(','),
    }
    const headers = headersOf(values)
    headers.set(
      'x-shuttle-signature',
      await sign('v4', derived, values, { ...request, path: '/w/other/api/items/articles' })
    )
    const result = await verifyGatewayIdentity(request, headers, key)
    expect(result.ok).toBe(false)
  })

  test('it refuses a request that carries no signature', async () => {
    const key: VerificationKey = { version: 'v4', derivedKeyBase64: 'AAAA' }
    const result = await verifyGatewayIdentity(request, headersOf({}), key)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('no signature')
  })

  test('it refuses a version it does not know', async () => {
    const key: VerificationKey = { version: 'v4', derivedKeyBase64: 'AAAA' }
    const headers = headersOf({
      'x-shuttle-user': identity.subject,
      'x-shuttle-signature': `v9=${base64url.encode('{}')}.x`,
    })
    const result = await verifyGatewayIdentity(request, headers, key)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('v9')
  })
})
