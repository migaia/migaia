/** Reuse the original runtime-compatible disposal identity; authors never create another symbol. */
export { asyncDisposeKey } from '@migaia/plugin-host'
export type {
  IBackendChangeController,
  IBackendChangeControllerOptions,
  IBackendChangeSnapshot,
  IBackendValueCommit
} from '../core/backend-registry.ts'
export {
  createStorageOperationReporter,
  createStorageOperationRuntime,
  reportCleanupError
} from '../core/operation-reporter.ts'
export {
  encodeFlatStorageKey,
  decodeFlatStorageKey,
  snapshotKeyRange,
  assertKeyRange
} from '../core/key-domain.ts'
export { isStorageKeyInRange } from '../core/query-state.ts'
export { safeJsonPayloadByteLength } from '../core/json.ts'
export { createStorageToken } from '../core/storage-token.ts'
export { resolveStorageNamespace } from '../core/namespace.ts'
export { observeStorageBatch } from '../core/batch-observation.ts'
export { planChannelWrite } from '../core/channel-write.ts'
export type {
  IChannelPresence,
  IChannelMutationPlan,
  IChannelConflictDetails
} from '../core/channel-write.ts'
export { collectUniqueIndexOwners } from '../core/unique-index.ts'
export type { IUniqueIndexOwner, IUniqueIndexErrorFactory } from '../core/unique-index.ts'
export { isStorageErrorFamily, normalizeError } from '../core/error-family.ts'
export type { IStorageErrorFamily } from '../core/error-family.ts'
export { invokeExtension } from '../core/invoke-extension.ts'
export {
  readAbortReason,
  subscribeToAbort,
  throwIfAborted,
  mergeSignals,
  withAbort
} from '../core/operation.ts'
export type {
  IStorageOperationReporter,
  IStorageOperationRuntime
} from '../core/operation-reporter.ts'

export type { IBackendKeyLockPort } from '../backends/key-locks.ts'

export type { IBackendRevisionPort } from '../backends/revisions.ts'

export { createBackendJournalNamespace } from '../journal/namespace-resource.ts'
export type {
  IBackendJournalNamespaceOptions,
  IBackendJournalTransaction
} from '../journal/namespace-resource.ts'

export { storageJournalLockKey, StorageJournalLock } from '../journal/keys.ts'

export { encodeStorageJournalImage, decodeStorageJournalImage } from '../journal/image.ts'

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
