/** Stable error domain of the catalog service; it names the service role, not a package path. */
export const ERROR_SOURCE = 'part.catalog'

/** The single declaration site for `part.catalog` error codes, returned in HTTP error bodies. */
export const PartCatalogErrorCode = {
  /** No `Authorization: Bearer` token, or an unknown token (HTTP 401). Send a valid token. */
  authRequired: 'AUTH_REQUIRED',
  /**
   * The token's project, environment set or scope does not cover the request (HTTP 403). Create a
   * token for that project and environment with the needed scope.
   */
  authForbidden: 'AUTH_FORBIDDEN',
  /** More than 60 write requests in one minute for one token (HTTP 429). Retry later. */
  rateLimited: 'RATE_LIMITED',
  /** Upload validation found errors (HTTP 422); the issues are in the body. Fix and rebuild. */
  snapshotRejected: 'SNAPSHOT_REJECTED',
  /**
   * Uploaded bytes do not match their hash, a referenced module is missing or does not match, or a
   * source belongs to no module of the snapshot (HTTP 422). Upload the build output unchanged.
   */
  snapshotMismatch: 'SNAPSHOT_MISMATCH',
  /** Publish or rollback named a snapshot hash never uploaded to the project (HTTP 404). */
  snapshotUnknown: 'SNAPSHOT_UNKNOWN',
  /** The environment has no published snapshot yet (HTTP 404). Publish one first. */
  envUnpublished: 'ENV_UNPUBLISHED',
  /** The request does not match any route or has an unreadable body (HTTP 400 or 404). */
  requestInvalid: 'REQUEST_INVALID'
} as const

/** Value union of every `part.catalog` error code. */
export type IPartCatalogErrorCode = (typeof PartCatalogErrorCode)[keyof typeof PartCatalogErrorCode]
