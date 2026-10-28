import {
  throwIfAborted,
  encodeOrderedStorageKey,
  decodeOrderedStorageKey
} from '@migaia/storage-host/sdk'
import type { IRedisNativeFeaturePort } from './native-feature.js'
import { assertStringStorageKey } from '@migaia/storage-contract'
import { base64ToBytes, bytesToBase64 } from '@migaia/serialize/core'
import { isUint8Array } from '@migaia/utils/bytes'
import { invalidArgument, redisError } from './errors.js'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import { RedisText } from './constants.js'
import { redisHex, redisUnhex, replyString } from './layout.js'
/** Feature names follow the same logical string domain as standard text keys. */
export function featureName(value: string): string {
  assertStringStorageKey(value, RedisText.backend)
  return value
}
/** Native count, duration and cost arguments reject fractional or unbounded work. */
export function featureInteger(value: number, zero = false): number {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw invalidArgument()
  return value
}
/** Binary Feature payloads use the sole canonical base64 transport. */
export function featureBytes(value: Uint8Array): string {
  if (!isUint8Array(value)) throw invalidArgument()
  return bytesToBase64(new Uint8Array(value))
}
/** Corrupt persisted payloads remain decode failures with their actual native evidence. */
export function readFeatureBytes(value: unknown): Uint8Array {
  try {
    return base64ToBytes(replyString(value))
  } catch (error) {
    throw redisError(RedisErrorCode.decodeFailed, error)
  }
}
/** Lexicographic native ties reuse the original ordered UTF-16 key writer. */
export function featureMember(value: string): string {
  return redisHex(encodeOrderedStorageKey(featureName(value), RedisText.backend))
}
/** The original decoder reads the same transport without another string codec. */
export function readFeatureMember(value: unknown): string {
  try {
    const member = decodeOrderedStorageKey(redisUnhex(replyString(value)), RedisText.backend)
    if (typeof member !== 'string') throw invalidArgument()
    return member
  } catch (error) {
    throw redisError(RedisErrorCode.decodeFailed, error)
  }
}

/** Bound native empty waits on the same genuine lease; native failures are never replayed. */
export async function blockingCommand(
  port: IRedisNativeFeaturePort,
  blockMs: number,
  send: (sliceMs: number) => Promise<unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  const started = port.now()
  for (;;) {
    throwIfAborted(signal)
    throwIfAborted(port.closingSignal)
    const remaining = Math.ceil(blockMs - (port.now() - started))
    if (remaining <= 0) return null
    const reply = await send(Math.min(1000, remaining))
    throwIfAborted(signal)
    throwIfAborted(port.closingSignal)
    if (reply !== null) return reply
  }
}

/** Actual RESP2, node RESP3 objects and ioredis RESP3 flat Map pairs share one fixed Stream reader. */
export function readStreamRows(reply: unknown, physical: string): unknown {
  if (Array.isArray(reply)) {
    const row =
      reply.length === 2 && typeof reply[0] === 'string'
        ? reply
        : reply.length === 1 && Array.isArray(reply[0])
          ? reply[0]
          : undefined
    if (!row || row.length !== 2 || row[0] !== physical)
      throw redisError(RedisErrorCode.decodeFailed, reply)
    return row[1]
  }
  if (
    typeof reply !== 'object' ||
    reply === null ||
    Object.keys(reply).length !== 1 ||
    !Object.hasOwn(reply, physical)
  )
    throw redisError(RedisErrorCode.decodeFailed, reply)
  return Reflect.get(reply, physical)
}
