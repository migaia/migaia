import { asCodecValue } from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { base64ToBytes, bytesToBase64 } from '@migaia/utils/bytes'
import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotConcurrencyLockKeys,
  type ILockKey
} from '@migaia/storage-contract'
import { decodeFlatStorageKey, encodeFlatStorageKey } from '../core/key-domain.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import type { IStorageJournalImage, IStorageJournalTarget } from '../journal/types.js'

/** Private deadline identities use the original reversible key codec, without entering business KV. */
const deadlineTag = 'memory.journal.deadline'
/** A persisted image declares the exact existing synchronous codec revision used for replay. */
const codec = defineJsonCodec({ version: 1 })

/** Preserve absence separately and reject values the existing durable codec cannot restore. */
export function encodeMemoryJournalImage(
  present: boolean,
  value?: unknown,
  bytes = false
): IStorageJournalImage {
  if (!present) return Object.freeze({ present: false })
  return Object.freeze({
    present: true,
    value: codec.encode({
      codec: codec.id,
      version: codec.version,
      value: bytes ? bytesToBase64(value as Uint8Array) : asCodecValue(value)
    })
  })
}

/** Decode only this owner's declared wire; original parse/codec failures remain reachable. */
export function decodeMemoryJournalImage(
  image: IStorageJournalImage,
  bytes = false
): { readonly present: boolean; readonly value?: unknown } {
  try {
    const present = image?.present
    if (present === false) return { present }
    const encoded = image.value
    if (present !== true || typeof encoded !== 'string') throw invalid()
    const wire = codec.decode(encoded)
    if (
      typeof wire !== 'object' ||
      wire === null ||
      Array.isArray(wire) ||
      Reflect.get(wire, 'codec') !== codec.id ||
      Reflect.get(wire, 'version') !== codec.version ||
      !Object.hasOwn(wire, 'value')
    )
      throw invalid()
    const value: unknown = Reflect.get(wire, 'value')
    if (!bytes) return { present, value }
    if (typeof value !== 'string') throw invalid()
    return { present, value: base64ToBytes(value) }
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid)
      throw cause
    throw invalid(cause)
  }
}

/** Deadline metadata retains the same physical key and therefore the same original point lock. */
export function memoryJournalDeadlineTarget(
  target: ILockKey
): Extract<IStorageJournalTarget, { readonly channel: 'metadata' }> {
  if (target.channel === 'rdf') throw new StorageContractError(StorageContractErrorCode.unsupported)
  return Object.freeze({
    channel: 'metadata',
    key: encodeFlatStorageKey([
      deadlineTag,
      target.channel,
      encodeFlatStorageKey(
        target.channel === 'vector' ? [target.collection, target.id] : target.key
      )
    ])
  })
}

/** Resolve one finite metadata mapping or borrow the original canonical lock snapshot unchanged. */
export function snapshotMemoryJournalTarget(target: IStorageJournalTarget): {
  readonly target: IStorageJournalTarget
  readonly lock: ILockKey
  readonly metadata: boolean
} {
  try {
    if (target.channel !== 'metadata') {
      const lock = snapshotConcurrencyLockKeys([target], STORAGE_MEMORY_BACKEND).keys[0]!
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
    const lock = snapshotConcurrencyLockKeys([candidate], STORAGE_MEMORY_BACKEND).keys[0]!
    if (lock.channel === 'rdf' || memoryJournalDeadlineTarget(lock).key !== key) throw invalid()
    return { target: Object.freeze({ channel: 'metadata', key }), lock, metadata: true }
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid)
      throw cause
    throw invalid(cause)
  }
}

/** This is owned persisted image/identity corruption, rather than a second codec validation rule. */
function invalid(cause?: unknown): StorageError {
  return new StorageError(
    StorageErrorCode.journalRecordInvalid,
    { cause },
    StorageErrorText.journalRecordInvalid
  )
}
