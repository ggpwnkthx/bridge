/**
 * The identity of the gateway, as the studio reads it (spec §4).
 *
 * The studio is deployed behind the gateway. The gateway writes the
 * identity of the caller into the headers of the request it forwards and
 * it signs it: the signature is a detached JWS over the identity and over
 * the request it belongs to, so a signature cannot be moved to another
 * request, to another route or to another host.
 *
 * The studio verifies that signature before it believes anything the
 * headers say. The module is standalone: it implements the contract of
 * the gateway with a standard library and it imports nothing of the
 * platform.
 */

import { compactVerify, importSPKI } from 'jose'

/** The header the signature is written to. */
export const SIGNATURE_HEADER = 'x-shuttle-signature'

/** The header the subject is written to. */
export const SUBJECT_HEADER = 'x-shuttle-user'

/** The header the e-mail address is written to. */
export const EMAIL_HEADER = 'x-shuttle-email'

/** The header the roles are written to. */
export const ROLES_HEADER = 'x-shuttle-roles'

/** The header the workspace is written to. */
export const WORKSPACE_HEADER = 'x-shuttle-workspace'

/** The versions of the signature the studio understands. */
export const SUPPORTED_VERSIONS = ['v5', 'v4'] as const

/** The identity of a caller, as the headers carry it. */
export interface GatewayIdentity {
  readonly subject: string
  readonly email?: string
  readonly roles: readonly string[]
  readonly workspaceId?: string
}

/** The request, as the upstream received it. */
export interface SignedRequest {
  /** The method of the request, in upper case. */
  readonly method: string
  /** The path of the request, as the upstream received it. */
  readonly path: string
  /** The query string, with its leading question mark. */
  readonly query: string
  /** The host the caller used to reach the gateway. */
  readonly host: string
}

/** The outcome of the verification of an identity. */
export type IdentityVerification =
  | { readonly ok: true; readonly identity: GatewayIdentity; readonly version: string }
  | { readonly ok: false; readonly reason: string }

/**
 * The canonical form of the signed payload.
 *
 * The fields are written in this order and the roles are sorted, so every
 * replica and every upstream rebuilds the payload byte for byte.
 */
export function canonicalPayload(
  identity: GatewayIdentity,
  request: SignedRequest,
  version: string
): string {
  return JSON.stringify({
    v: version,
    method: request.method.toUpperCase(),
    path: request.path,
    query: request.query,
    host: request.host.toLowerCase(),
    subject: identity.subject,
    workspaceId: identity.workspaceId ?? '',
    email: identity.email ?? '',
    roles: [...identity.roles].sort(),
  })
}

/** The identity of a request, as its headers carry it. */
export function identityOf(headers: Headers): GatewayIdentity {
  const subject = headers.get(SUBJECT_HEADER) ?? ''
  const email = headers.get(EMAIL_HEADER) ?? ''
  const workspaceId = headers.get(WORKSPACE_HEADER) ?? ''
  const roles = (headers.get(ROLES_HEADER) ?? '')
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0)
  return {
    subject,
    ...(email ? { email } : {}),
    roles,
    ...(workspaceId ? { workspaceId } : {}),
  }
}

/**
 * The key the signature is verified with.
 *
 * The asymmetric key is a PEM of a public key and the symmetric one is the
 * derived key of the deployment, in base64.
 */
export type VerificationKey =
  | { readonly version: 'v5'; readonly publicKeyPem: string }
  | { readonly version: 'v4'; readonly derivedKeyBase64: string }

/**
 * Verifies the identity of a request.
 *
 * The payload of the signature is detached: the studio rebuilds it from
 * the request and from the identity headers, puts it back into the
 * serialization and verifies the signature with the library.
 */
export async function verifyGatewayIdentity(
  request: SignedRequest,
  headers: Headers,
  key: VerificationKey
): Promise<IdentityVerification> {
  const signature = headers.get(SIGNATURE_HEADER)
  if (!signature) return { ok: false, reason: 'the request carries no signature' }

  const separator = signature.indexOf('=')
  if (separator === -1) return { ok: false, reason: 'the signature is malformed' }
  const version = signature.slice(0, separator)
  if (!(SUPPORTED_VERSIONS as readonly string[]).includes(version)) {
    return { ok: false, reason: `the version "${version}" of the signature is not known` }
  }

  const parts = signature.slice(separator + 1).split('.')
  if (parts.length !== 3) return { ok: false, reason: 'the signature is malformed' }
  const [protectedHeader, payload, detachedSignature] = parts
  if (!protectedHeader || !detachedSignature) {
    return { ok: false, reason: 'the signature is malformed' }
  }
  if (payload !== '') {
    return { ok: false, reason: 'the payload of the signature is not detached' }
  }

  const identity = identityOf(headers)
  if (!identity.subject) {
    return { ok: false, reason: 'the request carries no subject' }
  }

  const rebuilt = canonicalPayload(identity, request, version)
  const compact = `${protectedHeader}.${Buffer.from(rebuilt, 'utf8').toString('base64url')}.${detachedSignature}`

  try {
    if (key.version === 'v5') {
      const publicKey = await importSPKI(key.publicKeyPem, 'ES256')
      await compactVerify(compact, publicKey, { algorithms: ['ES256'] })
    } else {
      const secret = Buffer.from(key.derivedKeyBase64, 'base64')
      if (secret.length === 0) return { ok: false, reason: 'the key of the gateway is empty' }
      await compactVerify(compact, secret, { algorithms: ['HS256'] })
    }
  } catch {
    return { ok: false, reason: 'the signature does not verify' }
  }

  return { ok: true, identity, version }
}
