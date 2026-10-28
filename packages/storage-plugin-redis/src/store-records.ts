// Record pages, cursors, prefix removal and scoped mutations for the Redis store (see ./store.ts).
import {
  runTransactionOperation,
  assertTransactionOwner,
  createStorageIteratorLifetime,
  snapshotStorageTtlTarget,
  snapshotOperationContext,
  asyncDisposeKey,
  snapshotKeyRange
} from '@migaia/storage-host/sdk'
import { RedisCommand, RedisOperation } from './constants.ts'
import type {
  IStorageKey,
  IKeyRange,
  IOperationContext,
  IStorageIterator,
  IQueryMutator,
  IRecordQueryInput,
  IRecordQueryMutation,
  ITtlTarget
} from '@migaia/storage-contract'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import { RedisDraft } from './transaction.ts'
import { encodeRedisValue, decodeRedisValue, replyOptionalString, replyInteger } from './layout.ts'
import { invalidArgument, unsupported, redisError } from './errors.ts'
import { RedisText } from './constants.ts'
import {
  pruneScript,
  redisRead,
  redisOperate,
  redisObserve,
  redisTransactions
} from './store-state.ts'
import type { IRedisOrganizationContext, IRedisInternalScope } from './store-state.ts'
import { redisBounds } from './store-write.ts'

