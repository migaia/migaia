import { RedisOperation } from '../constants.js'
import { RedisCommand, RedisText } from '../constants.js'
import type { IRedisConnection } from '../driver.js'
import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import {
  asyncDisposeKey,
  throwIfAborted,
  createStorageIteratorLifetime
} from '@migaia/storage-host/sdk'
import {
  durableChangeFeed,
  implement,
  StorageContractError,
  StorageContractErrorCode,
  type IDurableChangeFeedApi,
  type IDurableStorageChange,
  type ICapabilityImpl,
  type IStorageResource
} from '@migaia/storage-contract'
import { redisBackendKind } from '../plugin.js'
import { readNativeFeaturePort, type IRedisNativeFeaturePort } from '../native-feature.js'
import { featureInteger, readStreamRows } from '../feature-input.js'
import { decodeRedisChange } from '../changes.js'
import { replyString, RedisSuffix } from '../layout.js'
import { redisError, invalidArgument, normalizeRedisTransactionFailure } from '../errors.js'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
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
/** Root projections read the shared Stream; org projections read only their own org Stream. */
function durableStream(
  port: IRedisNativeFeaturePort,
  layout: IRedisNativeFeaturePort['layout']
): string {
  return port.allOrganizations ? layout.durableChanges : layout.orgDurableChanges
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

/** One durable tail owns only its last successfully delivered native cursor and original lifetime. */
class RedisDurableTail implements IStorageResource {
  /** Native driver and report ports retain the selected organization's original owner. */
  readonly #port: IRedisNativeFeaturePort
  /** The one durable Stream this tail reads: shared for root projections, own for org projections. */
  readonly #stream: string
  /** Canonical operation cancellation remains cooperative with the original blocking read. */
  readonly #signal: AbortSignal | undefined
  /** Native cursor advances only after the caller's original callback succeeds. */
  #current: string
  /** Captured listener stays fixed across native blocking reads. */
  readonly #onChange: Parameters<IDurableChangeFeedApi['tailChanges']>[0]['onChange']
  /** Optional failure observation retains the original report-only contract. */
  readonly #onError: Parameters<IDurableChangeFeedApi['tailChanges']>[0]['onError']
  /** Shared lifetime owns the one accepted connection and both cached cleanup Promises. */
  readonly #lifetime: ReturnType<typeof createStorageIteratorLifetime<never>>
  /** Start exactly one native connection after resolving the initial high-water cursor. */
  constructor(
    port: IRedisNativeFeaturePort,
    layout: IRedisNativeFeaturePort['layout'],
    signal: AbortSignal | undefined,
    current: string,
    onChange: Parameters<IDurableChangeFeedApi['tailChanges']>[0]['onChange'],
    onError: Parameters<IDurableChangeFeedApi['tailChanges']>[0]['onError']
  ) {
    this.#port = port
    this.#stream = durableStream(port, layout)
    this.#signal = signal
    this.#current = current
    this.#onChange = onChange
    this.#onError = onError
    this.#lifetime = createStorageIteratorLifetime<never>({
      close: async () => {},
      report: port.report
    })
    /** The original lifetime drains this exact native loop before cleanup settles. */
    const pending = this.#lifetime.advance(() => this.#run())
    void pending.then(undefined, (error) => this.#failed(error))
  }
  /** Return the original cached explicit cleanup Promise. */
  readonly dispose = () => this.#lifetime.dispose()
  /** Return the original cached report-only symbolic Promise. */
  readonly [asyncDisposeKey] = () => this.#lifetime.symbolic()
  /** Borrow exactly one real dedicated connection for the complete blocking tail. */
  async #run(): Promise<IteratorResult<never>> {
    await this.#port.driver.withConnection((connection) => this.#consume(connection))
    return { done: true, value: undefined }
  }
  /** Retention rechecks and callback acknowledgement preserve the original read/advance order. */
  async #consume(connection: IRedisConnection): Promise<void> {
    while (!this.#lifetime.isClosing()) {
      throwIfAborted(this.#signal)
      await assertRetained(connection, this.#stream, this.#current)
      /** A real native block remains bounded so original cancellation and close can drain. */
      const reply = await connection.command([
        RedisCommand.xread,
        RedisCommand.count,
        '100',
        RedisCommand.block,
        '1000',
        RedisCommand.streams,
        this.#stream,
        this.#current
      ])
      if (reply === null) continue
      /** Only rows for this exact Stream enter native summary decoding. */
      const rows = readStreamRows(reply, this.#stream)
      await assertRetained(connection, this.#stream, this.#current)
      for (const change of changes(rows)) {
        if (this.#lifetime.isClosing()) return
        throwIfAborted(this.#signal)
        /** Listener callbacks keep the original bare-call receiver, unlike native port methods. */
        const onChange = this.#onChange
        await onChange(change)
        this.#current = change.cursor
      }
    }
  }
  /** Report the original failure and listener failure once before closing the same tail. */
  #failed(error: unknown): void {
    /** Callback failure normalization keeps the original business/native cause reachable. */
    const failure = normalizeRedisTransactionFailure(error)
    this.#port.report(failure)
    /** This is the original caller callback, so no tail object becomes its receiver. */
    const onError = this.#onError
    if (onError) {
      try {
        const result: unknown = onError(failure)
        void Promise.resolve(result).catch(this.#port.report)
      } catch (secondary) {
        this.#port.report(secondary)
      }
    }
    void this[asyncDisposeKey]()
  }
}

/** One provider owns the fixed resolver for its original org native execution ports. */
class RedisDurableFeed implements IDurableChangeFeedApi {
  /** Resolve current original ports without retaining another root provider or native connection. */
  readonly #resolve: () => IRedisNativeFeaturePort
  /** Capture the provider resolver without I/O. */
  constructor(resolve: () => IRedisNativeFeaturePort) {
    this.#resolve = resolve
  }
  /** Execute readChanges through original native ports and cursor semantics. */
  readonly readChanges: IDurableChangeFeedApi['readChanges'] = async (options, ctx) => {
    const after = options?.after,
      limit = featureInteger(options?.limit ?? 100)
    if (after !== undefined) cursor(after)
    const port = this.#resolve()
    return port.run(
      RedisOperation.changesRead,
      { after, limit },
      ctx,
      false,
      async (input, connection, layout) => {
        if (input.after !== undefined) cursor(input.after)
        featureInteger(input.limit)
        const stream = durableStream(port, layout)
        if (input.after !== undefined) await assertRetained(connection, stream, input.after)
        /** The selected Stream holds only visible changes, so one bounded range read fills the page. */
        const page = changes(
          await connection.command([
            RedisCommand.xrange,
            stream,
            '(' + (input.after ?? '0-0'),
            '+',
            RedisCommand.count,
            String(input.limit)
          ])
        )
        return { changes: page, cursor: page.at(-1)?.cursor ?? input.after ?? '0-0' }
      }
    )
  }
  /** Execute tailChanges through original native ports and cursor semantics. */
  readonly tailChanges: IDurableChangeFeedApi['tailChanges'] = async (options, ctx) => {
    const from = options.from,
      onChange = options.onChange,
      onError = options.onError
    if (from !== 'now') cursor(from)
    if (typeof onChange !== 'function' || (onError !== undefined && typeof onError !== 'function'))
      throw invalidArgument()
    const port = this.#resolve()
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
              durableStream(port, layout),
              '+',
              '-',
              RedisCommand.count,
              '1'
            ])
          )
          current = last[0]?.cursor ?? '0-0'
        } else cursor(current)
        return new RedisDurableTail(port, layout, signal, current, onChange, onError)
      }
    )
  }
}
/** Publish one selected org durable feed without another cursor or acknowledgement ledger. */
function createRedisDurableApi(resolve: () => IRedisNativeFeaturePort): IDurableChangeFeedApi {
  return new RedisDurableFeed(resolve)
}
