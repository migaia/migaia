export type {
  IBackendChangeController,
  IBackendChangeControllerOptions,
  IBackendChangeSnapshot,
  IBackendValueCommit
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
export { observeStorageBatch } from '../core/batch-observation.js'
export { planChannelWrite } from '../core/channel-write.js'
export type {
  IChannelPresence,
  IChannelMutationPlan,
  IChannelConflictDetails
} from '../core/channel-write.js'
export { collectUniqueIndexOwners } from '../core/unique-index.js'
export type { IUniqueIndexOwner, IUniqueIndexErrorFactory } from '../core/unique-index.js'
export { isStorageErrorFamily, normalizeError } from '../core/error-family.js'
export type { IStorageErrorFamily } from '../core/error-family.js'
export { invokeExtension } from '../core/errors.js'
export {
  readAbortReason,
  subscribeToAbort,
  throwIfAborted,
  mergeSignals,
  withAbort
} from '../core/operation.js'
export type {
  IStorageOperationReporter,
  IStorageOperationRuntime
} from '../core/operation-reporter.js'

export type { IBackendKeyLockPort } from '../backends/key-locks.js'

export type { IBackendRevisionPort } from '../backends/revisions.js'
