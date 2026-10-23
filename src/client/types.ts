/**
 * The shapes of the studio.
 *
 * The studio reads the metadata of a deployment from the api of the
 * studio, and it reads nothing else: the fields it offers to edit are
 * the fields the caller may write, and a refusal is shown with its
 * code.
 */

/** The metadata of a field of a collection. */
export interface FieldMetadata {
  name: string
  type: string
  required: boolean
  nullable: boolean
  maxLength?: number
  minLength?: number
  enum?: string[]
  minimum?: number
  maximum?: number
  label?: string
  description?: string
}

/** The metadata of a collection. */
export interface CollectionMetadata {
  key: string
  label: string
  description?: string
  actions: string[]
  readableFields: string[]
  writableFields: string[]
  filterableFields: string[]
  fields: FieldMetadata[]
  relations: { name: string; target: string; type: string }[]
}

/** The metadata of the deployment, for the caller. */
export interface SchemaMetadata {
  apiVersion: string
  schemaVersion: string
  policyBundleVersion: string
  limits: { maxLimit: number; defaultLimit: number }
  collections: CollectionMetadata[]
}

/** The session of the caller. */
export interface SessionInfo {
  principal: { subject: string; email?: string; name?: string; roles: string[] }
  workspace: string
  csrfToken: string
  gateway: { subject: string; roles: string[]; workspaceId?: string } | null
}

/** A row of a collection. */
export type Row = Record<string, unknown>

/** The page of a collection. */
export interface Page {
  data: Row[]
  meta: { limit: number; nextCursor: string | null; count?: number }
}

/** The groups of an aggregate. */
export interface Aggregate {
  data: { group: Record<string, unknown>; count: number }[]
  meta: { groups: number; truncated: boolean }
}

/** A page of the audit log. */
export interface AuditPage {
  data: Record<string, unknown>[]
  meta: { limit: number; nextCursor: string | null }
}
