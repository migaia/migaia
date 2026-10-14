// Error codes are public API under `docs/contracts/error-codes.md`. Callers branch on `code`.
// Export their constants from the package entry so callers do not duplicate string literals.
export { ResourceErrorCode, type IResourceErrorCode } from './error-code.js'
export { RESOURCE_SOURCE, type IResourceError } from './errors.js'
export { ResourceStatus, type IResourceStatus } from './state-constants.js'

export {
  Resource,
  type IResourceCacheSnapshot,
  type IResourceFetcher,
  type IResourceFetchStatus,
  type IResourceOptions,
  type IResourceRetryPolicy,
  type IResourceState
} from './resource.class.js'
