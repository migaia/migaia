import { asCodecValue } from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { base64ToBytes, bytesToBase64 } from '@migaia/utils/bytes'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import type { IStorageJournalImage } from './types.js'

/** A persisted image declares the exact existing synchronous codec revision used for replay. */
const codec = defineJsonCodec({ version: 1 })

/** Preserve absence separately and reject values the existing durable codec cannot restore. */
export function encodeStorageJournalImage(
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
export function decodeStorageJournalImage(
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

/** This is owned persisted image corruption; original codec failures stay on the cause chain. */
function invalid(cause?: unknown): StorageError {
  return new StorageError(
    StorageErrorCode.journalRecordInvalid,
    { cause },
    StorageErrorText.journalRecordInvalid
  )
}