/** Ordered members are fetched in native key order and missing expired points never become rows. */
export async function redisPage(
  organization: IRedisOrganizationContext,
  channel: 'text' | 'record',
  send: (args: readonly string[]) => Promise<unknown>,
  lower: string,
  upper: string,
  size: number,
  draft?: RedisDraft
): Promise<{
  readonly rows: readonly [IStorageKey, unknown][]
  readonly last?: string
  readonly done: boolean
}> {
  if (draft) await draft.watchRange(channel)
  const nativeMembers = await send([
    RedisCommand.zrangebylex,
    organization.layout.index(channel),
    lower,
    upper,
    RedisCommand.limit,
    '0',
    String(size)
  ])
  if (!Array.isArray(nativeMembers) || nativeMembers.some((member) => typeof member !== 'string'))
    throw redisError(RedisErrorCode.decodeFailed, nativeMembers)
  // Hex preserves the original ordered writer's bytes and matches native ZSET member order.
  const candidates = draft
    ? mergeRedisMembers(
        nativeMembers as string[],
        draft.rangeMembers(channel, lower, upper, size + 1),
        size + 1
      )
    : (nativeMembers as string[])
  const members = candidates.slice(0, size),
    done = nativeMembers.length < size && candidates.length <= size
  if (members.length === 0) return { rows: [], done }
  const keys = (members as string[]).map((member) => organization.layout.decode(member)),
    rows: [IStorageKey, unknown][] = [],
    stale: { member: string; physical: string }[] = []
  if (draft) {
    const entries = await draft.loadMany(channel, keys)
    for (const entry of entries) {
      if (entry.value !== undefined) rows.push([entry.key, decodeRedisValue(channel, entry.value)])
      else {
        let prune = draft.prunes.get(channel)
        if (!prune) {
          prune = new Set()
          draft.prunes.set(channel, prune)
        }
        prune.add(entry.encoded)
      }
    }
  } else {
    const physical = keys.map((key) => organization.layout.value(channel, key)),
      values = await send([RedisCommand.mget, ...physical])
    if (!Array.isArray(values) || values.length !== keys.length)
      throw redisError(RedisErrorCode.decodeFailed, values)
    for (let index = 0; index < keys.length; index++) {
      const value = replyOptionalString(values[index])
      if (value === undefined) stale.push({ member: members[index], physical: physical[index]! })
      else rows.push([keys[index]!, decodeRedisValue(channel, value)])
    }
    if (stale.length)
      replyInteger(
        await send([
          RedisCommand.eval,
          pruneScript,
          String(stale.length + 1),
          organization.layout.index(channel),
          ...stale.map((item) => item.physical),
          ...stale.map((item) => item.member)
        ])
      )
  }
  return { rows, last: members.at(-1), done }
}
/** One cursor owns native position while the canonical lifetime owns admission and disposal. */
class RedisRecordCursor implements IStorageIterator<[IStorageKey, unknown]> {
  /** Fixed organization ports retain the original store and native lease owner. */
  readonly #organization: IRedisOrganizationContext
  /** Caller bounds survive deferred next calls and native command awaits. */
  readonly #range: IKeyRange | undefined
  /** Iteration options remain stable across later advances. */
  readonly #context: IOperationContext | undefined
  /** A transaction cursor borrows exactly its original WATCH draft. */
  readonly #draft: RedisDraft | undefined
  /** Native lower bound advances only after a completed page. */
  #lower: string
  /** Original upper bound remains fixed throughout iteration. */
  readonly #upper: string
  /** Caller page size controls the same native ZLEX/MGET request size. */
  readonly #size: number
  /** The accepted page remains until its last live row is returned. */
  #rows: readonly [IStorageKey, unknown][] = []
  /** Current position belongs to this cursor, never another query branch. */
  #position = 0
  /** Native exhaustion stops further pages but still drains accepted advances. */
  #done = false
  /** The shared owner preserves queued advances and both cached cleanup Promises. */
  readonly #lifetime: ReturnType<typeof createStorageIteratorLifetime<[IStorageKey, unknown]>>
  /** Capture options before any deferred native work begins. */
  constructor(
    organization: IRedisOrganizationContext,
    range: IKeyRange | undefined,
    context: IOperationContext | undefined,
    draft: RedisDraft | undefined
  ) {
    organization.environment.controller.assertLive()
    this.#organization = organization
    this.#range = snapshotKeyRange(range, RedisText.backend)
    this.#context = snapshotOperationContext(context)
    this.#draft = draft
    /** Native bounds derive from that same original caller snapshot. */
    const [lower, upper] = redisBounds(organization, this.#range)
    this.#lower = lower
    this.#upper = upper
    this.#size = this.#context?.pageSize ?? 128
    this.#lifetime = createStorageIteratorLifetime({
      close: async () => {
        this.#rows = []
        this.#done = true
      },
      report: organization.environment.report,
      onSettled: () => organization.environment.resources.delete(this)
    })
  }
  /** Observation borrows the initial range instead of copying it per advance. */
  capturedRange(): IKeyRange | undefined {
    return this.#range
  }
  /** Request one advance using the existing transaction or root native lease. */
  readonly next = () =>
    this.#lifetime.advance(() =>
      this.#draft
        ? this.#advance(this.#draft.send)
        : redisRead(
            this.#organization,
            RedisOperation.next,
            { range: this.#range },
            this.#context,
            (_input, send) => this.#advance(send)
          )
    )
  /** Return the original lifetime's cached return Promise directly. */
  readonly return = () => this.#lifetime.returned()
  /** Preserve the original explicit cleanup Promise. */
  readonly dispose = () => this.#lifetime.dispose()
  /** Keep report-only symbolic settlement on the original owner. */
  readonly [asyncDisposeKey] = () => this.#lifetime.symbolic();
  /** Iteration returns this same native cursor. */
  [Symbol.asyncIterator]() {
    return this
  }
  /** Consume native pages in order and skip original expiry-classified missing rows. */
  async #advance(
    send: (args: readonly string[]) => Promise<unknown>
  ): Promise<IteratorResult<[IStorageKey, unknown]>> {
    this.#organization.environment.controller.assertLive()
    if (this.#lifetime.isClosing()) return { done: true, value: undefined }
    while (this.#position === this.#rows.length && !this.#done) {
      /** Only completed native pages advance position and lexicographic bounds. */
      const result = await redisPage(
        this.#organization,
        'record',
        send,
        this.#lower,
        this.#upper,
        this.#size,
        this.#draft
      )
      this.#rows = result.rows
      this.#position = 0
      this.#done = result.done
      if (result.last !== undefined) this.#lower = '(' + result.last
    }
    return this.#position === this.#rows.length
      ? { done: true, value: undefined }
      : { done: false, value: this.#rows[this.#position++]! }
  }
}
/** Bind one cursor to the original transaction view or root resource set. */
export function redisIterator(
  organization: IRedisOrganizationContext,
  range?: IKeyRange,
  ctx?: IOperationContext,
  draft?: RedisDraft,
  scope?: IRedisInternalScope
): IStorageIterator<[IStorageKey, unknown]> {
  /** One cursor owns the exact captured range used by native work and observation. */
  const resource = new RedisRecordCursor(organization, range, ctx, draft)
  if (scope)
    return organization.transactionOwner.registerIterator(scope, {
      next: (current) =>
        redisOperate(
          organization,
          RedisOperation.next,
          { range: resource.capturedRange() },
          draft!.context,
          current,
          () => resource.next()
        ),
      close: resource.dispose
    })
  organization.environment.resources.add(resource)
  return resource
}
/** Prefix mutations enumerate only the original native ordered interval and accept actual live rows. */
export async function redisRemovePrefix(
  organization: IRedisOrganizationContext,
  channel: 'text' | 'record',
  prefixKey: IStorageKey | undefined,
  draft: RedisDraft
): Promise<number> {
  const [initial, upper] = redisBounds(organization, undefined, prefixKey)
  let lower = initial,
    count = 0
  for (;;) {
    const result = await redisPage(organization, channel, draft.send, lower, upper, 128, draft)
    for (const [key] of result.rows) if (await draft.remove(channel, key)) count++
    if (result.done || result.last === undefined) return count
    lower = '(' + result.last
  }
}
/**
 * Byte clearing uses native SCAN only for its own org envelope; other namespaces are never decoded
 * or removed.
 */
export async function redisClearBytes(
  organization: IRedisOrganizationContext,
  draft: RedisDraft
): Promise<void> {
  const physicalPrefix = organization.layout.tag + ':b:',
    [lower, upper] = redisBounds(organization)
  let cursor = '0'
  do {
    const result = await draft.send([
      RedisCommand.scan,
      cursor,
      RedisCommand.match,
      physicalPrefix + lower.slice(1) + '*',
      RedisCommand.count,
      '128'
    ])
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      typeof result[0] !== 'string' ||
      !Array.isArray(result[1])
    )
      throw redisError(RedisErrorCode.decodeFailed, result)
    cursor = result[0]
    for (const name of result[1]) {
      if (typeof name !== 'string' || !name.startsWith(physicalPrefix))
        throw redisError(RedisErrorCode.decodeFailed)
      const encoded = name.slice(physicalPrefix.length)
      if (encoded < lower.slice(1) || encoded >= upper.slice(1)) continue
      const key = organization.layout.decode(encoded)
      if (typeof key !== 'string') throw redisError(RedisErrorCode.decodeFailed)
      await draft.remove('bytes', key)
    }
  } while (cursor !== '0')
}
/** Original transaction admission precedes capture, pipeline and all native draft access. */
export function redisScoped<I, R>(
  organization: IRedisOrganizationContext,
  scope: IRedisInternalScope,
  draft: RedisDraft,
  name: string,
  capture: () => I,
  run: (input: I, current: IRedisInternalScope) => Promise<R>,
  count?: number | ((input: I) => number)
): Promise<R> {
  return runTransactionOperation(scope, (current) => {
    assertTransactionOwner(organization.store, current)
    const input = capture()
    const batchCount = typeof count === 'function' ? count(input) : count
    if (batchCount === 0) return run(input, current)
    return redisOperate(
      organization,
      name,
      input,
      draft.context,
      current,
      (actual) => {
        redisObserve(
          organization.environment,
          redisTransactions(organization).forTransaction(current),
          'beforeTxOperation',
          name
        )
        return run(actual, current).then((value) => {
          redisObserve(
            organization.environment,
            redisTransactions(organization).forTransaction(current),
            'afterTxOperation',
            name
          )
          return value
        })
      },
      batchCount
    )
  })
}
/** TTL target capture admits only channels actually implemented by this backend. */
export function redisTtlTarget(
  organization: IRedisOrganizationContext,
  target: ITtlTarget
): ITtlTarget {
  const captured = snapshotStorageTtlTarget(target, RedisText.backend)
  if (captured.channel === 'vector' && !organization.environment.vectorFactory) unsupported()
  return captured
}
/** Query writes reuse the original query selection core and this same native draft. */
export function redisMutate(
  organization: IRedisOrganizationContext,
  draft: RedisDraft,
  request: IRecordQueryMutation,
  run: Parameters<IQueryMutator<IRecordQueryInput, unknown, IRecordQueryMutation>>[1],
  scope?: IRedisInternalScope
): Promise<number> {
  if (request.operation !== 'delete' && request.operation !== 'update') throw invalidArgument()
  const patch =
    request.operation === 'update'
      ? decodeRedisValue('record', encodeRedisValue('record', request.patch))
      : undefined
  if (
    request.operation === 'update' &&
    (!patch || typeof patch !== 'object' || Array.isArray(patch))
  )
    throw invalidArgument()
  return run({
    execute: () => redisIterator(organization, undefined, undefined, draft, scope),
    accept: async (key) => {
      const current = await draft.read('record', key)
      if (current === undefined) return false
      if (request.operation === 'delete') return draft.remove('record', key)
      if (!current || typeof current !== 'object') throw invalidArgument()
      for (const field of Object.keys(patch!)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, field)
        Object.defineProperty(
          current,
          field,
          descriptor === undefined
            ? {
                value: Reflect.get(patch!, field),
                enumerable: true,
                configurable: true,
                writable: true
              }
            : { ...descriptor, value: Reflect.get(patch!, field) }
        )
      }
      await draft.write('record', key, encodeRedisValue('record', current), 'replace')
      return true
    }
  })
}

/**
 * Merge two member lists that are each in native order into one ordered, duplicate-free list of at
 * most `limit` members. Linear in the members read.
 */
function mergeRedisMembers(
  native: readonly string[],
  drafted: readonly string[],
  limit: number
): string[] {
  const merged: string[] = []
  let left = 0,
    right = 0
  while (merged.length < limit && (left < native.length || right < drafted.length)) {
    const a = native[left],
      b = drafted[right]
    if (b === undefined || (a !== undefined && a < b)) {
      merged.push(a!)
      left++
    } else if (a === undefined || b < a) {
      merged.push(b)
      right++
    } else {
      merged.push(a)
      left++
      right++
    }
  }
  return merged
}
