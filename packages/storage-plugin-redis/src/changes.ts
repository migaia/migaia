import { snapshotOperationContext, decodeStorageOrgKey } from '@migaia/storage-host/sdk'
import { type IStorageChange } from '@migaia/storage-contract'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { createRedisLayout, redisUnhex } from './layout.js'
import { redisError } from './errors.js'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import { RedisText } from './constants.js'
import type { IRedisDraftEntry } from './transaction.js'

/** The sole portable JSON codec transports bounded key identities, never application payloads. */
const codec = defineJsonCodec({ version: 1 })
/** One native commit has one notification; mixed channels become an honest broad invalidation. */
export function encodeRedisChange(
  layout: ReturnType<typeof createRedisLayout>,
  origin: string,
  sequence: number,
  changed: readonly IRedisDraftEntry[],
  broad = false
): { readonly wire: string; readonly change: IStorageChange } {
  const channels = new Set(changed.map((entry) => entry.channel)),
    channel =
      !broad && channels.size === 1
        ? changed[0]!.channel === 'text'
          ? 'value'
          : changed[0]!.channel
        : 'all',
    kind =
      !broad && changed.length === 1
        ? changed[0]!.value === undefined
          ? 'remove'
          : 'put'
        : 'batch',
    wire = codec.encode({
      sequence,
      origin,
      orgId: layout.orgId,
      channel,
      kind,
      ...(!broad && changed.length <= 128 ? { keys: changed.map((entry) => entry.encoded) } : {})
    })
  return { wire, change: decodeRedisChange(wire) }
}
/**
 * Transport validation retains original organization/key codecs and rejects malformed persisted
 * summaries.
 */
export function decodeRedisChange(wire: string): IStorageChange {
  try {
    const value = codec.decode(wire)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw redisError(RedisErrorCode.decodeFailed)
    const data = value as Record<string, unknown>,
      { sequence, origin, orgId, channel, kind, keys } = data
    if (
      typeof sequence !== 'number' ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      typeof origin !== 'string' ||
      typeof orgId !== 'string' ||
      !['value', 'bytes', 'record', 'all'].includes(channel as string) ||
      !['put', 'remove', 'clear', 'batch', 'migrate'].includes(kind as string) ||
      (keys !== undefined &&
        (!Array.isArray(keys) || keys.length > 128 || keys.some((key) => typeof key !== 'string')))
    )
      throw redisError(RedisErrorCode.decodeFailed)
    snapshotOperationContext({ orgId })
    const decodedKeys =
      keys === undefined
        ? undefined
        : (keys as string[]).map((key) =>
            decodeStorageOrgKey(orgId, redisUnhex(key), RedisText.backend)
          )
    return {
      sequence,
      origin,
      orgId,
      channel: channel as IStorageChange['channel'],
      kind: kind as IStorageChange['kind'],
      ...(decodedKeys === undefined ? {} : { keys: decodedKeys })
    }
  } catch (error) {
    throw redisError(RedisErrorCode.decodeFailed, error)
  }
}
