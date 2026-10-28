import {
  StorageContractError,
  StorageContractErrorCode,
  assertLockKey,
  type ILockKey
} from '@migaia/storage-contract'
import { decodeFlatStorageKey, encodeFlatStorageKey } from '../core/key-domain.js'
import { StorageError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import type { IStorageJournalTarget } from '../journal/types.js'

/** Private deadline identities use the original reversible key codec, without entering business KV. */
const deadlineTag = 'memory.journal.deadline'
/** Deadline metadata retains the same physical key and therefore the same original point lock. */
export function memoryJournalDeadlineTarget(
  target: ILockKey
): Extract<IStorageJournalTarget, { readonly channel: 'metadata' }> {
  if (target.channel === 'rdf') throw new StorageContractError(StorageContractErrorCode.unsupported)
  return {
    channel: 'metadata',
    key: encodeFlatStorageKey([
      deadlineTag,
      target.channel,
      encodeFlatStorageKey(
        target.channel === 'vector' ? [target.collection, target.id] : target.key
      )
    ])
  }
}

/** Resolve finite metadata synchronously without copying an already-owned canonical lock. */
export function snapshotMemoryJournalTarget(target: IStorageJournalTarget): {
  readonly target: IStorageJournalTarget
  readonly lock: ILockKey
  readonly metadata: boolean
} {
  try {
    if (target.channel !== 'metadata') {
      assertLockKey(target, STORAGE_MEMORY_BACKEND)
      /** No await separates admission from native journal target mapping. */
      const lock = target
      return { target: lock, lock, metadata: false }
    }
    const key = target.key
    const wire = decodeFlatStorageKey(key)
    if (
      !Array.isArray(wire) ||
      wire.length !== 3 ||
      wire[0] !== deadlineTag ||
      typeof wire[2] !== 'string'
    )
      throw invalid()
    const decoded = decodeFlatStorageKey(wire[2])
    if (decoded === undefined) throw invalid()
    const candidate =
      wire[1] === 'vector' && Array.isArray(decoded) && decoded.length === 2
        ? { channel: wire[1], collection: decoded[0], id: decoded[1] }
        : { channel: wire[1], key: decoded }
    assertLockKey(candidate, STORAGE_MEMORY_BACKEND)
    /** Decoded metadata already belongs to this synchronous mapping. */
    const lock = candidate
    if (lock.channel === 'rdf' || memoryJournalDeadlineTarget(lock).key !== key) throw invalid()
    return { target: { channel: 'metadata', key }, lock, metadata: true }
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === StorageHostErrorCode.journalRecordInvalid)
      throw cause
    throw invalid(cause)
  }
}

/** This is owned persisted image/identity corruption, rather than a second codec validation rule. */
function invalid(cause?: unknown): StorageError {
  return new StorageError(
    StorageHostErrorCode.journalRecordInvalid,
    { cause },
    StorageErrorText.journalRecordInvalid
  )
}
