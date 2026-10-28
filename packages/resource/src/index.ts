/**
 * Public Resource entry; exposes the existing runtime values and contracts without internal
 * modules.
 */
// Error codes are public API under `docs/contracts/error-codes.md`. Callers branch on `code`.
// Export their constants from the package entry so callers do not duplicate string literals.
export { ResourceErrorCode, type IResourceErrorCode } from './error-code.ts'
export { RESOURCE_SOURCE, type IResourceError } from './errors.ts'
export { ResourceStatus, ResourceFetchStatus } from './state-constants.ts'

export { Resource } from './resource.class.ts'
export type {
  IResourceCacheSnapshot,
  IResourceFetcher,
  IResourceFetchContext,
  IResourceOptions,
  IResourceRetryPolicy,
  IResourceState,
  IResourceUpdater
} from './resource-types.ts'

export {
  createResource,
  type ICreateResourceOptions,
  type IResourceSetup,
  type IResourceSetupContext
} from './create-resource.ts'
