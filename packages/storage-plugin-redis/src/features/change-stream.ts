import { RedisOperation } from '../constants.js'
import { RedisCommand, RedisText } from '../constants.js'
import type { IRedisConnection } from '../driver.js'
import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import { asyncDisposeKey, throwIfAborted } from '@migaia/storage-host/authoring/backend'
import {
  durableChangeFeed,
  implement,
  createStorageIteratorLifetime,
  StorageContractError,
  StorageContractErrorCode,
  type IDurableChangeFeedApi,
  type IDurableStorageChange,
  type ICapabilityImpl,
  type IStorageResource
} from '@migaia/storage-contract'
import { redisBackendKind } from '../plugin.js'
import { readNativeFeaturePort } from '../native-feature.js'
import { featureInteger, readStreamRows } from '../feature-input.js'
import { decodeRedisChange } from '../changes.js'
import { replyString, RedisSuffix } from '../layout.js'
import { redisError, invalidArgument, normalizeRedisTransactionFailure } from '../errors.js'
import { RedisErrorCode } from '../error-code.js'
/** Reliable change cursors are actual native Stream IDs, with no client-side acknowledgement ledger. */
export type IRedisChangeStreamOutput = IStorageFeatureOutput<
  readonly [ICapabilityImpl<typeof durableChangeFeed, IDurableChangeFeedApi>],
  {},
  { readonly store: {}; readonly transaction: {} }
>
/** Redis Stream components are unsigned 64-bit integers; exact strings retain their native identity. */
function cursor(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d*)-(?:0|[1-9]\d*)$/.test(value) ||
    value.split('-').some((part) => BigInt(part) > 18446744073709551615n)
  )
    throw invalidArgument()
  return value
}
/** Comparison uses native unsigned components without unsafe number conversion. */
function compare(a: string, b: string): number {
  const x = a.split('-').map(BigInt),
    y = b.split('-').map(BigInt)
  return x[0]! < y[0]! ? -1 : x[0]! > y[0]! ? 1 : x[1]! < y[1]! ? -1 : x[1]! > y[1]! ? 1 : 0
}
/** Fixed private Stream rows contain exactly one canonical commit summary. */
function changes(reply: unknown): readonly IDurableStorageChange[] {
  if (!Array.isArray(reply)) throw redisError(RedisErrorCode.decodeFailed, reply)
  return reply.map((row) => {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      !Array.isArray(row[1]) ||
      row[1].length !== 2 ||
      row[1][0] !== RedisSuffix.changeField
    )
      throw redisError(RedisErrorCode.decodeFailed, row)
    let id: string
    try {
      id = cursor(replyString(row[0]))
    } catch (error) {
      throw redisError(RedisErrorCode.decodeFailed, error)
    }
    return { ...decodeRedisChange(replyString(row[1][1])), cursor: id }
  })
}
/** Native retention facts distinguish an initial empty cursor from actually lost retained history. */
async function assertRetained(
  connection: IRedisConnection,
  stream: string,
  after: string
): Promise<void> {
  const first = changes(
    await connection.command([RedisCommand.xrange, stream, '-', '+', RedisCommand.count, '1'])
  )
  if (first[0] && compare(after, first[0].cursor) >= 0) return
  if (after === '0-0') {
    if (!first[0]) {
      const exists = await connection.command([RedisCommand.exists, stream])
      if (exists === 0) return
      if (exists !== 1) throw redisError(RedisErrorCode.decodeFailed, exists)
    }
    const reply = await connection.command([RedisCommand.xinfo, RedisCommand.stream, stream])
    let info: Record<string, unknown>
    if (Array.isArray(reply)) {
      if (
        reply.length % 2 !== 0 ||
        reply.some((value, index) => index % 2 === 0 && typeof value !== 'string')
      )
        throw redisError(RedisErrorCode.decodeFailed, reply)
      info = Object.fromEntries(
        Array.from({ length: reply.length / 2 }, (_, index) => [
          reply[index * 2],
          reply[index * 2 + 1]
        ])
      )
    } else {
      if (typeof reply !== 'object' || reply === null)
        throw redisError(RedisErrorCode.decodeFailed, reply)
      info = reply as Record<string, unknown>
    }
    const added = info['entries-added'],
      length = info.length
    if (
      typeof added !== 'number' ||
      typeof length !== 'number' ||
      !Number.isSafeInteger(added) ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      added < length
    )
      throw redisError(RedisErrorCode.decodeFailed, reply)
    if (added === length) return
  }
  throw new StorageContractError(StorageContractErrorCode.changeCursorExpired, {
    backend: RedisText.backend
  })
}
/**
 * Writes enter the original EXEC; replay and blocking reads borrow only genuine dedicated
 * connections.
 */
