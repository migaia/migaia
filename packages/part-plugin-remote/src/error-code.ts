/** Stable error domain of remote delivery; it names the role, not a package path. */
export const ERROR_SOURCE = 'part.remote'

/** The single declaration site for `part.remote` error codes. Code values are public API. */
export const PartRemoteErrorCode = {
  /**
   * A delivered version was refused: delivery check (missing capabilities), chunk preload, module
   * load or install check failed. The current version stays; the reason is on `cause`, and `tag`,
   * `missing` (definition ids) and `missingStores` (state namespaces) are on the error. Publish a
   * version the client supports.
   */
  versionRejected: 'REMOTE_VERSION_REJECTED',
  /**
   * Remote module bytes did not match their `integrity` or `id`. The version is refused; the module
   * is never imported. Rebuild and republish the module.
   */
  moduleIntegrity: 'REMOTE_MODULE_INTEGRITY',
  /**
   * A catalog request failed or answered other than 2xx/304; the original error or status is on
   * `cause`. The current version stays; the client retries on the next revalidation.
   */
  fetchFailed: 'REMOTE_FETCH_FAILED',
  /**
   * The Worker was asked to run an isolated effect that is not in its current table: the effect was
   * removed by a version whose page placeholders were not installed yet. The host ends the run with
   * EFFECT_FAILED and this error on `cause`; no action is needed once the new version is
   * installed.
   */
  isolatedEffectMissing: 'REMOTE_ISOLATED_EFFECT_MISSING'
} as const

/** Value union of every `part.remote` error code. */
export type IPartRemoteErrorCode = (typeof PartRemoteErrorCode)[keyof typeof PartRemoteErrorCode]
