import { RedisOperation } from '../constants.js'
import { RedisCommand } from '../constants.js'
import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { redisBackendKind } from '../plugin.js'
import { readNativeFeaturePort } from '../native-feature.js'
import {
  featureName,
  featureInteger,
  featureBytes,
  readFeatureBytes,
  readStreamRows,
  blockingCommand
} from '../feature-input.js'
import { RedisSuffix, replyInteger, replyString } from '../layout.js'
import { invalidArgument, redisError } from '../errors.js'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
/** Stream fields are independent byte values reconstructed from the canonical text wire. */
export type IRedisStreamEntry = {
  readonly id: string
  readonly fields: Readonly<Record<string, Uint8Array>>
}
/** Consumer groups run only on native root endpoints, never interactive WATCH drafts. */
export type IRedisStreamsApi = {
  readonly streams: {
    add(
      stream: string,
      fields: Readonly<Record<string, Uint8Array>>,
      ctx?: IOperationContext
    ): Promise<string>
    range(
      stream: string,
      options?: { readonly start?: string; readonly end?: string; readonly count?: number },
      ctx?: IOperationContext
    ): Promise<readonly IRedisStreamEntry[]>
    createGroup(
      stream: string,
      group: string,
      options?: { readonly start?: string; readonly createStream?: boolean },
      ctx?: IOperationContext
    ): Promise<void>
    readGroup(
      stream: string,
      options: {
        readonly group: string
        readonly consumer: string
        readonly count?: number
        readonly blockMs?: number
      },
      ctx?: IOperationContext
    ): Promise<readonly IRedisStreamEntry[]>
    ack(
      stream: string,
      group: string,
      ids: readonly string[],
      ctx?: IOperationContext
    ): Promise<number>
    autoClaim(
      stream: string,
      options: {
        readonly group: string
        readonly consumer: string
        readonly minIdleMs: number
        readonly start?: string
        readonly count?: number
      },
      ctx?: IOperationContext
    ): Promise<{
      readonly next: string
      readonly entries: readonly IRedisStreamEntry[]
      readonly deletedIds: readonly string[]
    }>
  }
}
/** Exact native API output deliberately leaves transaction augmentation empty. */
export type IRedisStreamsOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: IRedisStreamsApi; readonly transaction: {} }
>
/** Fixed stream replies are decoded without guessing RESP coercions or swallowing damaged rows. */
function readStreamEntries(value: unknown): readonly IRedisStreamEntry[] {
  if (!Array.isArray(value)) throw redisError(RedisErrorCode.decodeFailed, value)
  return value.map((row) => {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      !Array.isArray(row[1]) ||
      row[1].length % 2 !== 0
    )
      throw redisError(RedisErrorCode.decodeFailed, row)
    const fields: Record<string, Uint8Array> = Object.create(null)
    for (let index = 0; index < row[1].length; index += 2) {
      const field = replyString(row[1][index])
      if (Object.hasOwn(fields, field)) throw redisError(RedisErrorCode.decodeFailed, row)
      Object.defineProperty(fields, field, {
        value: readFeatureBytes(row[1][index + 1]),
        enumerable: true
      })
    }
    return { id: replyString(row[0]), fields: fields }
  })
}
/** Streams retain native IDs, consumer-group ownership and the driver's real blocking lease. */
export function redisStreamsFeature() {
  return defineFeature<typeof redisBackendKind, {}, IRedisStreamsOutput>(redisBackendKind, () => ({
    capabilities: [] as const,
    chain: {},
    api: {
      transaction: {},
      store: {
        streams: {
          async add(
            stream: string,
            fields: Readonly<Record<string, Uint8Array>>,
            ctx?: IOperationContext
          ) {
            const name = featureName(stream)
            if (!fields || typeof fields !== 'object' || Array.isArray(fields))
              throw invalidArgument()
            const captured = Object.entries(fields).flatMap(([field, value]) => [
              featureName(field),
              featureBytes(value)
            ])
            if (captured.length === 0) throw invalidArgument()
            return readNativeFeaturePort(this.store).run(
              RedisOperation.streamsAdd,
              { name, fields: captured },
              ctx,
              true,
              async (input, connection, layout) =>
                replyString(
                  await connection.command([
                    RedisCommand.xadd,
                    layout.feature(RedisSuffix.streams, featureName(input.name)),
                    '*',
                    ...input.fields
                  ])
                ),
              false
            )
          },
          async range(
            stream: string,
            options?: { readonly start?: string; readonly end?: string; readonly count?: number },
            ctx?: IOperationContext
          ) {
            const input = {
              name: featureName(stream),
              start: featureName(options?.start ?? '-'),
              end: featureName(options?.end ?? '+'),
              count: featureInteger(options?.count ?? 100)
            }
            return readNativeFeaturePort(this.store).run(
              RedisOperation.streamsRange,
              input,
              ctx,
              false,
              async (actual, connection, layout) =>
                readStreamEntries(
                  await connection.command([
                    RedisCommand.xrange,
                    layout.feature(RedisSuffix.streams, featureName(actual.name)),
                    actual.start,
                    actual.end,
                    RedisCommand.count,
                    String(featureInteger(actual.count))
                  ])
                ),
              false
            )
          },
          async createGroup(
            stream: string,
            group: string,
            options?: { readonly start?: string; readonly createStream?: boolean },
            ctx?: IOperationContext
          ) {
            const input = {
              name: featureName(stream),
              group: featureName(group),
              start: featureName(options?.start ?? '0-0'),
              create: options?.createStream ?? true
            }
            if (typeof input.create !== 'boolean') throw invalidArgument()
            return readNativeFeaturePort(this.store).run(
              RedisOperation.streamsCreateGroup,
              input,
              ctx,
              true,
              async (actual, connection, layout) => {
                try {
                  replyString(
                    await connection.command([
                      RedisCommand.xgroup,
                      RedisCommand.create,
                      layout.feature(RedisSuffix.streams, featureName(actual.name)),
                      featureName(actual.group),
                      actual.start,
                      ...(actual.create ? [RedisCommand.mkstream] : [])
                    ])
                  )
                } catch (error) {
                  if (error instanceof Error && /^BUSYGROUP\b/.test(error.message)) return
                  throw error
                }
              },
              false
            )
          },
          async readGroup(
            stream: string,
            options: {
              readonly group: string
              readonly consumer: string
              readonly count?: number
              readonly blockMs?: number
            },
            ctx?: IOperationContext
          ) {
            const input = {
              name: featureName(stream),
              group: featureName(options.group),
              consumer: featureName(options.consumer),
              count: featureInteger(options.count ?? 100),
              block: options.blockMs
            }
            if (input.block !== undefined) featureInteger(input.block)
            return readNativeFeaturePort(this.store).run(
              RedisOperation.streamsReadGroup,
              input,
              ctx,
              false,
              async (actual, connection, layout, signal) => {
                const args = [
                  RedisCommand.xreadgroup,
                  RedisCommand.group,
                  featureName(actual.group),
                  featureName(actual.consumer),
                  RedisCommand.count,
                  String(featureInteger(actual.count)),
                  ...(actual.block === undefined
                    ? []
                    : [RedisCommand.block, String(featureInteger(actual.block))]),
                  RedisCommand.streams,
                  layout.feature(RedisSuffix.streams, featureName(actual.name)),
                  '>'
                ]
                const result =
                  actual.block === undefined
                    ? await connection.command(args)
                    : await blockingCommand(
                        readNativeFeaturePort(this.store),
                        actual.block,
                        (slice) =>
                          connection.command(
                            args.map((value, index) => (index === 7 ? String(slice) : value))
                          ),
                        signal
                      )
                if (result === null) return []
                return readStreamEntries(
                  readStreamRows(
                    result,
                    layout.feature(RedisSuffix.streams, featureName(actual.name))
                  )
                )
              },
              false
            )
          },
          async ack(
            stream: string,
            group: string,
            ids: readonly string[],
            ctx?: IOperationContext
          ) {
            if (!Array.isArray(ids)) throw invalidArgument()
            const input = {
              name: featureName(stream),
              group: featureName(group),
              ids: ids.map(featureName)
            }
            if (input.ids.length === 0) return 0
            return readNativeFeaturePort(this.store).run(
              RedisOperation.streamsAck,
              input,
              ctx,
              true,
              async (actual, connection, layout) =>
                replyInteger(
                  await connection.command([
                    RedisCommand.xack,
                    layout.feature(RedisSuffix.streams, featureName(actual.name)),
                    featureName(actual.group),
                    ...actual.ids.map(featureName)
                  ])
                ),
              false
            )
          },
          async autoClaim(
            stream: string,
            options: {
              readonly group: string
              readonly consumer: string
              readonly minIdleMs: number
              readonly start?: string
              readonly count?: number
            },
            ctx?: IOperationContext
          ) {
            const input = {
              name: featureName(stream),
              group: featureName(options.group),
              consumer: featureName(options.consumer),
              idle: featureInteger(options.minIdleMs, true),
              start: featureName(options.start ?? '0-0'),
              count: featureInteger(options.count ?? 100)
            }
            return readNativeFeaturePort(this.store).run(
              RedisOperation.streamsAutoClaim,
              input,
              ctx,
              true,
              async (actual, connection, layout) => {
                const result = await connection.command([
                  RedisCommand.xautoclaim,
                  layout.feature(RedisSuffix.streams, featureName(actual.name)),
                  featureName(actual.group),
                  featureName(actual.consumer),
                  String(featureInteger(actual.idle, true)),
                  actual.start,
                  RedisCommand.count,
                  String(featureInteger(actual.count))
                ])
                if (!Array.isArray(result) || result.length !== 3 || !Array.isArray(result[2]))
                  throw redisError(RedisErrorCode.decodeFailed, result)
                return {
                  next: replyString(result[0]),
                  entries: readStreamEntries(result[1]),
                  deletedIds: result[2].map(replyString)
                }
              },
              false
            )
          }
        }
      }
    }
  }))
}
