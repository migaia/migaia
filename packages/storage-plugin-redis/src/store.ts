import { RedisCommand, RedisOperation } from './constants.js'
import {
  StorageContractErrorCode,
  kv,
  records,
  ttl,
  counter,
  durableChangeFeed,
  type IDurableChangeFeedApi,
  provideCapabilities,
  implement,
  createTransactionOwner,
  runTransactionOperation,
  assertTransactionOwner,
  assertTransactionCallback,
  useTransactionCapability,
  createTransactionBuilder,
  runWithConcurrency,
  createRecordQuery,
  createStorageIteratorLifetime,
  snapshotStorageKey,
  assertStringStorageKey,
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture,
  snapshotStorageTtlTarget,
  assertStorageTtlDuration,
  snapshotStorageCounterIncrement,
  snapshotOperationContext,
  readTransactionConflictPolicy,
  snapshotStorageOrgKeyPrefix,
  resolveConcurrencyPolicy,
  snapshotConcurrencyLockKeys,
  type IStorageKey,
  type IKeyRange,
  type IOperationContext,
  type IWriteOptions,
  type ITransactionOptions,
  type IStorageIterator,
  type IStorageResource,
  type ICapabilityInstallPort,
  type IKeyValueApi,
  type IRecordsApi,
  type ITransactionRecordsApi,
  type ITtlApi,
  type ITransactionTtlApi,
  type ICounterApi,
  type ITransactionCounterApi,
  type IConcurrencyAttemptContext,
  type IConcurrencyAttempt,
  type ILockKey,
  type IQueryMutator,
  type IRecordQueryInput,
  type IRecordQueryMutation,
  type IConcurrencyPolicy,
  type ITtlTarget,
  type ILockHolding
} from '@migaia/storage-contract'
import { isUint8Array } from '@migaia/utils/bytes'
import { sleep } from '@migaia/utils/promise'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import {
  StorageError,
  StorageErrorCode,
  type IStoragePluginCore,
  type IStorageOrgBinding
} from '@migaia/storage-host'
import {
  asyncDisposeKey,
  createStorageOperationReporter,
  reportCleanupError,
  withAbort,
  mergeSignals,
  subscribeToAbort,
  throwIfAborted,
  snapshotKeyRange,
  observeStorageBatch,
  createBackendChangeIterator,
  normalizeError,
  type IBackendChangeController
} from '@migaia/storage-host/authoring/backend'
import { RedisDraft, validateRedisExec } from './transaction.js'
import { createRedisLocks, RedisLockConflict } from './locks.js'
import {
  createRedisLayout,
  redisHex,
  encodeRedisValue,
  decodeRedisValue,
  replyOptionalString,
  replyInteger,
  replyRevision,
  RedisSuffix,
  type IRedisChannel
} from './layout.js'
import {
  invalidArgument,
  unsupported,
  normalizeRedisError,
  normalizeRedisTransactionFailure,
  redisError
} from './errors.js'
import { RedisText } from './constants.js'
import { RedisErrorCode, ERROR_SOURCE } from './error-code.js'
import { encodeRedisChange, decodeRedisChange } from './changes.js'
import {
  redisCapabilities,
  type IRedisOptions,
  type IRedisStore,
  type IRedisNativeStore,
  type IRedisTransactionScope
} from './types.js'
import type { IRedisConnection, IRedisDriver } from './driver.js'
import type {} from './hooks.js'
import { nativeFeaturePort, type IRedisNativeFeaturePort } from './native-feature.js'

/**
 * This maintenance script rechecks actual existence atomically before deleting stale ordered
 * members.
 */
const pruneScript =
  "local n=0; for i=2,#KEYS do if redis.call('EXISTS',KEYS[i])==0 then n=n+redis.call('ZREM',KEYS[1],ARGV[i-1]) end end; return n"
/** Original transaction methods expose finite standard token APIs without another capability table. */
const ttlApi = Symbol('redis-transaction-ttl'),
  counterApi = Symbol('redis-transaction-counter'),
  recordsApi = Symbol('redis-transaction-records')
/** Scope-private methods belong to the same original transaction view factory. */
type IRedisInternalScope = IRedisTransactionScope & {
  readonly [ttlApi]: ITransactionTtlApi
  readonly [counterApi]: ITransactionCounterApi
  readonly [recordsApi]: ITransactionRecordsApi<unknown>
}
/** Captured write inputs hold detached public data, never caller-owned accessors or mutable bytes. */
type IRedisValueInput = {
  readonly key: IStorageKey
  readonly wire: string
  readonly ttlMs?: number
}
/** Public pipeline inputs keep values paired with their canonical logical keys. */
type IRedisTextInput = {
  readonly key: IStorageKey
  readonly value: string
  readonly ttlMs?: number
}
/**
 * One installation owns controller and organization projections; the native driver remains
 * borrowed.
 */
export type IRedisConstruction = {
  readonly store: IRedisStore
  readonly controller: IBackendChangeController
  readonly installer: ICapabilityInstallPort
  readonly orgBinding: IStorageOrgBinding
  detect(): Promise<void>
}