export function redisChangeStreamFeature(options: { readonly maxLen: number }) {
  const maxLen = featureInteger(options.maxLen)
  return defineFeature<typeof redisBackendKind, {}, IRedisChangeStreamOutput>(
    redisBackendKind,
    (core) => {
      core.featureExpose.registerDetect(async () => {
        readNativeFeaturePort(core.featureExpose.getStore()).enableDurable(maxLen, create)
      })
      const create = (store: import('../types.js').IRedisStore) =>
        createRedisDurableApi(() => readNativeFeaturePort(store))
      const api = createRedisDurableApi(() => readNativeFeaturePort(core.featureExpose.getStore()))
      return {
        capabilities: [implement(durableChangeFeed, api)] as const,
        chain: {},
        api: { store: {}, transaction: {} }
      }
    }
  )
}

/** Each original provider receives only its own native organization port, never a shared root API. */
function createRedisDurableApi(
  resolve: () => import('../native-feature.js').IRedisNativeFeaturePort
): IDurableChangeFeedApi {
  return {
    async readChanges(options, ctx) {
      const after = options?.after,
        limit = featureInteger(options?.limit ?? 100)
      if (after !== undefined) cursor(after)
      const port = resolve()
      return port.run(
        RedisOperation.changesRead,
        { after, limit },
        ctx,
        false,
        async (input, connection, layout) => {
          if (input.after !== undefined) cursor(input.after)
          featureInteger(input.limit)
          if (input.after !== undefined)
            await assertRetained(connection, layout.durableChanges, input.after)
          let current = input.after ?? '0-0'
          const result: IDurableStorageChange[] = []
          for (;;) {
            const page = changes(
              await connection.command([
                RedisCommand.xrange,
                layout.durableChanges,
                '(' + current,
                '+',
                RedisCommand.count,
                String(input.limit - result.length)
              ])
            )
            if (page.length === 0) break
            for (const change of page) {
              current = change.cursor
              if (change.orgId === layout.orgId || port.allOrganizations) result.push(change)
            }
            if (result.length === input.limit) break
          }
          return { changes: result, cursor: current }
        }
      )
    },
    async tailChanges(options, ctx) {
      const from = options.from,
        onChange = options.onChange,
        onError = options.onError
      if (from !== 'now') cursor(from)
      if (
        typeof onChange !== 'function' ||
        (onError !== undefined && typeof onError !== 'function')
      )
        throw invalidArgument()
      const port = resolve()
      return port.resource(
        RedisOperation.changesTail,
        { from },
        ctx,
        async (input, layout, signal) => {
          let current = input.from
          if (current === 'now') {
            const last = changes(
              await port.driver.command([
                RedisCommand.xrevrange,
                layout.durableChanges,
                '+',
                '-',
                RedisCommand.count,
                '1'
              ])
            )
            current = last[0]?.cursor ?? '0-0'
          } else cursor(current)
          const lifetime = createStorageIteratorLifetime<never>({
              close: async () => {},
              report: port.report
            }),
            resource: IStorageResource = {
              dispose: lifetime.dispose,
              [asyncDisposeKey]: lifetime.symbolic
            }
          const pending = lifetime.advance(async () => {
            await port.driver.withConnection(async (connection) => {
              while (!lifetime.isClosing()) {
                throwIfAborted(signal)
                await assertRetained(connection, layout.durableChanges, current)
                const reply = await connection.command([
                  RedisCommand.xread,
                  RedisCommand.count,
                  '100',
                  RedisCommand.block,
                  '1000',
                  RedisCommand.streams,
                  layout.durableChanges,
                  current
                ])
                if (reply === null) continue
                const rows = readStreamRows(reply, layout.durableChanges)
                await assertRetained(connection, layout.durableChanges, current)
                for (const change of changes(rows)) {
                  if (lifetime.isClosing()) return
                  throwIfAborted(signal)
                  if (change.orgId === layout.orgId || port.allOrganizations) {
                    await onChange(change)
                  }
                  current = change.cursor
                }
              }
            })
            return { done: true, value: undefined }
          })
          void pending.then(undefined, (error) => {
            const failure = normalizeRedisTransactionFailure(error)
            port.report(failure)
            if (onError) {
              try {
                const result: unknown = onError(failure)
                void Promise.resolve(result).catch(port.report)
              } catch (secondary) {
                port.report(secondary)
              }
            }
            void resource[asyncDisposeKey]()
          })
          return resource
        }
      )
    }
  }
}
