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
 *
 * The format of the signature is the `v5` of the gateway: a JWS signed
 * with `ES256` and the private key of the deployment, and the upstream
 * is given the public one. The symmetric format of the earlier releases
 * (`v4`) is **not** understood: the gateway removed it in its `1.0`
 * release, because its key was shared with the upstreams and an upstream
 * that verified an identity could mint one. A studio that accepts it
 * would accept an identity that anybody with the derived key could
 * write.
 *
 * The gateway of the release `2.0.0` writes the **subject** of the
 * caller as it is: it never rewrites it, and a subject that cannot be
 * written into a header is refused by the gateway itself. The studio
 * reads the values of the identity **as they are** — it never trims them
 * and never normalizes them — because the signed bytes are the bytes of
 * the headers: a studio that rewrote a value would rebuild a payload
 * that the gateway never signed. A header that appears twice is refused:
 * the gateway writes every identity header once, and a repeated header is
 * an attempt to make the reader pick the value that fits.
 */

import { compactVerify, importSPKI, base64url } from 'jose'

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

/** The version of the signature the studio understands. */
export const SUPPORTED_VERSION = 'v5'

/** The algorithm of the signature of the version `v5`. */
export const SUPPORTED_ALGORITHM = 'ES256'

/**
 * The type of the protected header of the signature.
 *
 * It names what the signature is about, so a signature of another kind
 * is never verified with the key of the deployment.
 */
export const SIGNATURE_TYPE = 'shuttle-identity'

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

/** The outcome of the reading of the identity headers. */
export type IdentityReading =
  | { readonly ok: true; readonly identity: GatewayIdentity }
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

/**
 * Reads a header that carries one value.
 *
 * A header that appears twice is refused: the gateway writes every
 * identity header once, and a repeated header is an attempt to make the
 * reader pick the value that fits. The value is read **as it is**: it is
 * never trimmed and never normalized, because the signed bytes are the
 * bytes of the header.
 */
function singleValue(
  headers: Headers,
  name: string
):
  | { readonly ok: true; readonly value?: string }
  | { readonly ok: false; readonly reason: string } {
  const value = headers.get(name)
  if (value === null) return { ok: true }
  if (value.includes(',')) {
    return { ok: false, reason: `the header "${name}" appears more than once` }
  }
  return { ok: true, ...(value.length > 0 ? { value } : {}) }
}

/**
 * The identity of a request, as its headers carry it.
 *
 * The values are read as they are: the subject of the gateway is never
 * rewritten by the studio, and the roles are the ones of the header, cut
 * on the commas that separate them.
 */
export function identityOf(headers: Headers): IdentityReading {
  const subject = singleValue(headers, SUBJECT_HEADER)
  if (!subject.ok) return subject
  const email = singleValue(headers, EMAIL_HEADER)
  if (!email.ok) return email
  const workspaceId = singleValue(headers, WORKSPACE_HEADER)
  if (!workspaceId.ok) return workspaceId
  const rawRoles = headers.get(ROLES_HEADER)
  const roles = (rawRoles ?? '').split(',').filter((role) => role.length > 0)
  return {
    ok: true,
    identity: {
      subject: subject.value ?? '',
      ...(email.value ? { email: email.value } : {}),
      roles,
      ...(workspaceId.value ? { workspaceId: workspaceId.value } : {}),
    },
  }
}

/**
 * The key the signature is verified with.
 *
 * The key is the public key of the deployment, in PEM: the studio
 * verifies an identity of the gateway and it cannot mint one.
 */
export interface VerificationKey {
  readonly version: 'v5'
  readonly publicKeyPem: string
}

/**
 * Verifies the identity of a request.
 *
 * The payload of the signature is detached: the studio rebuilds it from
 * the request and from the identity headers, puts it back into the
 * serialization and verifies the signature with the library.
 *
 * The verification is strict about the combination it accepts: the
 * version decides the algorithm, and the protected header has to agree
 * with it. A signature of another kind is never verified with the key of
 * the deployment, and there is no fallback from one algorithm to another.
 */
export async function verifyGatewayIdentity(
  request: SignedRequest,
  headers: Headers,
  key: VerificationKey
): Promise<IdentityVerification> {
  const signature = singleValue(headers, SIGNATURE_HEADER)
  if (!signature.ok) return { ok: false, reason: signature.reason }
  if (!signature.value) return { ok: false, reason: 'the request carries no signature' }

  const separator = signature.value.indexOf('=')
  if (separator === -1) return { ok: false, reason: 'the signature is malformed' }
  const version = signature.value.slice(0, separator)
  if (version !== SUPPORTED_VERSION) {
    return { ok: false, reason: `the version "${version}" of the signature is not known` }
  }

  const parts = signature.value.slice(separator + 1).split('.')
  if (parts.length !== 3) return { ok: false, reason: 'the signature is malformed' }
  const [protectedHeader, payload, detachedSignature] = parts
  if (!protectedHeader || !detachedSignature) {
    return { ok: false, reason: 'the signature is malformed' }
  }
  if (payload !== '') {
    return { ok: false, reason: 'the payload of the signature is not detached' }
  }

  const header = protectedHeaderOf(protectedHeader)
  if (!header) {
    return { ok: false, reason: 'the protected header of the signature is malformed' }
  }
  if (header.alg !== SUPPORTED_ALGORITHM) {
    return {
      ok: false,
      reason: `the signature of the version "${version}" has to be signed with "${SUPPORTED_ALGORITHM}" and not with "${String(header.alg)}"`,
    }
  }
  if (header.typ !== SIGNATURE_TYPE) {
    return {
      ok: false,
      reason: `the type of the protected header has to be "${SIGNATURE_TYPE}" and not "${String(header.typ)}"`,
    }
  }

  const reading = identityOf(headers)
  if (!reading.ok) return { ok: false, reason: reading.reason }
  const identity = reading.identity
  if (!identity.subject) {
    return { ok: false, reason: 'the request carries no subject' }
  }

  const rebuilt = canonicalPayload(identity, request, version)
  const compact = `${protectedHeader}.${Buffer.from(rebuilt, 'utf8').toString('base64url')}.${detachedSignature}`

  try {
    const publicKey = await importSPKI(key.publicKeyPem, SUPPORTED_ALGORITHM)
    await compactVerify(compact, publicKey, { algorithms: [SUPPORTED_ALGORITHM] })
  } catch {
    return { ok: false, reason: 'the signature does not verify' }
  }

  return { ok: true, identity, version }
}

/**
 * The protected header of a signature.
 *
 * It is the header of the JWS: the algorithm and the type of the
 * signature. A header that is not a json object is refused.
 */
function protectedHeaderOf(segment: string): { alg?: unknown; typ?: unknown } | undefined {
  let decoded: string
  try {
    decoded = new TextDecoder().decode(base64url.decode(segment))
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(decoded)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as { alg?: unknown; typ?: unknown }
}