/** Construct pure store projections first; original host detection owns all native setup I/O. */
export function createRedisStore(
  options: IRedisOptions,
  core: IStoragePluginCore
): IRedisConstruction {
  const { driver, prefix = 'migaia', concurrency, owner, maxLockMs = 30000 } = options,
    label = owner?.label,
    report = createStorageOperationReporter(),
    resources = new Set<IStorageResource>(),
    projections = new Map<string | symbol, ReturnType<typeof createOrg>>()
  if (
    !driver ||
    typeof driver.command !== 'function' ||
    typeof driver.withConnection !== 'function' ||
    typeof driver.subscribe !== 'function' ||
    typeof prefix !== 'string' ||
    (label !== undefined && typeof label !== 'string') ||
    !Number.isSafeInteger(maxLockMs) ||
    maxLockMs < 1
  )
    throw invalidArgument()
  /** Root alone observes every org; explicit default-org views retain a separate original provider. */
  const rootProjection = Symbol('redis-root-projection')
  let subscription: IStorageResource | undefined, poison: Error | undefined
  /**
   * The selected durable Feature configures only this original commit path before detection
   * completes.
   */
  let durableMaxLen: number | undefined
  /** The selected module supplies this finite org API factory; provider ownership stays original. */
  let durableFactory: ((store: IRedisStore) => IDurableChangeFeedApi) | undefined
  const controller = core.createChangeController({
    backend: RedisText.backend,
    platform: driver,
    options,
    origin: crypto.randomUUID(),
    finalize: async () => {
      const failures: unknown[] = []
      for (const resource of resources) {
        try {
          await resource.dispose()
        } catch (error) {
          failures.push(error)
        }
      }
      resources.clear()
      if (subscription) {
        try {
          await subscription.dispose()
        } catch (error) {
          failures.push(error)
        }
      }
      for (const projection of projections.values()) {
        try {
          projection.releaseFeatures()
        } catch (error) {
          failures.push(error)
        }
      }
      projections.clear()
      if (failures.length)
        throw redisError(
          RedisErrorCode.failed,
          new AggregateError(failures, RedisText.failed, { cause: failures[0] })
        )
    }
  })
  /** Each org receives a native provider projection without DDL, registry I/O or another lifetime. */
  function forOrg(orgId: string, allOrganizations = false) {
    controller.assertLive()
    const identity = allOrganizations ? rootProjection : orgId
    let current = projections.get(identity)
    if (!current) {
      current = createOrg(orgId, allOrganizations)
      projections.set(identity, current)
    }
    current.configureFeatures()
    return current
  }
  /** Observer promises are observed but cannot delay, replace or abort the original operation. */
  function observe(
    observer: object | undefined,
    name: string,
    ...values: readonly unknown[]
  ): void {
    if (!observer) return
    try {
      const callback: unknown = Reflect.get(observer, name)
      if (typeof callback !== 'function') return
      const result: unknown = Reflect.apply(callback, observer, values)
      observeThenableRejection(result, inspectThenable(result), (error) =>
        reportCleanupError(report, error)
      )
    } catch (error) {
      reportCleanupError(report, error)
    }
  }
  /**
   * Unknown intervention failures retain the original host error boundary; native failures are
   * already coded.
   */
  const extensionFailure = (error: unknown, operation: string): Error =>
    normalizeError(
      error,
      (cause) =>
        new StorageError(StorageErrorCode.extensionFailed, {
          backend: RedisText.backend,
          operation,
          cause
        }),
      (value): value is Error =>
        value instanceof Error && Reflect.get(value, 'source') === ERROR_SOURCE
    )
  /** Selected native writes are sealed after an unknown outcome without discarding read access. */
  const assertWrite = (): void => {
    controller.assertLive()
    if (poison) throw poison
  }
  /** Fixed command observation never includes arguments or application data. */
  const observeNative = async <R>(
    name: string,
    orgId: string,
    run: () => Promise<R>
  ): Promise<R> => {
    const started = core.featureExpose.getScheduler().now()
    try {
      return await run()
    } finally {
      core.emit(RedisOperation.onRedisCommand, () => ({
        backendId: core.getBackendId(),
        backend: RedisText.backend,
        orgId,
        command: name,
        elapsedMs: core.featureExpose.getScheduler().now() - started
      }))
    }
  }
  /** Standard drafts and selected Features share the same original native observation path. */
  const command = (
    connection: IRedisConnection,
    args: readonly string[],
    orgId: string
  ): Promise<unknown> => observeNative(args[0]!, orgId, () => connection.command(args))
  /** EXEC observation measures the full actual native batch, without fabricating per-item timings. */
  const exec = (
    connection: IRedisConnection,
    commands: Parameters<IRedisConnection['exec']>[0],
    orgId: string
  ) => observeNative(RedisCommand.exec, orgId, () => connection.exec(commands))
  /** Independent organization providers share only native Redis state and the original controller. */
  function createOrg(orgId: string, allOrganizations: boolean) {
    const ports = core.getOrgContext(orgId),
      layout = createRedisLayout(prefix, orgId)
    let store!: IRedisStore,
      installer!: ICapabilityInstallPort,
      transactionOwner!: ReturnType<typeof createTransactionOwner<unknown, IRedisInternalScope>>,
      symbolic: Promise<void> | undefined
    /** All observations resolve through this exact original store and org binding. */
    const operations = () => ports.stageBindings.operationStages(store),
      transactions = () => ports.stageBindings.transactionStages(store),
      concurrencyStages = () => ports.stageBindings.concurrencyStages(store)
    /** One public terminal owns one pipeline and one storage-operation observation. */
    const operate = <I, R>(
      name: string,
      input: I,
      ctx: IOperationContext | undefined,
      scope: object | undefined,
      run: (input: I) => Promise<R>,
      count?: number
    ): Promise<R> => {
      const execute = () =>
        ports.execution.run<I, R>({ operation: name, input, ctx, scope }, (actual) =>
          observeStorageBatch(
            scope ? operations().forTransaction(scope) : operations(),
            core.featureExpose.getScheduler(),
            name,
            count,
            () => run(actual)
          )
        )
      return execute().catch((error) => {
        throw extensionFailure(error, name)
      })
    }
    /** A readonly endpoint drains the genuine connection before its original controller lease ends. */
    const read = <I, R>(
      name: string,
      input: I,
      ctx: IOperationContext | undefined,
      run: (input: I, send: (args: readonly string[]) => Promise<unknown>) => Promise<R>,
      count?: number
    ): Promise<R> => {
      controller.assertLive()
      const finish = controller.beginMutation()
      return withAbort(ctx, async (signal, captured) =>
        operate(
          name,
          input,
          captured,
          undefined,
          async (actual) => {
            controller.assertLive()
            throwIfAborted(signal)
            return driver.withConnection((connection) =>
              run(actual, (args) => {
                throwIfAborted(signal)
                return command(connection, args, orgId)
              })
            )
          },
          count
        )
      ).finally(finish)
    }
    /**
     * The complete original native attempt settles before strategy callbacks or another lease can
     * begin.
     */
    const nativeAttempt = async <R>(
      context: IConcurrencyAttemptContext,
      run: (draft: RedisDraft) => Promise<R>
    ): Promise<IConcurrencyAttempt<R>> => {
      assertWrite()
      if (context.lock?.some((key) => key.channel === 'rdf' || key.channel === 'vector'))
        unsupported()
      return driver.withConnection(async (connection) => {
        const send = (args: readonly string[]) => command(connection, args, orgId),
          locks = createRedisLocks({
            layout,
            context,
            owner: controller.origin,
            label,
            maxLockMs,
            send
          }),
          draft = new RedisDraft(connection, layout, context, send, locks.guard)
        let outcome: IConcurrencyAttempt<R> | undefined,
          primary: unknown,
          failed = false
        try {
          await locks.acquire()
          observe(concurrencyStages(), 'onLockAcquired', context.attempt, context.lock?.length ?? 0)
          await draft.start()
          const value = await run(draft)
          throwIfAborted(context.signal)
          for (;;) {
            await locks.verify()
            // EXEC null clears every WATCH, including the guards from the original draft writes.
            for (const entry of draft.entries.values())
              if (entry.changed) await locks.guard(entry.channel, entry.key)
            throwIfAborted(context.signal)
            const commands = draft.commands(),
              changed = [...draft.entries.values()].filter((entry) => entry.changed)
            let change: ReturnType<typeof encodeRedisChange> | undefined
            if (commands.length === 0) {
              outcome = { status: 'committed', value }
              break
            }
            if (changed.length !== 0) {
              const sequence =
                replyRevision(
                  await send([RedisCommand.hget, layout.revisions, RedisSuffix.sequence])
                ) + 1
              if (!Number.isSafeInteger(sequence)) throw redisError(RedisErrorCode.decodeFailed)
              change = encodeRedisChange(layout, controller.origin, sequence, changed)
              commands.push(
                [RedisCommand.hset, layout.revisions, RedisSuffix.sequence, String(sequence)],
                [RedisCommand.publish, layout.changes, change.wire]
              )
              if (durableMaxLen !== undefined)
                commands.push([
                  RedisCommand.xadd,
                  layout.durableChanges,
                  RedisCommand.maxlen,
                  '~',
                  String(durableMaxLen),
                  '*',
                  RedisSuffix.changeField,
                  change.wire
                ])
            }
            throwIfAborted(context.signal)
            let replies: Awaited<ReturnType<IRedisConnection['exec']>>
            try {
              replies = await exec(connection, commands, orgId)
            } catch (error) {
              poison = normalizeRedisError(error)
              throw poison
            }
            if (replies !== null) {
              try {
                validateRedisExec(replies, commands.length)
              } catch (error) {
                poison = normalizeRedisError(error)
                throw poison
              }
              if (change) controller.publishExternal(change.change)
              outcome = { status: 'committed', value }
              break
            }
            core.emit(RedisOperation.onWatchConflict, () => ({
              backendId: core.getBackendId(),
              backend: RedisText.backend,
              orgId,
              keyCount: draft.entries.size + draft.ranges.size
            }))
            await locks.verify()
            if (!(await draft.unchanged())) {
              const keys =
                context.lock ??
                [...draft.entries.values()].flatMap((entry) =>
                  entry.channel === 'bytes' && typeof entry.key !== 'string'
                    ? []
                    : snapshotConcurrencyLockKeys(
                        [{ channel: entry.channel, key: entry.key }],
                        RedisText.backend
                      ).keys
                )
              outcome = { status: 'conflict', phase: 'commit', keys, holder: undefined }
              break
            }
            observe(concurrencyStages(), 'onRetry', context.attempt, 1, 'physical')
            await context.waitPhysical(sleep(1, { signal: context.signal }))
          }
        } catch (error) {
          if (error instanceof RedisLockConflict)
            outcome = {
              status: 'conflict',
              phase: 'acquire',
              keys: error.keys,
              holder: error.holder
            }
          else {
            failed = true
            primary = error
          }
        }
        const cleanup: unknown[] = []
        try {
          await send([RedisCommand.unwatch])
        } catch (error) {
          cleanup.push(error)
        }
        try {
          await locks.release()
          observe(concurrencyStages(), 'onLockReleased', context.attempt, context.lock?.length ?? 0)
        } catch (error) {
          cleanup.push(error)
        }
        if (cleanup.length !== 0)
          throw redisError(
            RedisErrorCode.failed,
            new AggregateError(failed ? [primary, ...cleanup] : cleanup, RedisText.failed, {
              cause: failed ? primary : cleanup[0]
            })
          )
        if (failed) throw primary
        return outcome!
      })
    }
    /** One fixed-input pipeline feeds the original concurrency loop and its actual Redis draft. */
    const write = <I, P, R>(
      name: string,
      input: I,
      ctx: IOperationContext | undefined,
      capture: (input: I) => P,
      keys: (input: P) => readonly ILockKey[],
      run: (draft: RedisDraft, input: P, context: IConcurrencyAttemptContext) => Promise<R>,
      count?: number,
      policy?: IConcurrencyPolicy
    ): Promise<R> => {
      assertWrite()
      const finish = controller.beginMutation()
      let actual!: P
      return runWithConcurrency<R>(
        {
          store,
          options: ctx ?? {},
          policy,
          execute: (context, proceed) =>
            operate<I, Awaited<R>>(
              name,
              input,
              context,
              undefined,
              async (prepared): Promise<Awaited<R>> => {
                actual = capture(prepared)
                return (await proceed()) as Awaited<R>
              },
              count
            ),
          lock: () => keys(actual)
        },
        { attempt: (context) => nativeAttempt(context, (draft) => run(draft, actual, context)) }
      ).finally(finish)
    }
    /**
     * Every caller key is detached by the original domain owner before any native connection is
     * borrowed.
     */
    const key = (input: IStorageKey): IStorageKey => snapshotStorageKey(input, RedisText.backend),
      textKey = (input: string): string => {
        assertStringStorageKey(input, RedisText.backend)
        return input
      },
      channelLocks = (channel: IRedisChannel, input: IStorageKey): readonly ILockKey[] =>
        snapshotConcurrencyLockKeys([{ channel, key: input }], RedisText.backend).keys,
      writeLocks = (input: IStorageKey): readonly ILockKey[] =>
        snapshotConcurrencyLockKeys(
          [
            { channel: 'text', key: input },
            { channel: 'record', key: input },
            ...(typeof input === 'string' ? [{ channel: 'bytes', key: input }] : [])
          ],
          RedisText.backend
        ).keys
    /**
     * Public empty batches validate pure options but allocate no pipeline, timer, hook or native
     * attempt.
     */
    const empty = <R>(ctx: IOperationContext | undefined, value: R): Promise<R> => {
      controller.assertLive()
      snapshotOperationContext(ctx)
      const policy = (ctx as IWriteOptions | undefined)?.concurrency
      if (policy !== undefined) resolveConcurrencyPolicy(store, policy)
      return Promise.resolve(value)
    }
    /**
     * Complete batch value capture retains one array length and each caller field value exactly
     * once.
     */
    const captureEntries = (
      entries: readonly {
        readonly key: IStorageKey
        readonly value: string
        readonly ttlMs?: number
      }[]
    ): readonly IRedisTextInput[] => {
      if (!Array.isArray(entries)) throw invalidArgument()
      const count = entries.length,
        capture = createStorageBatchKeyCapture(RedisText.backend),
        captured: IRedisTextInput[] = []
      for (let index = 0; index < count; index++) {
        const entry = entries[index]
        if (!entry || typeof entry !== 'object') throw invalidArgument()
        const capturedKey = capture(entry.key),
          value = entry.value,
          ttlMs = entry.ttlMs
        if (capturedKey.firstIndex !== index) throw invalidArgument()
        if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, RedisText.backend)
        if (typeof value !== 'string') throw invalidArgument()
        captured.push({ key: capturedKey.key, value, ...(ttlMs === undefined ? {} : { ttlMs }) })
      }
      return Object.freeze(captured)
    }
    /**
     * Stage replacement is captured completely and encoded before its first native read or lock
     * check.
     */
    const prepareEntries = (entries: readonly IRedisTextInput[]): readonly IRedisValueInput[] =>
      captureEntries(entries).map((entry) => ({
        key: entry.key,
        wire: encodeRedisValue('text', entry.value),
        ...(entry.ttlMs === undefined ? {} : { ttlMs: entry.ttlMs })
      }))
    /**
     * Pure capture detaches caller-owned records and bytes before any asynchronous pipeline can
     * wait.
     */
    const capturePoint = (
      channel: IRedisChannel,
      input: IStorageKey,
      value: unknown
    ): { readonly key: IStorageKey; readonly value: unknown } => {
      const capturedKey = key(input)
      if (channel === 'bytes') {
        if (!isUint8Array(value)) throw invalidArgument()
        return { key: capturedKey, value: new Uint8Array(value) }
      }
      if (channel === 'text') {
        if (typeof value !== 'string') throw invalidArgument()
        return { key: capturedKey, value }
      }
      return {
        key: capturedKey,
        value: decodeRedisValue('record', encodeRedisValue('record', value))
      }
    }
    /** Native facts are derived from the actual stage input as one inseparable key/value pair. */
    const preparePoint = (
      channel: IRedisChannel,
      input: { readonly key: IStorageKey; readonly value: unknown }
    ): { readonly key: IStorageKey; readonly wire: string } => {
      const capturedKey = key(input.key)
      if (channel === 'bytes' && !isUint8Array(input.value)) throw invalidArgument()
      return { key: capturedKey, wire: encodeRedisValue(channel, input.value) }
    }
    /** The original org key range maps directly to native lex bounds without splicing encoded tags. */
    const bounds = (range?: IKeyRange, prefixKey?: IStorageKey): readonly [string, string] => {
      const all = snapshotStorageOrgKeyPrefix(orgId, prefixKey, RedisText.backend)
      return [
        range?.lower === undefined
          ? '[' + redisHex(all.lower)
          : (range.lowerOpen ? '(' : '[') + layout.encode(range.lower),
        range?.upper === undefined
          ? '(' + redisHex(all.upper)
          : (range.upperOpen ? '(' : '[') + layout.encode(range.upper)
      ]
    }
    /** Ordered members are fetched in native key order and missing expired points never become rows. */
    const page = async (
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
    }> => {
      if (draft) await draft.watchRange(channel)
      const nativeMembers = await send([
        RedisCommand.zrangebylex,
        layout.index(channel),
        lower,
        upper,
        RedisCommand.limit,
        '0',
        String(size)
      ])
      if (
        !Array.isArray(nativeMembers) ||
        nativeMembers.some((member) => typeof member !== 'string')
      )
        throw redisError(RedisErrorCode.decodeFailed, nativeMembers)
      // Hex preserves the original ordered writer's bytes and matches native ZSET member order.
      const candidates = draft
        ? [
            ...new Set([
              ...(nativeMembers as string[]),
              ...[...draft.entries.values()]
                .filter((entry) => entry.channel === channel && entry.value !== undefined)
                .map((entry) => entry.encoded)
            ])
          ]
            .filter(
              (encoded) =>
                (lower[0] === '[' ? encoded >= lower.slice(1) : encoded > lower.slice(1)) &&
                (upper[0] === '[' ? encoded <= upper.slice(1) : encoded < upper.slice(1))
            )
            .sort()
        : (nativeMembers as string[])
      const members = candidates.slice(0, size),
        done = nativeMembers.length < size && candidates.length <= size
      if (members.length === 0) return { rows: [], done }
      const keys = (members as string[]).map((member) => layout.decode(member)),
        rows: [IStorageKey, unknown][] = [],
        stale: { member: string; physical: string }[] = []
      if (draft) {
        const entries = await draft.loadMany(channel, keys)
        for (const entry of entries) {
          if (entry.value !== undefined)
            rows.push([entry.key, decodeRedisValue(channel, entry.value)])
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
        const physical = keys.map((key) => layout.value(channel, key)),
          values = await send([RedisCommand.mget, ...physical])
        if (!Array.isArray(values) || values.length !== keys.length)
          throw redisError(RedisErrorCode.decodeFailed, values)
        for (let index = 0; index < keys.length; index++) {
          const value = replyOptionalString(values[index])
          if (value === undefined)
            stale.push({ member: members[index], physical: physical[index]! })
          else rows.push([keys[index]!, decodeRedisValue(channel, value)])
        }
        if (stale.length)
          replyInteger(
            await send([
              RedisCommand.eval,
              pruneScript,
              String(stale.length + 1),
              layout.index(channel),
              ...stale.map((item) => item.physical),
              ...stale.map((item) => item.member)
            ])
          )
      }
      return { rows, last: members.at(-1), done }
    }
    /** Iteration resources and their accepted advances remain in the original shared lifetime. */
    const iterator = (
      range?: IKeyRange,
      ctx?: IOperationContext,
      draft?: RedisDraft,
      scope?: IRedisInternalScope
    ): IStorageIterator<[IStorageKey, unknown]> => {
      controller.assertLive()
      const capturedRange = snapshotKeyRange(range, RedisText.backend),
        capturedContext = snapshotOperationContext(ctx),
        [initial, upper] = bounds(capturedRange),
        size = capturedContext?.pageSize ?? 128
      let lower = initial,
        rows: readonly [IStorageKey, unknown][] = [],
        position = 0,
        done = false
      const lifetime = createStorageIteratorLifetime<[IStorageKey, unknown]>({
          close: async () => {
            rows = []
            done = true
          },
          report,
          onSettled: () => resources.delete(resource)
        }),
        advance = async (
          send: (args: readonly string[]) => Promise<unknown>
        ): Promise<IteratorResult<[IStorageKey, unknown]>> => {
          controller.assertLive()
          if (lifetime.isClosing()) return { done: true, value: undefined }
          while (position === rows.length && !done) {
            const result = await page('record', send, lower, upper, size, draft)
            rows = result.rows
            position = 0
            done = result.done
            if (result.last !== undefined) lower = '(' + result.last
          }
          return position === rows.length
            ? { done: true, value: undefined }
            : { done: false, value: rows[position++]! }
        },
        resource: IStorageIterator<[IStorageKey, unknown]> = {
          next: () =>
            lifetime.advance(() =>
              draft
                ? advance(draft.send)
                : read(
                    RedisOperation.next,
                    { range: capturedRange },
                    capturedContext,
                    (_input, send) => advance(send)
                  )
            ),
          return: lifetime.returned,
          dispose: lifetime.dispose,
          [asyncDisposeKey]: lifetime.symbolic,
          [Symbol.asyncIterator]() {
            return this
          }
        }
      if (scope)
        return transactionOwner.registerIterator(scope, {
          next: (current) =>
            operate(RedisOperation.next, { range: capturedRange }, draft!.context, current, () =>
              resource.next()
            ),
          close: resource.dispose
        })
      resources.add(resource)
      return resource
    }
    /**
     * Prefix mutations enumerate only the original native ordered interval and accept actual live
     * rows.
     */
    const removePrefix = async (
      channel: 'text' | 'record',
      prefixKey: IStorageKey | undefined,
      draft: RedisDraft
    ): Promise<number> => {
      const [initial, upper] = bounds(undefined, prefixKey)
      let lower = initial,
        count = 0
      for (;;) {
        const result = await page(channel, draft.send, lower, upper, 128, draft)
        for (const [key] of result.rows) if (await draft.remove(channel, key)) count++
        if (result.done || result.last === undefined) return count
        lower = '(' + result.last
      }
    }
    /**
     * Byte clearing uses native SCAN only for its own org envelope; other namespaces are never
     * decoded or removed.
     */
    const clearBytes = async (draft: RedisDraft): Promise<void> => {
      const physicalPrefix = layout.tag + ':b:',
        [lower, upper] = bounds()
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
          const key = layout.decode(encoded)
          if (typeof key !== 'string') throw redisError(RedisErrorCode.decodeFailed)
          await draft.remove('bytes', key)
        }
      } while (cursor !== '0')
    }
    /** Original transaction admission precedes capture, pipeline and all native draft access. */
    const scoped = <I, R>(
      scope: IRedisInternalScope,
      draft: RedisDraft,
      name: string,
      capture: () => I,
      run: (input: I, current: IRedisInternalScope) => Promise<R>,
      count?: number | ((input: I) => number)
    ): Promise<R> =>
      runTransactionOperation(scope, (current) => {
        assertTransactionOwner(store, current)
        const input = capture()
        const batchCount = typeof count === 'function' ? count(input) : count
        if (batchCount === 0) return run(input, current)
        return operate(
          name,
          input,
          draft.context,
          current,
          (actual) => {
            observe(transactions().forTransaction(current), 'beforeTxOperation', name)
            return run(actual, current).then((value) => {
              observe(transactions().forTransaction(current), 'afterTxOperation', name)
              return value
            })
          },
          batchCount
        )
      })
    /** TTL target capture admits only channels actually implemented by this backend. */
    const ttlTarget = (target: ITtlTarget): Exclude<ITtlTarget, { channel: 'vector' }> => {
      const captured = snapshotStorageTtlTarget(target, RedisText.backend)
      if (captured.channel === 'vector') unsupported()
      return captured
    }
    /** Query writes reuse the original query selection core and this same native draft. */
    const mutate = (
      draft: RedisDraft,
      request: IRecordQueryMutation,
      run: Parameters<IQueryMutator<IRecordQueryInput, unknown, IRecordQueryMutation>>[1],
      scope?: IRedisInternalScope
    ): Promise<number> => {
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
        execute: () => iterator(undefined, undefined, draft, scope),
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
    /** Every original view receives fresh closures over the same draft, never a copied old scope. */
    const createScope = (draft: RedisDraft): IRedisInternalScope => {
      const scope: IRedisInternalScope = {
        use: (capability) => useTransactionCapability(scope, capability),
        get: (key) =>
          scoped(
            scope,
            draft,
            RedisOperation.get,
            () => textKey(key),
            async (actual) =>
              ((await draft.read('text', textKey(actual))) as string | undefined) ?? null
          ),
        set: (key, value, options) =>
          scoped(
            scope,
            draft,
            RedisOperation.set,
            () => ({
              ...capturePoint('text', textKey(key), value),
              policy: readTransactionConflictPolicy(options, RedisText.backend)
            }),
            async (actual) => {
              const prepared = preparePoint('text', actual)
              await draft.write(
                'text',
                prepared.key,
                prepared.wire,
                readTransactionConflictPolicy({ conflictPolicy: actual.policy }, RedisText.backend)
              )
            }
          ),
        remove: (key) =>
          scoped(
            scope,
            draft,
            RedisOperation.remove,
            () => textKey(key),
            async (actual) => {
              await draft.remove('text', textKey(actual))
            }
          ),
        has: (key) =>
          scoped(
            scope,
            draft,
            RedisOperation.has,
            () => textKey(key),
            async (actual) => (await draft.read('text', textKey(actual))) !== undefined
          ),
        getBytes: (key) =>
          scoped(
            scope,
            draft,
            RedisOperation.getBytes,
            () => textKey(key),
            async (actual) =>
              ((await draft.read('bytes', textKey(actual))) as Uint8Array | undefined) ?? null
          ),
        setBytes: (key, value, options) =>
          scoped(
            scope,
            draft,
            RedisOperation.setBytes,
            () => ({
              ...capturePoint('bytes', textKey(key), value),
              policy: readTransactionConflictPolicy(options, RedisText.backend)
            }),
            async (actual) => {
              const prepared = preparePoint('bytes', actual)
              await draft.write(
                'bytes',
                prepared.key,
                prepared.wire,
                readTransactionConflictPolicy({ conflictPolicy: actual.policy }, RedisText.backend)
              )
            }
          ),
        removeBytes: (key) =>
          scoped(
            scope,
            draft,
            RedisOperation.removeBytes,
            () => textKey(key),
            async (actual) => {
              await draft.remove('bytes', textKey(actual))
            }
          ),
        getRecord: (input) =>
          scoped(
            scope,
            draft,
            RedisOperation.getRecord,
            () => key(input),
            (actual) => draft.read('record', key(actual))
          ),
        putRecord: (value, input, options) =>
          scoped(
            scope,
            draft,
            RedisOperation.putRecord,
            () => ({
              ...capturePoint('record', input ?? crypto.randomUUID(), value),
              policy: readTransactionConflictPolicy(options, RedisText.backend)
            }),
            async (actual) => {
              const prepared = preparePoint('record', actual)
              await draft.write(
                'record',
                prepared.key,
                prepared.wire,
                readTransactionConflictPolicy({ conflictPolicy: actual.policy }, RedisText.backend)
              )
              return prepared.key
            }
          ),
        deleteRecord: (input) =>
          scoped(
            scope,
            draft,
            RedisOperation.deleteRecord,
            () => key(input),
            async (actual) => {
              await draft.remove('record', key(actual))
            }
          ),
        iterateRecords: (range) => {
          assertTransactionOwner(store, scope)
          return iterator(range, undefined, draft, scope)
        },
        getMany: (inputs) =>
          scoped(
            scope,
            draft,
            RedisOperation.getMany,
            () => snapshotStorageBatchKeys(inputs, RedisText.backend).map((entry) => entry.key),
            async (actual) =>
              (
                await draft.loadMany(
                  'text',
                  snapshotStorageBatchKeys(actual, RedisText.backend).map((entry) => entry.key)
                )
              ).map((entry) =>
                entry.value === undefined
                  ? undefined
                  : (decodeRedisValue('text', entry.value) as string)
              ),
            (actual) => actual.length
          ),
        setMany: (entries) =>
          scoped(
            scope,
            draft,
            RedisOperation.setMany,
            () => captureEntries(entries),
            async (actual) => {
              const prepared = prepareEntries(actual)
              for (const entry of prepared)
                await draft.write('text', entry.key, entry.wire, 'conflict', entry.ttlMs)
            },
            (actual) => actual.length
          ),
        removeMany: (inputs) =>
          scoped(
            scope,
            draft,
            RedisOperation.removeMany,
            () => snapshotStorageBatchKeys(inputs, RedisText.backend).map((entry) => entry.key),
            async (actual) => {
              const prepared = snapshotStorageBatchKeys(actual, RedisText.backend)
              let count = 0
              for (const entry of prepared) if (await draft.remove('text', entry.key)) count++
              return count
            },
            (actual) => actual.length
          ),
        removeByPrefix: (prefix) =>
          scoped(
            scope,
            draft,
            RedisOperation.removeByPrefix,
            () => key(prefix),
            (actual) => removePrefix('text', key(actual), draft)
          ),
        [recordsApi]: {
          query: <R>() =>
            createRecordQuery<R, undefined>(
              {
                asyncDisposeKey,
                pushdown: { source: RedisText.backend, operations: [], operators: [] },
                execute: () => {
                  assertTransactionOwner(store, scope)
                  return iterator(undefined, undefined, draft, scope)
                },
                mutate: (request, run) =>
                  scoped(
                    scope,
                    draft,
                    request.operation === 'delete'
                      ? RedisOperation.queryDelete
                      : RedisOperation.queryUpdate,
                    () => request,
                    (actual, current) => mutate(draft, actual, run, current)
                  )
              },
              core.getChainMethods('query')
            ),
          removeByPrefix: (input) =>
            scoped(
              scope,
              draft,
              RedisOperation.removeByPrefix,
              () => key(input),
              (actual) => removePrefix('record', key(actual), draft)
            )
        },
        [ttlApi]: {
          expire: (target, ms) =>
            scoped(
              scope,
              draft,
              RedisOperation.expire,
              () => {
                const captured = ttlTarget(target)
                assertStorageTtlDuration(ms, RedisText.backend)
                return { target: captured, ms }
              },
              (actual) => {
                const target = ttlTarget(actual.target)
                assertStorageTtlDuration(actual.ms, RedisText.backend)
                return draft.expire(target.channel, target.key, actual.ms)
              }
            ),
          remaining: (target) =>
            scoped(
              scope,
              draft,
              RedisOperation.remaining,
              () => ttlTarget(target),
              (actual) => {
                const target = ttlTarget(actual)
                return draft.remaining(target.channel, target.key)
              }
            ),
          persist: (target) =>
            scoped(
              scope,
              draft,
              RedisOperation.persist,
              () => ttlTarget(target),
              (actual) => {
                const target = ttlTarget(actual)
                return draft.expire(target.channel, target.key)
              }
            )
        },
        [counterApi]: {
          increment: (input, by) =>
            scoped(
              scope,
              draft,
              RedisOperation.increment,
              () => {
                snapshotStorageCounterIncrement(by, RedisText.backend)
                return { key: textKey(input), by }
              },
              (actual) => draft.increment(textKey(actual.key), actual.by)
            )
        }
      }
      return scope
    }
    /** User callback and finalizers remain owned by the original contract registration. */
    const transaction = <R>(
      callback: (scope: IRedisTransactionScope) => R,
      options: ITransactionOptions = {}
    ): Promise<Awaited<R>> => {
      assertTransactionCallback(callback, RedisText.backend)
      assertWrite()
      const finish = controller.beginMutation()
      return runWithConcurrency<Awaited<R>>(
        {
          store,
          options,
          executeAttempt: (context, proceed) =>
            operate(RedisOperation.transaction, {}, context, undefined, proceed)
        },
        {
          attempt: async (context) => {
            let registration: ReturnType<typeof transactionOwner.register> | undefined,
              stages: ReturnType<ReturnType<typeof transactions>['forTransaction']> | undefined,
              changed = 0
            try {
              const outcome = await nativeAttempt<Awaited<R>>(
                context,
                async (draft): Promise<Awaited<R>> => {
                  let failure: unknown,
                    failed = false
                  const scope = createScope(draft)
                  registration = transactionOwner.register(scope, {
                    createScope: () => createScope(draft),
                    context,
                    onFailure: (error) => {
                      if (!failed) {
                        failed = true
                        failure = error
                      }
                    },
                    beforeCommit: (current) =>
                      observe(transactions().forTransaction(current), 'beforeCommit')
                  })
                  stages = transactions().forTransaction(scope)
                  observe(transactions(), 'beforeTransaction')
                  observe(stages, 'onTransactionStart')
                  let value: Awaited<R> | undefined
                  try {
                    value = (await callback(scope)) as Awaited<R>
                  } catch (error) {
                    if (!failed) {
                      failed = true
                      failure = normalizeRedisTransactionFailure(error)
                    }
                  }
                  registration.stopAdmission()
                  if (failed) throw failure
                  await registration.runFinalizers()
                  throwIfAborted(context.signal)
                  changed = [...draft.entries.values()].filter((entry) => entry.changed).length
                  return value as Awaited<R>
                }
              )
              if (outcome.status === 'committed') observe(stages, 'afterCommit', changed)
              else observe(stages, 'afterRollback', StorageContractErrorCode.writeConflict)
              return outcome
            } catch (error) {
              registration?.stopAdmission()
              let failure = normalizeRedisTransactionFailure(error)
              try {
                await registration?.closeIterators()
              } catch (cleanup) {
                if (cleanup !== error)
                  failure = redisError(
                    RedisErrorCode.transactionFailed,
                    new AggregateError([error, cleanup], RedisText.transactionFailed, {
                      cause: error
                    })
                  )
              }
              observe(stages, 'afterRollback', Reflect.get(failure, 'code'))
              throw failure
            } finally {
              registration?.close()
              observe(stages, 'onTransactionClose')
            }
          }
        }
      ).finally(finish)
    }

    /** Ordinary point readers share the same native wire decoding as transaction reads. */
    const get = (
      channel: IRedisChannel,
      input: IStorageKey,
      ctx?: IOperationContext
    ): Promise<unknown> =>
      read(
        channel === 'text'
          ? RedisOperation.get
          : channel === 'bytes'
            ? RedisOperation.getBytes
            : RedisOperation.getRecord,
        key(input),
        ctx,
        async (actual, send) => {
          const raw = replyOptionalString(
            await send([RedisCommand.get, layout.value(channel, key(actual))])
          )
          return raw === undefined ? undefined : decodeRedisValue(channel, raw)
        },
        1
      )
    /** Writes capture portable data before pipeline or connection acquisition. */
    const put = (
      channel: IRedisChannel,
      input: IStorageKey,
      value: unknown,
      ctx?: IWriteOptions
    ): Promise<void> => {
      const captured = capturePoint(channel, input, value)
      return write(
        channel === 'text'
          ? RedisOperation.set
          : channel === 'bytes'
            ? RedisOperation.setBytes
            : RedisOperation.putRecord,
        captured,
        ctx,
        (actual) => preparePoint(channel, actual),
        (actual) => writeLocks(actual.key),
        async (draft, actual, context) => {
          await draft.write(
            channel,
            actual.key,
            actual.wire,
            readTransactionConflictPolicy(context, RedisText.backend)
          )
        },
        1
      )
    }
    /** Deletes affect only their requested channel, with the original implicit native lock. */
    const remove = (
      channel: IRedisChannel,
      input: IStorageKey,
      ctx?: IOperationContext
    ): Promise<void> =>
      write(
        channel === 'text'
          ? RedisOperation.remove
          : channel === 'bytes'
            ? RedisOperation.removeBytes
            : RedisOperation.deleteRecord,
        key(input),
        ctx,
        key,
        (actual) => channelLocks(channel, actual),
        async (draft, actual) => {
          await draft.remove(channel, actual)
        },
        1
      )
    /**
     * Wrapping only observation retains the genuine native client, original lease and reply
     * evidence.
     */
    const observedConnection = (connection: IRedisConnection): IRedisConnection => {
      const binary = connection.binaryCommand
      return {
        getClient: () => connection.getClient(),
        command: (args) => command(connection, args, orgId),
        exec: (commands) => exec(connection, commands, orgId),
        ...(binary
          ? {
              binaryCommand: (
                args: Parameters<NonNullable<IRedisConnection['binaryCommand']>>[0]
              ) =>
                observeNative(args[0] as string, orgId, () =>
                  Reflect.apply(binary, connection, [args])
                )
            }
          : {})
      }
    }
    const nativeDriver: IRedisDriver = {
      command: (args) => observeNative(args[0]!, orgId, () => driver.command(args)),
      withConnection: (run) =>
        driver.withConnection((connection) => run(observedConnection(connection))),
      subscribe: (channel, listener) =>
        observeNative(RedisCommand.subscribe, orgId, () => driver.subscribe(channel, listener))
    }
    const native: IRedisNativeFeaturePort = {
      driver: nativeDriver,
      now: () => core.featureExpose.getScheduler().now(),
      closingSignal: controller.closingSignal,
      allOrganizations,
      enableDurable: (maxLen, create) => {
        if (
          !Number.isSafeInteger(maxLen) ||
          maxLen < 1 ||
          (durableMaxLen !== undefined && durableMaxLen !== maxLen)
        )
          throw invalidArgument()
        durableMaxLen = maxLen
        durableFactory = create
      },
      run: (name, input, ctx, writing, run, pipeline = true) => {
        if (writing) assertWrite()
        else controller.assertLive()
        const finish = controller.beginMutation()
        return withAbort(ctx, async (signal, context) => {
          const invoke = (actual: typeof input) => {
            throwIfAborted(signal)
            return nativeDriver.withConnection((connection) =>
              run(actual, connection, layout, signal)
            )
          }
          return pipeline
            ? operate(name, input, context, undefined, invoke)
            : observeStorageBatch(
                operations(),
                core.featureExpose.getScheduler(),
                name,
                undefined,
                () => invoke(input)
              )
        }).finally(finish)
      },
      resource: (name, input, ctx, run, pipeline = true) => {
        controller.assertLive()
        const finish = controller.beginMutation()
        let merged: ReturnType<typeof mergeSignals>
        try {
          merged = mergeSignals(ctx, report)
        } catch (error) {
          finish()
          throw error
        }
        const invoke = async (actual: typeof input): Promise<IStorageResource> => {
          throwIfAborted(merged.signal)
          const underlying = await run(actual, layout, merged.signal)
          let off = () => undefined as void
          const release = () => {
              off()
              merged.dispose()
              resources.delete(resource)
            },
            dispose = (): Promise<void> => {
              const pending = underlying.dispose()
              void pending.then(release, release)
              return pending
            },
            resource: IStorageResource = {
              dispose,
              [asyncDisposeKey]: () => {
                void dispose().then(undefined, () => undefined)
                return underlying[asyncDisposeKey]()
              }
            }
          resources.add(resource)
          off = subscribeToAbort(
            merged.signal,
            () => {
              void resource[asyncDisposeKey]()
            },
            report
          )
          try {
            throwIfAborted(merged.signal)
          } catch (error) {
            await resource[asyncDisposeKey]()
            throw error
          }
          return resource
        }
        const pending = pipeline
          ? operate(name, input, merged.context, undefined, invoke)
          : observeStorageBatch(
              operations(),
              core.featureExpose.getScheduler(),
              name,
              undefined,
              () => invoke(input)
            )
        return pending
          .catch((error) => {
            merged.dispose()
            throw error
          })
          .finally(finish)
      },
      report: (error) => reportCleanupError(report, error)
    }
    const base: IRedisNativeStore & { readonly [nativeFeaturePort]: IRedisNativeFeaturePort } = {
      [nativeFeaturePort]: native,
      backend: RedisText.backend,
      capabilities: redisCapabilities,
      dispose: controller.dispose,
      [asyncDisposeKey]: () =>
        (symbolic ??= controller
          .dispose()
          .then(undefined, (error) => reportCleanupError(report, error))),
      get: (input, ctx) =>
        get('text', textKey(input), ctx).then((value) => (value as string | undefined) ?? null),
      set: (input, value, ctx) => put('text', textKey(input), value, ctx),
      remove: (input, ctx) => remove('text', textKey(input), ctx),
      has: (input, ctx) => get('text', textKey(input), ctx).then((value) => value !== undefined),
      getBytes: (input, ctx) =>
        get('bytes', textKey(input), ctx).then(
          (value) => (value as Uint8Array | undefined) ?? null
        ),
      setBytes: (input, value, ctx) => {
        if (!isUint8Array(value)) throw invalidArgument()
        return put('bytes', textKey(input), new Uint8Array(value), ctx)
      },
      removeBytes: (input, ctx) => remove('bytes', textKey(input), ctx),
      getRecord: (input, ctx) => get('record', key(input), ctx),
      putRecord: async (value, input, ctx) => {
        const captured = key(input ?? crypto.randomUUID())
        await put('record', captured, value, ctx)
        return captured
      },
      deleteRecord: (input, ctx) => remove('record', key(input), ctx),
      keys: (ctx) =>
        read(RedisOperation.keys, {}, ctx, async (_input, send) => {
          const result: string[] = [],
            [initial, upper] = bounds()
          let lower = initial
          for (;;) {
            const next = await page('text', send, lower, upper, 128)
            for (const [key] of next.rows) if (typeof key === 'string') result.push(key)
            if (next.done || next.last === undefined) return result
            lower = '(' + next.last
          }
        }),
      clearValues: (ctx) =>
        write(
          RedisOperation.clearValues,
          {},
          ctx,
          (input) => input,
          () => [],
          async (draft) => {
            await removePrefix('text', undefined, draft)
          }
        ),
      clearBytes: (ctx) =>
        write(
          RedisOperation.clearBytes,
          {},
          ctx,
          (input) => input,
          () => [],
          clearBytes
        ),
      clearRecords: (ctx) =>
        write(
          RedisOperation.clearRecords,
          {},
          ctx,
          (input) => input,
          () => [],
          async (draft) => {
            await removePrefix('record', undefined, draft)
          }
        ),
      clearAll: (ctx) =>
        write(
          RedisOperation.clearAll,
          {},
          ctx,
          (input) => input,
          () => [],
          async (draft) => {
            await removePrefix('text', undefined, draft)
            await removePrefix('record', undefined, draft)
            await clearBytes(draft)
          }
        ),
      iterateRecords: (range, ctx) => iterator(range, ctx),
      transaction,
      tx: () => {
        controller.assertLive()
        return createTransactionBuilder(store, undefined, core.getChainMethods('tx'))
      },
      inspectLocks: (ctx) => {
        controller.assertLive()
        const finish = controller.beginMutation()
        return runWithConcurrency<readonly ILockHolding[]>(
          {
            store,
            options: ctx ?? {},
            execute: (context, proceed) =>
              operate(RedisOperation.inspectLocks, {}, context, undefined, proceed)
          },
          {
            attempt: (context) =>
              driver.withConnection(async (connection) => ({
                status: 'committed' as const,
                value: await createRedisLocks({
                  layout,
                  context,
                  owner: controller.origin,
                  label,
                  maxLockMs,
                  send: (args) => command(connection, args, orgId)
                }).inspect()
              }))
          }
        ).finally(finish)
      },
      subscribeChanges: (listener) => {
        controller.assertLive()
        return controller.subscribe((change) => {
          if (allOrganizations || change.orgId === orgId) return listener(change)
        })
      },
      watch: (input, ctx) =>
        createBackendChangeIterator(controller, {
          orgId,
          channel: 'value',
          key: textKey(input),
          ctx,
          execute: (advance, context) =>
            operate(RedisOperation.watch, {}, context, undefined, advance)
        })
    }
    const keyValue: IKeyValueApi = {
      ...base,
      getMany: (inputs, ctx) => {
        const captured = snapshotStorageBatchKeys(inputs, RedisText.backend).map(
          (entry) => entry.key
        )
        if (captured.length === 0) return empty(ctx, [])
        return read(
          RedisOperation.getMany,
          captured,
          ctx,
          async (actual, send) => {
            const prepared = snapshotStorageBatchKeys(actual, RedisText.backend)
            const values = await send([
              RedisCommand.mget,
              ...prepared.map((entry) => layout.value('text', entry.key))
            ])
            if (!Array.isArray(values) || values.length !== prepared.length)
              throw redisError(RedisErrorCode.decodeFailed, values)
            return values.map((value) => {
              const raw = replyOptionalString(value)
              return raw === undefined ? undefined : (decodeRedisValue('text', raw) as string)
            })
          },
          captured.length
        )
      },
      setMany: (entries, ctx) => {
        const captured = captureEntries(entries)
        if (captured.length === 0) return empty(ctx, undefined)
        return write(
          RedisOperation.setMany,
          captured,
          ctx,
          prepareEntries,
          (actual) => actual.flatMap((entry) => writeLocks(entry.key)),
          async (draft, actual) => {
            for (const entry of actual)
              await draft.write('text', entry.key, entry.wire, 'conflict', entry.ttlMs)
          },
          captured.length
        )
      },
      removeMany: (inputs, ctx) => {
        const captured = snapshotStorageBatchKeys(inputs, RedisText.backend).map(
          (entry) => entry.key
        )
        if (captured.length === 0) return empty(ctx, 0)
        return write(
          RedisOperation.removeMany,
          captured,
          ctx,
          (input) => snapshotStorageBatchKeys(input, RedisText.backend),
          (actual) => actual.map((entry) => ({ channel: 'text', key: entry.key })),
          async (draft, actual) => {
            let count = 0
            for (const entry of actual) if (await draft.remove('text', entry.key)) count++
            return count
          },
          captured.length
        )
      },
      removeByPrefix: (input, ctx) =>
        write(
          RedisOperation.removeByPrefix,
          key(input),
          ctx,
          key,
          () => [],
          (draft, actual) => removePrefix('text', actual, draft)
        )
    }
    const recordApi: IRecordsApi<unknown, true> = {
      query: <R>() =>
        createRecordQuery<R>(
          {
            asyncDisposeKey,
            pushdown: { source: RedisText.backend, operations: [], operators: [] },
            execute: ({ ctx }) => iterator(undefined, ctx),
            watch: ({ ctx }) =>
              createBackendChangeIterator(controller, { orgId, channel: 'record', ctx }),
            mutate: (request, run) =>
              write(
                request.operation === 'delete'
                  ? RedisOperation.queryDelete
                  : RedisOperation.queryUpdate,
                request,
                request.ctx,
                (input) => input,
                () => [],
                (draft, actual) => mutate(draft, actual, run),
                undefined,
                request.concurrency
              )
          },
          core.getChainMethods('query')
        ),
      removeByPrefix: (input, ctx) =>
        write(
          RedisOperation.removeByPrefix,
          key(input),
          ctx,
          key,
          () => [],
          (draft, actual) => removePrefix('record', actual, draft)
        )
    }
    const timeToLive: ITtlApi = {
      expire: (input, ms, ctx) => {
        const target = ttlTarget(input)
        assertStorageTtlDuration(ms, RedisText.backend)
        return write(
          RedisOperation.expire,
          { target, ms },
          ctx,
          (actual) => {
            const target = ttlTarget(actual.target)
            assertStorageTtlDuration(actual.ms, RedisText.backend)
            return { target, ms: actual.ms }
          },
          (actual) => [actual.target],
          (draft, actual) => draft.expire(actual.target.channel, actual.target.key, actual.ms),
          1
        )
      },
      remaining: (input, ctx) => {
        const target = ttlTarget(input)
        return read(
          RedisOperation.remaining,
          target,
          ctx,
          async (actual, send) => {
            const target = ttlTarget(actual),
              value = replyInteger(
                await send([RedisCommand.pttl, layout.value(target.channel, target.key)])
              )
            return value < 0 ? undefined : value
          },
          1
        )
      },
      persist: (input, ctx) => {
        const target = ttlTarget(input)
        return write(
          RedisOperation.persist,
          target,
          ctx,
          ttlTarget,
          (actual) => [actual],
          (draft, actual) => draft.expire(actual.channel, actual.key),
          1
        )
      }
    }
    const counters: ICounterApi = {
      increment: (input, by, ctx) => {
        const captured = { key: textKey(input), by }
        snapshotStorageCounterIncrement(by, RedisText.backend)
        return write(
          RedisOperation.increment,
          captured,
          ctx,
          (actual) => {
            snapshotStorageCounterIncrement(actual.by, RedisText.backend)
            return { key: textKey(actual.key), by: actual.by }
          },
          (actual) => writeLocks(actual.key),
          (draft, actual) => draft.increment(actual.key, actual.by),
          1
        )
      }
    }
    store = provideCapabilities(
      base,
      [
        implement(kv, keyValue, { forTransaction: (scope) => scope }),
        implement(records, recordApi, {
          forTransaction: (scope) => (scope as IRedisInternalScope)[recordsApi]
        }),
        implement(ttl, timeToLive, {
          forTransaction: (scope) => (scope as IRedisInternalScope)[ttlApi]
        }),
        implement(counter, counters, {
          forTransaction: (scope) => (scope as IRedisInternalScope)[counterApi]
        })
      ] as const,
      {
        onInstaller: (value) => {
          installer = value
        }
      }
    )
    transactionOwner = createTransactionOwner<unknown, IRedisInternalScope>(
      store,
      normalizeRedisTransactionFailure,
      {
        activityMode: 'managed',
        asyncDisposeKey,
        defaultPolicy: concurrency,
        concurrencyStages: concurrencyStages()
      }
    )
    /** Child providers publish the selected factory through their original installer only. */
    let durablePublication: ReturnType<ICapabilityInstallPort['prepare']> | undefined
    const configureFeatures = (): void => {
      if (!allOrganizations && durableFactory && !durablePublication) {
        durablePublication = installer.prepare([
          implement(durableChangeFeed, durableFactory(store))
        ])
        durablePublication.publish()
      }
    }
    const releaseFeatures = (): void => {
      durablePublication?.release()
    }
    return { store, installer, configureFeatures, releaseFeatures }
  }
  const root = forOrg(core.defaultOrgId, true)
  return {
    ...root,
    controller,
    orgBinding: {
      backend: (orgId) => forOrg(orgId).store,
      drop: async (orgId) => {
        await forOrg(orgId).store.clearAll()
      }
    },
    detect: async () => {
      const info = await driver.command([RedisCommand.info, RedisCommand.server])
      if (typeof info !== 'string') throw redisError(RedisErrorCode.decodeFailed, info)
      const valkey = /^valkey_version:(\d+)\.(\d+)\.(\d+)/m.exec(info),
        redis = /^redis_version:(\d+)\.(\d+)\.(\d+)/m.exec(info),
        version = valkey ?? redis
      if (
        !version ||
        Number(version[1]) < 7 ||
        (Number(version[1]) === 7 &&
          (Number(version[2]) < 2 ||
            (valkey && Number(version[2]) === 2 && Number(version[3]) < 5)))
      )
        unsupported()
      if (!subscription)
        subscription = await driver.subscribe(
          createRedisLayout(prefix, core.defaultOrgId).changes,
          (wire) => {
            try {
              const change = decodeRedisChange(wire)
              if (change.origin !== controller.origin) controller.publishExternal(change)
            } catch (error) {
              reportCleanupError(report, error)
            }
          }
        )
    }
  }
}
