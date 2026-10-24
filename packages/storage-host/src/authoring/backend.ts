/** Reuse the original runtime-compatible disposal identity; authors never create another symbol. */
export { asyncDisposeKey } from '@migaia/plugin-host'
export type {
  IBackendChangeController,
  IBackendChangeControllerOptions,
  IBackendChangeSnapshot,
  IBackendValueCommit
} from '../core/backend-registry.js'
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
export { isStorageKeyInRange } from '../core/query-state.js'
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

export { createBackendJournalNamespace } from '../journal/namespace-resource.js'
export type {
  IBackendJournalNamespaceOptions,
  IBackendJournalTransaction
} from '../journal/namespace-resource.js'

export { storageJournalLockKey, StorageJournalLock } from '../journal/keys.js'

export { encodeStorageJournalImage, decodeStorageJournalImage } from '../journal/image.js'

/**
 * Best-effort diagnostics only; this intentionally observes mutable prototype/constructor/name
 * properties and must never participate in security or protocol classification. Returns the
 * observed prototype constructor name, or undefined for non-objects and absent names. No intrinsic
 * brand check is performed; use the canonical byte guards when a type decision matters.
 */
export const intrinsicConstructorName = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  /** Ordinary prototype metadata is diagnostic data, without hostile accessor interception. */
  const constructor = Object.getPrototypeOf(value)?.constructor
  return typeof constructor?.name === 'string' ? constructor.name : undefined
}
