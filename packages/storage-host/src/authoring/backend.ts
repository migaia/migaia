export type {
  IBackendChangeController,
  IBackendChangeControllerOptions,
  IBackendChangeSnapshot
} from '../core/change-controller.js'
export {
  createStorageOperationReporter,
  createStorageOperationRuntime,
  reportCleanupError
} from '../core/operation-reporter.js'
export {
  encodeFlatStorageKey,
  decodeFlatStorageKey,
  snapshotKeyRange,
  assertKeyRange
} from '../core/key-domain.js'
export { isStorageKeyInRange } from '../core/query.js'
export { safeJsonPayloadByteLength } from '../core/json.js'
export { createStorageToken } from '../core/storage-token.js'
export { resolveStorageNamespace } from '../core/namespace.js'
export type {
  IStorageOperationReporter,
  IStorageOperationRuntime
} from '../core/operation-reporter.js'
