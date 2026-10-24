import {
  encodeOrderedStorageKey,
  encodeStorageOrgKey,
  decodeStorageOrgKey,
  snapshotStorageOrgKeyPrefix,
  type IStorageKey
} from '@migaia/storage-contract'
import { asCodecValue, type ICodecValue } from '@migaia/serialize/codec'
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
  /** Private log metadata never shares business values, clear operations or notifications. */
  journal: 'journal',
  changeField: 'change',
  locks: 'lock',
  sequence: '$sequence',
  /** Managed vector metadata remains readable for org cleanup without selecting Search. */
  vectorId: 'id',
  vectorCollection: 'collection',
  vectorOrg: 'org',
  vector: 'v',
  vectorIndex: 'vi',
  /** Native Feature channels share this physical layout with historical org removal. */
  streams: 'streams',
  sorted: 'sorted',
  rate: 'rate',
  pubsub: 'pubsub'
} as const
/**
 * Original portable JSON bytes have one physical presentation for collection, ID and scalar path
 * names.
 */
export function redisPortableIdentity(value: ICodecValue): string {
  return redisHex(new TextEncoder().encode(textCodec.encode(asCodecValue(value))))
}
/** Pure physical layout metadata belongs to one fixed organization, with no native resource state. */
type IRedisLayoutContext = {
  /** Canonical prefix hex retains the original nonempty same-slot hash tag. */
  tag: string
  /** Every logical key uses the exact original organization envelope. */
  orgId: string
  /** Native organization bounds reuse the original canonical ordered writer. */
  lower: string
  /** The exclusive upper endpoint belongs to the same fixed organization interval. */
  upper: string
}
/** Project a logical key through the one canonical organization codec. */
function redisLayoutEncode(context: IRedisLayoutContext, key: IStorageKey): string {
  return redisHex(encodeStorageOrgKey(context.orgId, key, RedisText.backend))
}
/** Decode only the original organization envelope and retain native corruption causes. */
function redisLayoutDecode(context: IRedisLayoutContext, encoded: string): IStorageKey {
  try {
    return decodeStorageOrgKey(context.orgId, redisUnhex(encoded), RedisText.backend)
  } catch (error) {
    throw redisError(RedisErrorCode.decodeFailed, error)
  }
}
/** Publish fixed mapping methods with explicit context; no mutable factory state or native I/O. */
export function createRedisLayout(prefix: string, orgId: string) {
  if (typeof prefix !== 'string') throw invalidArgument()
  const tag = '{' + redisHex(encodeOrderedStorageKey(prefix, RedisText.backend)) + '}'
  const span = snapshotStorageOrgKeyPrefix(orgId, undefined, RedisText.backend)
  const context: IRedisLayoutContext = {
    tag,
    orgId,
    lower: redisHex(span.lower),
    upper: redisHex(span.upper)
  }
  return {
    tag: context.tag,
    orgId: context.orgId,
    owns: (physical: string): boolean => {
      if (physical.startsWith(context.tag + ':' + RedisSuffix.locks + ':' + context.orgId + ':'))
        return true
      if (!physical.startsWith(context.tag + ':')) return false
      if (physical.startsWith(context.tag + ':' + RedisSuffix.vector + ':'))
        return physical.split(':')[3] === context.orgId
      const encoded = physical.slice(physical.lastIndexOf(':') + 1)
      return encoded >= context.lower && encoded < context.upper
    },
    feature: (channel: 'streams' | 'sorted' | 'rate' | 'pubsub', name: IStorageKey): string =>
      context.tag + ':' + channel + ':' + redisLayoutEncode(context, name),
    vectorPrefix: (collection: string): string =>
      context.tag + ':' + RedisSuffix.vector + ':' + redisPortableIdentity(collection) + ':',
    vectorPoint: (collection: string, id: string): string =>
      context.tag +
      ':' +
      RedisSuffix.vector +
      ':' +
      redisPortableIdentity(collection) +
      ':' +
      context.orgId +
      ':' +
      redisPortableIdentity(id),
    vectorIndex: (collection: string): string =>
      context.tag + ':' + RedisSuffix.vectorIndex + ':' + redisPortableIdentity(collection),
    vectorPattern: context.tag + ':' + RedisSuffix.vector + ':*:' + context.orgId + ':*',
    revisions: context.tag + ':' + RedisSuffix.revisions,
    changes: context.tag + ':' + RedisSuffix.changes,
    durableChanges: context.tag + ':' + RedisSuffix.durableChanges,
    journal: (namespace: string): string =>
      context.tag + ':' + RedisSuffix.journal + ':' + redisLayoutEncode(context, namespace),
    encode: (value: IStorageKey) => redisLayoutEncode(context, value),
    decode: (value: string) => redisLayoutDecode(context, value),
    value: (channel: IRedisChannel, key: IStorageKey): string =>
      context.tag + ':' + RedisSuffix[channel] + ':' + redisLayoutEncode(context, key),
    index: (channel: 'text' | 'record'): string =>
      context.tag + ':' + RedisSuffix[channel] + ':index',
    revision: (channel: IRedisChannel, key: IStorageKey): string =>
      RedisSuffix[channel] + ':' + redisLayoutEncode(context, key),
    rangeRevision: (channel: IRedisChannel): string =>
      RedisSuffix[channel] + ':range:' + context.orgId,
    lock: (identity: string): string =>
      context.tag + ':' + RedisSuffix.locks + ':' + context.orgId + ':' + identity,
    lockPattern: context.tag + ':' + RedisSuffix.locks + ':*'
  }
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
