import { snapshotConcurrencyLockKeys } from '../authoring/concurrency.js'
import { type IBackendKind } from '@migaia/storage-contract'
import { snapshotLogRecords, type ILogPayload } from './logger-runtime.js'
import { decodeFlatStorageKey, encodeFlatStorageKey } from '../core/key-domain.js'
import { StorageError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { StorageJournalKind } from './constants.js'
import type { IStorageJournalTarget } from './types.js'

/** Persisted target failures retain the original canonical codec or lock-validator cause. */
export function invalidStorageJournalRecord(cause?: unknown): never {
  throw new StorageError(
    StorageHostErrorCode.journalRecordInvalid,
    { cause },
    StorageErrorText.journalRecordInvalid
  )
}
/** Encode only the original canonical target; the original key codec retains Date/binary keys. */
export function storageJournalTargetWire(target: IStorageJournalTarget): ILogPayload {
  return target.channel === 'rdf'
    ? snapshotLogRecords([{ kind: StorageJournalKind.commit, payload: target }])[0]!.payload
    : target.channel === 'vector'
      ? { channel: target.channel, collection: target.collection, id: target.id }
      : {
          channel: target.channel,
          key: target.channel === 'metadata' ? target.key : encodeFlatStorageKey(target.key)
        }
}
/** Both recovery and undo decode the same existing target codec and canonical lock domain. */
export function readStorageJournalTarget(
  input: unknown,
  backend: IBackendKind
): IStorageJournalTarget {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      invalidStorageJournalRecord()
    /** The original logger snapshots the JSON object before this target decoder observes it. */
    const value = input as Record<string, unknown>
    if (value.channel === 'metadata') {
      if (typeof value.key !== 'string' || decodeFlatStorageKey(value.key) === undefined)
        invalidStorageJournalRecord()
      return { channel: 'metadata', key: value.key }
    }
    /** Flat key decoding happens only for the three existing key-bearing physical channels. */
    const candidate =
      value.channel === 'text' || value.channel === 'bytes' || value.channel === 'record'
        ? {
            channel: value.channel,
            key:
              typeof value.key === 'string'
                ? decodeFlatStorageKey(value.key)
                : invalidStorageJournalRecord()
          }
        : value
    return snapshotConcurrencyLockKeys([candidate], backend).keys[0]!
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === StorageHostErrorCode.journalRecordInvalid)
      throw cause
    return invalidStorageJournalRecord(cause)
  }
}
/** Original physical lock identity also coalesces repeated undo images without sorting. */
export function storageJournalTargetIdentity(
  target: IStorageJournalTarget,
  backend: IBackendKind
): string {
  return encodeFlatStorageKey(
    target.channel === 'metadata'
      ? [target.channel, target.key]
      : [target.channel, snapshotConcurrencyLockKeys([target], backend).identities[0]!]
  )
}
