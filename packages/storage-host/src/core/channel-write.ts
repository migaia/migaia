import type { IBackendKind, IStorageKey } from '@migaia/storage-contract'
import { StorageError, StorageErrorCode, type IStorageChannel } from '../errors.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'

/** Existing physical channel presence is supplied by the real backend. */
export type IChannelPresence = ReadonlySet<IStorageChannel>
/** A successful replace operation removes only other channels at the same logical key. */
export type IChannelMutationPlan = { readonly remove: readonly IStorageChannel[] }
/** Backend-owned error construction retains its source and native class without sharing a registry. */
export type IChannelConflictDetails = {
  readonly backend: IBackendKind
  readonly key: IStorageKey
  readonly existingChannel: IStorageChannel
  readonly attemptedChannel: IStorageChannel
}

/** Resolve cross-channel conflicts once; each backend executes only the returned removals. */
export function planChannelWrite(
  key: IStorageKey,
  attempted: IStorageChannel,
  existing: IChannelPresence,
  policy: 'conflict' | 'replace' = 'conflict',
  backend: IBackendKind = STORAGE_MEMORY_BACKEND,
  onConflict?: (details: IChannelConflictDetails) => Error
): IChannelMutationPlan {
  /** Preserve the original presence iteration and removal order. */
  const conflicts = [...existing].filter((channel) => channel !== attempted)
  if (conflicts.length > 0 && policy !== 'replace') {
    /** The backend factory receives the same original diagnostic context. */
    const details: IChannelConflictDetails = {
      backend,
      key,
      existingChannel: conflicts[0]!,
      attemptedChannel: attempted
    }
    throw onConflict?.(details) ?? new StorageError(StorageErrorCode.duplicateKey, details)
  }
  return { remove: conflicts }
}
