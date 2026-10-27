import { encodeOrderedStorageKey, decodeOrderedStorageKey } from '@migaia/storage-host/sdk'
import { type IStorageKey, type ICodecStageObserver } from '@migaia/storage-contract'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import {
  defineCollectionsJsonCodec,
  type ICollectionsCodecValue
} from '@migaia/serialize/codecs/collections-json'
import { PostgresErrorCode } from '@migaia/storage-contract/error-code'
import { PostgresErrorText } from './error-text.js'
import { postgresError } from './errors.js'
import { PgNames } from './constants.js'
import { observePg } from './transaction.js'
/** Text values use the original portable JSON codec, including PostgreSQL-inexpressible code units. */
const textCodec = defineJsonCodec({ version: 1 })
/** Record/metadata values keep the single canonical collection codec and its own validation. */
const recordCodec = defineCollectionsJsonCodec({ version: 1 })
/** Native TEXT key presentation is only hex over the original canonical ordered bytes. */
export function pgKeyHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}
/** The contract alone owns forward key admission and ordered identity. */
export function pgKey(key: IStorageKey): { readonly bytes: Uint8Array; readonly hex: string } {
  const bytes = encodeOrderedStorageKey(key, PgNames.backend)
  return { bytes, hex: pgKeyHex(bytes) }
}
/** Hex is only a native TEXT presentation; canonical decoding remains with the contract owner. */
export function pgTextKey(value: unknown): IStorageKey {
  try {
    if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[a-f0-9]*$/.test(value))
      throw new TypeError(PostgresErrorText.decodeFailed)
    const bytes = new Uint8Array(value.length / 2)
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    return decodeOrderedStorageKey(bytes, PgNames.backend)
  } catch (cause) {
    throw postgresError(PostgresErrorCode.decodeFailed, cause)
  }
}
/** Only the contract decoder interprets persisted canonical key bytes. */
export function pgRecordKey(value: unknown): IStorageKey {
  try {
    if (!(value instanceof Uint8Array)) throw new TypeError(PostgresErrorText.decodeFailed)
    return decodeOrderedStorageKey(value, PgNames.backend)
  } catch (cause) {
    throw postgresError(PostgresErrorCode.decodeFailed, cause)
  }
}
/** Bind a string as lossless portable TEXT instead of relying on PostgreSQL's text value profile. */
export function encodePgText(value: string): string {
  return textCodec.encode(value)
}
/** Persisted text failures carry the backend decode boundary and preserve the original codec cause. */
export function decodePgText(value: unknown): string {
  try {
    if (typeof value !== 'string') throw new TypeError(PostgresErrorText.decodeFailed)
    const decoded = textCodec.decode(value)
    if (typeof decoded !== 'string') throw new TypeError(PostgresErrorText.decodeFailed)
    return decoded
  } catch (cause) {
    throw postgresError(PostgresErrorCode.decodeFailed, cause)
  }
}
/** The canonical codec validates runtime values; this generic storage boundary adds no projection. */
export function encodePgRecord(value: unknown): string {
  return recordCodec.encode(value as ICollectionsCodecValue)
}
/** Generic records remain validated canonical collection values after decoding. */
export function decodePgRecord<T = unknown>(value: unknown): T {
  try {
    if (typeof value !== 'string') throw new TypeError(PostgresErrorText.decodeFailed)
    return recordCodec.decode(value) as T
  } catch (cause) {
    throw postgresError(PostgresErrorCode.decodeFailed, cause)
  }
}
/** Persistence conversions share the original codecs; observations never become validation logic. */
export function createPgCodecs(observer?: ICodecStageObserver) {
  /** Observer failures remain report-only, including before hooks and asynchronous rejections. */
  const convert = <R>(
    channel: 'text' | 'record',
    direction: 'encode' | 'decode',
    run: () => R
  ): R => {
    const codec = channel === 'text' ? textCodec.id : recordCodec.id
    if (observer !== undefined)
      observePg(observer, direction === 'encode' ? 'beforeEncode' : 'beforeDecode', channel, codec)
    try {
      const value = run()
      if (observer !== undefined)
        observePg(observer, direction === 'encode' ? 'afterEncode' : 'afterDecode', channel, codec)
      return value
    } catch (cause) {
      if (observer !== undefined)
        observePg(
          observer,
          direction === 'encode' ? 'onEncodeError' : 'onDecodeError',
          channel,
          codec,
          typeof cause === 'object' && cause !== null && 'code' in cause
            ? String(cause.code)
            : undefined
        )
      throw cause
    }
  }
  return {
    encodeText: (value: string) => convert('text', 'encode', () => encodePgText(value)),
    decodeText: (value: unknown) => convert('text', 'decode', () => decodePgText(value)),
    encodeRecord: (value: unknown) => convert('record', 'encode', () => encodePgRecord(value)),
    decodeRecord: <T = unknown>(value: unknown): T =>
      convert('record', 'decode', () => decodePgRecord<T>(value))
  }
}
/** The default conversion table carries no observation or transaction authority. */
export const pgCodecs = createPgCodecs()
