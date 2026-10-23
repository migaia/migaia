import {
  encodeOrderedStorageKey,
  encodeStorageOrgKey,
  decodeStorageOrgKey,
  snapshotStorageOrgKeyPrefix,
  type IStorageKey
} from '@migaia/storage-contract'
import { bytesToBase64, base64ToBytes } from '@migaia/serialize/core'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import {
  defineCollectionsJsonCodec,
  type ICollectionsCodecValue
} from '@migaia/serialize/codecs/collections-json'
import { redisError, invalidArgument } from './errors.js'
import { RedisErrorCode } from './error-code.js'
import { RedisText } from './constants.js'

/** Native Redis names use only lowercase ASCII hex; logical tags remain owned by the contract codec. */
export const redisHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
/** This reads only the transport representation before the original logical decoder runs. */
export function redisUnhex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw redisError(RedisErrorCode.decodeFailed)
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  )
}
/** Public channels share only logical identity; each native value has one owner and wire format. */
export type IRedisChannel = 'text' | 'bytes' | 'record'
/** Original codecs preserve UTF-16 strings and portable collection values without host encoders. */
const textCodec = defineJsonCodec({ version: 1 }),
  recordCodec = defineCollectionsJsonCodec({ version: 1 })
/** Native channel and metadata suffixes are stable across independent connections and processes. */
export const RedisSuffix = {
  text: 't',
  bytes: 'b',
  record: 'r',
  revisions: 'rev',
  changes: 'changes',
  durableChanges: 'durable-changes',
  changeField: 'change',
  locks: 'lock',
  sequence: '$sequence'
} as const
/** Same-slot namespace and original logical key codec are the only physical key mapping. */
export function createRedisLayout(prefix: string, orgId: string) {
  if (typeof prefix !== 'string') throw invalidArgument()
  const tag = '{' + redisHex(encodeOrderedStorageKey(prefix, RedisText.backend)) + '}',
    encode = (key: IStorageKey): string =>
      redisHex(encodeStorageOrgKey(orgId, key, RedisText.backend)),
    span = snapshotStorageOrgKeyPrefix(orgId, undefined, RedisText.backend),
    lower = redisHex(span.lower),
    upper = redisHex(span.upper),
    decode = (encoded: string): IStorageKey => {
      try {
        return decodeStorageOrgKey(orgId, redisUnhex(encoded), RedisText.backend)
      } catch (error) {
        throw redisError(RedisErrorCode.decodeFailed, error)
      }
    }
  return Object.freeze({
    tag,
    orgId,
    owns: (physical: string): boolean => {
      if (physical.startsWith(tag + ':' + RedisSuffix.locks + ':' + orgId + ':')) return true
      if (!physical.startsWith(tag + ':')) return false
      const encoded = physical.slice(physical.lastIndexOf(':') + 1)
      return encoded >= lower && encoded < upper
    },
    revisions: tag + ':' + RedisSuffix.revisions,
    changes: tag + ':' + RedisSuffix.changes,
    durableChanges: tag + ':' + RedisSuffix.durableChanges,
    encode,
    decode,
    value: (channel: IRedisChannel, key: IStorageKey): string =>
      tag + ':' + RedisSuffix[channel] + ':' + encode(key),
    index: (channel: 'text' | 'record'): string => tag + ':' + RedisSuffix[channel] + ':index',
    revision: (channel: IRedisChannel, key: IStorageKey): string =>
      RedisSuffix[channel] + ':' + encode(key),
    rangeRevision: (channel: IRedisChannel): string => RedisSuffix[channel] + ':range:' + orgId,
    lock: (identity: string): string =>
      tag + ':' + RedisSuffix.locks + ':' + orgId + ':' + identity,
    lockPattern: tag + ':' + RedisSuffix.locks + ':*'
  })
}
/** Fixed string replies admit genuine SDK strings and byte views while rejecting arbitrary coercion. */
export function replyString(value: unknown): string {
  if (typeof value === 'string') return value
  throw redisError(RedisErrorCode.decodeFailed, value)
}
/** A native missing bulk reply remains distinct from an empty string. */
export function replyOptionalString(value: unknown): string | undefined {
  return value === null ? undefined : replyString(value)
}
/** Fixed integer replies cannot silently lose precision or accept native error values. */
export function replyInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw redisError(RedisErrorCode.decodeFailed, value)
  return value
}
/** Native revision counters travel as decimal bulk strings rather than rounded JSON numbers. */
export function replyRevision(value: unknown): number {
  if (value === null) return 0
  const text = replyString(value),
    number = Number(text)
  if (!Number.isSafeInteger(number) || number < 0 || String(number) !== text)
    throw redisError(RedisErrorCode.decodeFailed, value)
  return number
}
/** Input serialization completes before native admission and holds no caller-owned payload. */
export function encodeRedisValue(channel: IRedisChannel, value: unknown): string {
  try {
    if (channel === 'text') {
      if (typeof value !== 'string') throw invalidArgument()
      return textCodec.encode(value)
    }
    if (channel === 'bytes') return bytesToBase64(value as Uint8Array)
    return recordCodec.encode(value as ICollectionsCodecValue)
  } catch (error) {
    throw invalidArgument(error)
  }
}
/** Persisted corruption is a decode failure, never a successful missing value. */
export function decodeRedisValue(channel: IRedisChannel, value: string): unknown {
  try {
    if (channel === 'bytes') return base64ToBytes(value)
    if (channel === 'record') return recordCodec.decode(value)
    const decoded = textCodec.decode(value)
    if (typeof decoded !== 'string') throw redisError(RedisErrorCode.decodeFailed)
    return decoded
  } catch (error) {
    throw redisError(RedisErrorCode.decodeFailed, error)
  }
}
