import { encodeOrderedStorageKey, snapshotStorageKey } from '@migaia/storage-host/sdk'
import { type IStorageKey } from '@migaia/storage-contract'
import { sqliteError } from './errors.ts'
import { SqliteErrorCode } from '@migaia/storage-contract/error-code'
import { SqliteErrorText } from './error-text.ts'
/** Persisted TEXT identities contain canonical ordered bytes, never SQLite's UTF-8 string order. */
export function keyHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}
/** Decode is private persistence IO; all forward encoding stays with the canonical contract owner. */
export function decodeKey(bytes: Uint8Array): IStorageKey {
  try {
    /** Cursor-based reader over the persisted bytes. */
    const reader = new SqliteKeyReader(bytes)
    /** Canonical admission catches invalid dates, numbers, empty arrays and malformed nesting. */
    const key = snapshotStorageKey(reader.read(), 'sqlite')
    /** Reject trailing bytes and noncanonical representations by reusing the sole forward encoder. */
    const canonical = encodeOrderedStorageKey(key, 'sqlite')
    if (
      reader.offset !== bytes.length ||
      canonical.length !== bytes.length ||
      canonical.some((value, index) => value !== bytes[index])
    )
      throw new Error(SqliteErrorText.malformedKey)
    return key
  } catch (cause) {
    throw sqliteError(SqliteErrorCode.decodeFailed, cause)
  }
}
/** TEXT keys are decoded strictly rather than silently accepting truncated hex. */
export function decodeHexKey(text: string): IStorageKey {
  if (text.length % 2 !== 0 || !/^[0-9a-f]*$/.test(text))
    throw sqliteError(SqliteErrorCode.decodeFailed, new Error(SqliteErrorText.malformedKey))
  return decodeKey(
    Uint8Array.from({ length: text.length / 2 }, (_, index) =>
      Number.parseInt(text.slice(index * 2, index * 2 + 2), 16)
    )
  )
}

/** Decodes one canonical ordered key from persisted bytes with a monotonic cursor. */
class SqliteKeyReader {
  /** Persisted key bytes. */
  readonly #bytes: Uint8Array
  /** Next unread byte; a monotonic cursor prevents repeated prefix copying. */
  offset = 0
  /** Binds the bytes to decode. */
  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
  }
  /**
   * Reads one key; the decoder accepts only the published canonical wire tags. Recursive for
   * arrays.
   */
  read(): IStorageKey {
    /** The original byte tags describe this persisted format, rather than another key encoder. */
    const tag = this.#bytes[this.offset++]
    if (tag === 1 || tag === 2) {
      if (this.offset + 8 > this.#bytes.length) throw new Error(SqliteErrorText.malformedKey)
      /** Reverse the canonical IEEE ordering transform into an independent fixed-width buffer. */
      const numberBytes = this.#bytes.slice(this.offset, this.offset + 8)
      this.offset += 8
      if (numberBytes[0]! & 128) numberBytes[0] ^= 128
      else for (let index = 0; index < 8; index++) numberBytes[index] ^= 255
      /** Dates share numeric ordering but preserve their own type tag. */
      const value = new DataView(numberBytes.buffer).getFloat64(0, false)
      return tag === 1 ? value : new Date(value)
    }
    if (tag === 3) {
      /** Code units stay UTF-16, including lone surrogates. */
      const units: number[] = []
      while (this.#bytes[this.offset] !== 0) {
        if (this.#bytes[this.offset++] !== 1 || this.offset + 2 > this.#bytes.length)
          throw new Error(SqliteErrorText.malformedKey)
        units.push(this.#bytes[this.offset++]! * 256 + this.#bytes[this.offset++]!)
      }
      this.offset++
      /** Joining bounded chunks avoids argument count limits for legitimate long keys. */
      const chunks: string[] = []
      for (let index = 0; index < units.length; index += 8192)
        chunks.push(String.fromCharCode(...units.slice(index, index + 8192)))
      return chunks.join('')
    }
    if (tag === 4) {
      /** Each byte is preceded by the canonical nonzero continuation marker. */
      const values: number[] = []
      while (this.#bytes[this.offset] !== 0) {
        if (this.#bytes[this.offset++] !== 1 || this.offset >= this.#bytes.length)
          throw new Error(SqliteErrorText.malformedKey)
        values.push(this.#bytes[this.offset++]!)
      }
      this.offset++
      return Uint8Array.from(values).buffer
    }
    if (tag === 5) {
      /** Array children are complete encodings; only the root terminator closes this frame. */
      const values: IStorageKey[] = []
      while (this.offset < this.#bytes.length && this.#bytes[this.offset] !== 0)
        values.push(this.read())
      if (this.#bytes[this.offset++] !== 0) throw new Error(SqliteErrorText.malformedKey)
      return values
    }
    throw new Error(SqliteErrorText.malformedKey)
  }
}
