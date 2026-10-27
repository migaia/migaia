import {
  createBackendChangeIterator,
  createBackendChangeController,
  ConcurrencyPolicy,
  runWithConcurrency,
  snapshotConcurrencyLockKeys,
  provideCapabilities,
  createTransactionOwner,
  runTransactionOperation,
  assertTransactionOwner,
  useTransactionCapability,
  createTransactionBuilder,
  resolveConcurrencyPolicy,
  createRecordQuery,
  createStorageIteratorLifetime,
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture,
  snapshotStorageOrgKeyPrefix,
  snapshotStorageTtlTarget,
  snapshotStorageCounterIncrement,
  snapshotOperationContext,
  asyncDisposeKey,
  createStorageOperationReporter,
  reportCleanupError,
  withAbort,
  mergeSignals,
  subscribeToAbort,
  throwIfAborted,
  snapshotKeyRange,
  observeStorageBatch,
  normalizeError,
  type IBackendChangeController
} from '@migaia/storage-host/sdk'
import { RedisCommand, RedisOperation } from './constants.js'
import {
  StorageContractErrorCode,
  kv,
  records,
  ttl,
  counter,
  durableChangeFeed,
  vector,
  type IDurableChangeFeedApi,
  implement,
  assertTransactionCallback,
  assertStringStorageKey,
  assertStorageTtlDuration,
  assertOperationContext,
  readTransactionConflictPolicy,
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
import {
  StorageError,
  StorageErrorCode,
  type IStoragePluginCore,
  type IStorageOrgBinding,
  type IStorageJournalBackendBinding
} from '@migaia/storage-host'
import { RedisDraft, validateRedisExec } from './transaction.js'
import { createRedisJournalBinding } from './journal.js'
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
import {
  nativeFeaturePort,
  type IRedisNativeFeaturePort,
  type IRedisVectorBinding
} from './native-feature.js'

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
  readonly journalBinding: IStorageJournalBackendBinding
  detect(): Promise<void>
}

/** One organization projection publishes only original store, feature and journal ports. */
type IRedisOrganizationProjection = {
  store: IRedisStore
  installer: ICapabilityInstallPort
  configureFeatures(): void
  releaseFeatures(): void
  journal: IStorageJournalBackendBinding
  drop(): Promise<void>
}
/** One installation owns org projections and the original shared controller, never the driver. */
type IRedisEnvironment = {
  /** Original driver state belongs to this installation and its accepted native lifetime. */
  driver: IRedisDriver
  /** Original prefix state belongs to this installation and its accepted native lifetime. */
  prefix: string
  /** Original concurrency state belongs to this installation and its accepted native lifetime. */
  concurrency: IRedisOptions['concurrency']
  /** Original label state belongs to this installation and its accepted native lifetime. */
  label: string | undefined
  /** Original maxLockMs state belongs to this installation and its accepted native lifetime. */
  maxLockMs: number
  /** Original report state belongs to this installation and its accepted native lifetime. */
  report: ReturnType<typeof createStorageOperationReporter>
  /** Original resources state belongs to this installation and its accepted native lifetime. */
  resources: Set<IStorageResource>
  /** Original projections state belongs to this installation and its accepted native lifetime. */
  projections: Map<string | symbol, IRedisOrganizationProjection>
  /** Original scopeDrafts state belongs to this installation and its accepted native lifetime. */
  scopeDrafts: WeakMap<object, { readonly store: IRedisStore; readonly draft: RedisDraft }>
  /** Original rootProjection state belongs to this installation and its accepted native lifetime. */
  rootProjection: symbol
  /** Original subscription state belongs to this installation and its accepted native lifetime. */
  subscription: IStorageResource | undefined
  /** Original poison state belongs to this installation and its accepted native lifetime. */
  poison: Error | undefined
  /** Original durableMaxLen state belongs to this installation and its accepted native lifetime. */
  durableMaxLen: number | undefined
  /** Original durableFactory state belongs to this installation and its accepted native lifetime. */
  durableFactory: ((store: IRedisStore) => IDurableChangeFeedApi) | undefined
  /** Original vectorFactory state belongs to this installation and its accepted native lifetime. */
  vectorFactory: ((store: IRedisStore) => IRedisVectorBinding) | undefined
  /** Original controller state belongs to this installation and its accepted native lifetime. */
  controller: IBackendChangeController
  /** Original core state belongs to this installation and its accepted native lifetime. */
  core: IStoragePluginCore
}
/** Fixed organization state borrows the installation lifetime and canonical transaction owner. */
type IRedisOrganizationContext = {
  /** Root resources and selected feature factories remain shared by the original installation. */
  environment: IRedisEnvironment
  /** The original fixed observed driver ports retain identity for this organization. */
  nativeDriver: IRedisDriver
  /** Original orgId state belongs only to this exact organization projection. */
  orgId: string
  /** Original allOrganizations state belongs only to this exact organization projection. */
  allOrganizations: boolean
  /** Original ports state belongs only to this exact organization projection. */
  ports: ReturnType<IStoragePluginCore['getOrgContext']>
  /** Original layout state belongs only to this exact organization projection. */
  layout: ReturnType<typeof createRedisLayout>
  /** Original store state belongs only to this exact organization projection. */
  store: IRedisStore
  /** Original installer state belongs only to this exact organization projection. */
  installer: ICapabilityInstallPort
  /** Original transactionOwner state belongs only to this exact organization projection. */
  transactionOwner: ReturnType<typeof createTransactionOwner<unknown, IRedisInternalScope>>
  /** Original symbolic state belongs only to this exact organization projection. */
  symbolic: Promise<void> | undefined
  /** Original vectorBinding state belongs only to this exact organization projection. */
  vectorBinding: IRedisVectorBinding | undefined
  /** Original vectorPublication state belongs only to this exact organization projection. */
  vectorPublication: ReturnType<ICapabilityInstallPort['prepare']> | undefined
  /** Original durablePublication state belongs only to this exact organization projection. */
  durablePublication: ReturnType<ICapabilityInstallPort['prepare']> | undefined
}
/**
 * Unknown intervention failures retain the original host error boundary; native failures are
 * already coded.
 */
function redisExtensionFailure(
  environment: IRedisEnvironment,
  error: unknown,
  operation: string
): Error {
  return normalizeError(
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
}
/** Selected native writes are sealed after an unknown outcome without discarding read access. */
function redisAssertWrite(environment: IRedisEnvironment): void {
  environment.controller.assertLive()
  if (environment.poison) throw environment.poison
}
/** Fixed command observation never includes arguments or application data. */
async function redisObserveNative<R>(
  environment: IRedisEnvironment,
  name: string,
  orgId: string,
  run: () => Promise<R>
): Promise<R> {
  const started = environment.core.featureExpose.getScheduler().now()
  try {
    return await run()
  } finally {
    environment.core.emit(RedisOperation.onRedisCommand, () => ({
      backendId: environment.core.getBackendId(),
      backend: RedisText.backend,
      orgId,
      command: name,
      elapsedMs: environment.core.featureExpose.getScheduler().now() - started
    }))
  }
}
/** Standard drafts and selected Features share the same original native observation path. */
function redisCommand(
  environment: IRedisEnvironment,
  connection: IRedisConnection,
  args: readonly string[],
  orgId: string
): Promise<unknown> {
  return redisObserveNative(environment, args[0]!, orgId, () => connection.command(args))
}
/** EXEC observation measures the full actual native batch, without fabricating per-item timings. */
function redisExec(
  environment: IRedisEnvironment,
  connection: IRedisConnection,
  commands: Parameters<IRedisConnection['exec']>[0],
  orgId: string
) {
  return redisObserveNative(environment, RedisCommand.exec, orgId, () => connection.exec(commands))
}
/** Each org receives a native provider projection without DDL, registry I/O or another lifetime. */
function redisForOrg(environment: IRedisEnvironment, orgId: string, allOrganizations = false) {
  environment.controller.assertLive()
  const identity = allOrganizations ? environment.rootProjection : orgId
  let current = environment.projections.get(identity)
  if (!current) {
    current = createRedisOrganization(environment, orgId, allOrganizations)
    environment.projections.set(identity, current)
  }
  current.configureFeatures()
  return current
}
/** Observer promises are observed but cannot delay, replace or abort the original operation. */
function redisObserve(
  environment: IRedisEnvironment,
  observer: object | undefined,
  name: string,
  ...values: readonly unknown[]
): void {
  if (!observer) return
  try {
    /** Ordinary method invocation retains the original observer receiver. */
    const callbacks = observer as Record<string, (...args: readonly unknown[]) => unknown>
    if (typeof callbacks[name] !== 'function') return
    const result = callbacks[name](...values)
    void Promise.resolve(result).catch((error) => reportCleanupError(environment.report, error))
  } catch (error) {
    reportCleanupError(environment.report, error)
  }
}
/** All observations resolve through this exact original store and org binding. */
function redisOperations(organization: IRedisOrganizationContext) {
  return organization.ports.stageBindings.operationStages(organization.store)
}
/** All observations resolve through this exact original store and org binding. */
function redisTransactions(organization: IRedisOrganizationContext) {
  return organization.ports.stageBindings.transactionStages(organization.store)
}
/** All observations resolve through this exact original store and org binding. */
function redisConcurrencyStages(organization: IRedisOrganizationContext) {
  return organization.ports.stageBindings.concurrencyStages(organization.store)
}
/** One public terminal owns one pipeline and one storage-operation observation. */
function redisOperate<I, R>(
  organization: IRedisOrganizationContext,
  name: string,
  input: I,
  ctx: IOperationContext | undefined,
  scope: object | undefined,
  run: (input: I) => Promise<R>,
  count?: number,
  keys?: () => readonly ILockKey[],
  internal?: true
): Promise<R> {
  const execute = () =>
    organization.ports.execution.run<I, R>(
      { operation: name, input, ctx, scope, internal, keys },
      (actual) =>
        observeStorageBatch(
          scope
            ? redisOperations(organization).forTransaction(scope)
            : redisOperations(organization),
          organization.environment.core.featureExpose.getScheduler(),
          name,
          count,
          () => run(actual)
        )
    )
  return execute().catch((error) => {
    throw redisExtensionFailure(organization.environment, error, name)
  })
}
/** A readonly endpoint drains the genuine connection before its original controller lease ends. */
function redisRead<I, R>(
  organization: IRedisOrganizationContext,
  name: string,
  input: I,
  ctx: IOperationContext | undefined,
  run: (input: I, send: (args: readonly string[]) => Promise<unknown>) => Promise<R>,
  count?: number,
  keys?: () => readonly ILockKey[]
): Promise<R> {
  organization.environment.controller.assertLive()
  const finish = organization.environment.controller.beginMutation()
  return withAbort(ctx, async (signal, captured) => {
    // A fresh org resolves its original once-only configuration inside this existing budget.
    if (organization.ports.journal !== undefined) await organization.ports.journal.prepare()
    return redisOperate(
      organization,
      name,
      input,
      captured,
      undefined,
      async (actual) => {
        organization.environment.controller.assertLive()
        throwIfAborted(signal)
        return organization.environment.driver.withConnection((connection) =>
          run(actual, (args) => {
            throwIfAborted(signal)
            return redisCommand(organization.environment, connection, args, organization.orgId)
          })
        )
      },
      count,
      keys
    )
  }).finally(finish)
}
/** Original native execution state is explicit across WATCH, EXEC and connection unwind. */
type IRedisNativeAttempt<R> = {
  /** The fixed org supplies original native layout and accepted lifetime. */
  organization: IRedisOrganizationContext
  /** Canonical concurrency context owns the unchanged retry and cancellation budget. */
  context: IConcurrencyAttemptContext
  /** The injected driver owns this real connection until native cleanup settles. */
  connection: IRedisConnection
  /** Native command observation uses this same connection and organization. */
  send: (args: readonly string[]) => Promise<unknown>
  /** Original lock evidence remains scoped to this native attempt. */
  locks: ReturnType<typeof createRedisLocks>
  /** Only this draft generates native changes and journal facts. */
  draft: RedisDraft
  /** Known native settlement distinguishes committed and zero-write conflict results. */
  outcome: IConcurrencyAttempt<R> | undefined
  /** The first actual failure survives all native cleanup failures. */
  primary: unknown
  /** Explicit failure state also distinguishes a thrown undefined value. */
  failed: boolean
  /** An issued EXEC with no classified result never emits false rollback effects. */
  ambiguous: boolean
  /** Original journal admission retains its first recorded failure. */
  journalFailure: unknown
  /** Canonical transaction registration owns selected root journal work. */
  journalRegistration:
    | ReturnType<IRedisOrganizationContext['transactionOwner']['register']>
    | undefined
}
/** Prepare native state without issuing commands or replacing the existing driver lease. */
function createRedisNativeAttempt<R>(
  organization: IRedisOrganizationContext,
  context: IConcurrencyAttemptContext,
  connection: IRedisConnection,
  privateJournal: boolean
): IRedisNativeAttempt<R> {
  const send = (args: readonly string[]) =>
      redisCommand(organization.environment, connection, args, organization.orgId),
    locks = createRedisLocks({
      layout: organization.layout,
      context,
      owner: organization.environment.controller.origin,
      label: organization.environment.label,
      maxLockMs: organization.environment.maxLockMs,
      send
    }),
    draft = new RedisDraft(
      redisObservedConnection(organization, connection),
      organization.layout,
      context,
      send,
      locks.guard,
      locks.guardVector,
      !privateJournal && organization.ports.journal?.active() === true
    )
  return {
    organization,
    context,
    connection,
    send,
    locks,
    draft,
    outcome: undefined,
    primary: undefined,
    failed: false,
    ambiguous: false,
    journalFailure: undefined,
    journalRegistration: undefined
  }
}
/** Report only genuine known settlement before native UNWATCH and lock release. */
async function redisCompleteNativeAttempt<R>(attempt: IRedisNativeAttempt<R>): Promise<void> {
  if (attempt.draft.terminal.settled) return
  attempt.draft.terminal.settled = true
  const callbacks =
    attempt.outcome?.status === 'committed'
      ? attempt.draft.terminal.committed
      : attempt.ambiguous
        ? []
        : attempt.draft.terminal.rolledBack
  for (const effect of callbacks)
    redisObserve(attempt.organization.environment, { effect }, 'effect')
  attempt.draft.terminal.committed.clear()
  attempt.draft.terminal.rolledBack.clear()
  try {
    await attempt.draft.journal?.settle?.()
  } catch (cause) {
    reportCleanupError(attempt.organization.environment.report, cause)
  }
}
/** Acquire original locks and establish journal scope before invoking business work. */
async function redisStartNativeAttempt<R>(
  attempt: IRedisNativeAttempt<R>,
  scopeOwned: boolean
): Promise<void> {
  await attempt.locks.acquire()
  redisObserve(
    attempt.organization.environment,
    redisConcurrencyStages(attempt.organization),
    'onLockAcquired',
    attempt.context.attempt,
    attempt.context.lock?.length ?? 0
  )
  await attempt.draft.start()
  if (attempt.draft.journalActive && !scopeOwned) {
    const scope = redisCreateScope(attempt.organization, attempt.draft)
    attempt.journalRegistration = attempt.organization.transactionOwner.register(scope, {
      createScope: () => redisCreateScope(attempt.organization, attempt.draft),
      context: attempt.context,
      onFailure: (failure) => {
        attempt.journalFailure ??= failure
      },
      beforeCommit: async (current) => {
        await attempt.draft.journal?.record(current)
      }
    })
    attempt.draft.journal = attempt.organization.ports.journal!.begin(scope)
  }
}
/** Drain root journal work after its original callback, before EXEC can begin. */
async function redisRunNativeCallback<R>(
  attempt: IRedisNativeAttempt<R>,
  run: (draft: RedisDraft) => Promise<R>
): Promise<R> {
  const value = await run(attempt.draft)
  if (attempt.journalRegistration) {
    attempt.journalRegistration.stopAdmission()
    if (attempt.journalFailure !== undefined) throw attempt.journalFailure
    await attempt.journalRegistration.runFinalizers()
  }
  throwIfAborted(attempt.context.signal)
  return value
}
/**
 * Recheck WATCH evidence and classify the four original EXEC outcomes without replaying unknown
 * work.
 */
async function redisCommitNativeAttempt<R>(
  attempt: IRedisNativeAttempt<R>,
  value: R
): Promise<void> {
  for (;;) {
    await attempt.locks.verify()
    // EXEC null clears every WATCH, including the guards from the original draft writes.
    for (const entry of attempt.draft.entries.values())
      if (entry.changed) await attempt.locks.guard(entry.channel, entry.key)
    for (const entry of attempt.draft.hashes.values())
      if (entry.changed) await attempt.locks.guardVector(entry.lock)
    throwIfAborted(attempt.context.signal)
    const commands = attempt.draft.commands(),
      changed = [...attempt.draft.entries.values()].filter((entry) => entry.changed)
    let change: ReturnType<typeof encodeRedisChange> | undefined
    if (commands.length === 0) {
      attempt.outcome = { status: 'committed', value }
      break
    }
    if (
      changed.length !== 0 ||
      [...attempt.draft.hashes.values()].some((entry) => entry.changed) ||
      attempt.draft.nativeRemovals.size !== 0
    ) {
      const sequence =
        replyRevision(
          await attempt.send([
            RedisCommand.hget,
            attempt.organization.layout.revisions,
            RedisSuffix.sequence
          ])
        ) + 1
      if (!Number.isSafeInteger(sequence)) throw redisError(RedisErrorCode.decodeFailed)
      change = encodeRedisChange(
        attempt.organization.layout,
        attempt.organization.environment.controller.origin,
        sequence,
        changed,
        [...attempt.draft.hashes.values()].some((entry) => entry.changed) ||
          attempt.draft.nativeRemovals.size !== 0
      )
      commands.push(
        [
          RedisCommand.hset,
          attempt.organization.layout.revisions,
          RedisSuffix.sequence,
          String(sequence)
        ],
        [RedisCommand.publish, attempt.organization.layout.changes, change.wire]
      )
      if (attempt.organization.environment.durableMaxLen !== undefined)
        commands.push([
          RedisCommand.xadd,
          attempt.organization.layout.durableChanges,
          RedisCommand.maxlen,
          '~',
          String(attempt.organization.environment.durableMaxLen),
          '*',
          RedisSuffix.changeField,
          change.wire
        ])
    }
    throwIfAborted(attempt.context.signal)
    let replies: Awaited<ReturnType<IRedisConnection['exec']>>
    try {
      attempt.ambiguous = true
      replies = await redisExec(
        attempt.organization.environment,
        attempt.connection,
        commands,
        attempt.organization.orgId
      )
    } catch (error) {
      attempt.organization.environment.poison = normalizeRedisError(error)
      throw attempt.organization.environment.poison
    }
    if (replies !== null) {
      try {
        validateRedisExec(replies, commands.length)
      } catch (error) {
        attempt.organization.environment.poison = normalizeRedisError(error)
        throw attempt.organization.environment.poison
      }
      attempt.ambiguous = false
      if (change) attempt.organization.environment.controller.publishExternal(change.change)
      attempt.outcome = { status: 'committed', value }
      break
    }
    attempt.ambiguous = false
    attempt.organization.environment.core.emit(RedisOperation.onWatchConflict, () => ({
      backendId: attempt.organization.environment.core.getBackendId(),
      backend: RedisText.backend,
      orgId: attempt.organization.orgId,
      keyCount:
        attempt.draft.entries.size +
        attempt.draft.ranges.size +
        attempt.draft.hashes.size +
        attempt.draft.nativeRemovals.size
    }))
    await attempt.locks.verify()
    if (!(await attempt.draft.unchanged())) {
      const keys = attempt.context.lock ?? [
        ...[...attempt.draft.hashes.values()].map((entry) => entry.lock),
        ...[...attempt.draft.entries.values()].flatMap((entry) =>
          entry.channel === 'bytes' && typeof entry.key !== 'string'
            ? []
            : snapshotConcurrencyLockKeys(
                [{ channel: entry.channel, key: entry.key }],
                RedisText.backend
              ).keys
        )
      ]
      attempt.outcome = { status: 'conflict', phase: 'commit', keys, holder: undefined }
      break
    }
    redisObserve(
      attempt.organization.environment,
      redisConcurrencyStages(attempt.organization),
      'onRetry',
      attempt.context.attempt,
      1,
      'physical'
    )
    await attempt.context.waitPhysical(sleep(1, { signal: attempt.context.signal }))
  }
}
/** Unwind the real native connection after terminal effects and preserve first-error identity. */
async function redisFinishNativeAttempt<R>(
  attempt: IRedisNativeAttempt<R>
): Promise<IConcurrencyAttempt<R>> {
  attempt.journalRegistration?.stopAdmission()
  await redisCompleteNativeAttempt(attempt)
  attempt.journalRegistration?.close()
  const cleanup: unknown[] = []
  try {
    await attempt.send([RedisCommand.unwatch])
  } catch (error) {
    cleanup.push(error)
  }
  try {
    await attempt.locks.release()
    redisObserve(
      attempt.organization.environment,
      redisConcurrencyStages(attempt.organization),
      'onLockReleased',
      attempt.context.attempt,
      attempt.context.lock?.length ?? 0
    )
  } catch (error) {
    cleanup.push(error)
  }
  for (const effect of attempt.draft.terminal.ended)
    redisObserve(attempt.organization.environment, { effect }, 'effect')
  attempt.draft.terminal.ended.clear()
  if (cleanup.length !== 0)
    throw redisError(
      RedisErrorCode.failed,
      new AggregateError(
        attempt.failed ? [attempt.primary, ...cleanup] : cleanup,
        RedisText.failed,
        {
          cause: attempt.failed ? attempt.primary : cleanup[0]
        }
      )
    )
  if (attempt.failed) throw attempt.primary
  return attempt.outcome!
}
/** The native attempt keeps lifecycle, callback, commit and cleanup as separate named jobs. */
async function redisExecuteNativeAttempt<R>(
  attempt: IRedisNativeAttempt<R>,
  run: (draft: RedisDraft) => Promise<R>,
  scopeOwned: boolean
): Promise<IConcurrencyAttempt<R>> {
  try {
    await redisStartNativeAttempt(attempt, scopeOwned)
    const value = await redisRunNativeCallback(attempt, run)
    await redisCommitNativeAttempt(attempt, value)
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === StorageContractErrorCode.lockLost)
      redisObserve(
        attempt.organization.environment,
        redisConcurrencyStages(attempt.organization),
        'onLockLost',
        attempt.context.attempt,
        attempt.context.lock?.length ?? 0
      )
    if (error instanceof RedisLockConflict)
      attempt.outcome = {
        status: 'conflict',
        phase: 'acquire',
        keys: error.keys,
        holder: error.holder
      }
    else {
      attempt.failed = true
      attempt.primary = error
    }
  }
  return redisFinishNativeAttempt(attempt)
}
/** The original driver lends exactly one connection until the complete native attempt settles. */
async function redisNativeAttempt<R>(
  organization: IRedisOrganizationContext,
  context: IConcurrencyAttemptContext,
  run: (draft: RedisDraft) => Promise<R>,
  scopeOwned = false,
  privateJournal = false
): Promise<IConcurrencyAttempt<R>> {
  redisAssertWrite(organization.environment)
  if (
    context.lock?.some(
      (key) =>
        key.channel === 'rdf' ||
        (key.channel === 'vector' && !organization.environment.vectorFactory)
    )
  )
    unsupported()
  return organization.environment.driver.withConnection((connection) =>
    redisExecuteNativeAttempt(
      createRedisNativeAttempt<R>(organization, context, connection, privateJournal),
      run,
      scopeOwned
    )
  )
}

/** Original draft facts expose canonical point identities without retaining another key set. */
function redisDraftKeys(
  organization: IRedisOrganizationContext,
  draft: RedisDraft
): readonly ILockKey[] {
  return snapshotConcurrencyLockKeys(
    [
      ...[...draft.entries.values()].flatMap((entry) =>
        entry.channel === 'bytes' && typeof entry.key !== 'string'
          ? []
          : [{ channel: entry.channel, key: entry.key }]
      ),
      ...[...draft.hashes.values()].map((entry) => entry.lock)
    ],
    RedisText.backend
  ).keys
}
/** One logical root write retains prepared input and actual native observation across attempts. */
type IRedisWriteExecution<I, P, R> = {
  /** Original organization belongs to this accepted logical write, not another attempt. */
  organization: IRedisOrganizationContext
  /** Original name belongs to this accepted logical write, not another attempt. */
  name: string
  /** Original input belongs to this accepted logical write, not another attempt. */
  input: I
  /** Original ctx belongs to this accepted logical write, not another attempt. */
  ctx: IOperationContext | undefined
  /** Original capture belongs to this accepted logical write, not another attempt. */
  capture: (input: I) => P
  /** Original keys belongs to this accepted logical write, not another attempt. */
  keys: (input: P) => readonly ILockKey[]
  /** Original run belongs to this accepted logical write, not another attempt. */
  run: (draft: RedisDraft, input: P, context: IConcurrencyAttemptContext) => Promise<R>
  /** Original count belongs to this accepted logical write, not another attempt. */
  count: number | undefined
  /** Original policy belongs to this accepted logical write, not another attempt. */
  policy: IConcurrencyPolicy | undefined
  /** Original finish belongs to this accepted logical write, not another attempt. */
  finish: () => void
  /** Original actual belongs to this accepted logical write, not another attempt. */
  actual: P
  /** Original observedInput belongs to this accepted logical write, not another attempt. */
  observedInput: I
  /** Original observedDraft belongs to this accepted logical write, not another attempt. */
  observedDraft: RedisDraft | undefined
  /** Original observing belongs to this accepted logical write, not another attempt. */
  observing: boolean
}
/** Execute the original pipeline/concurrency loop using only this explicit logical write state. */
function redisExecuteWrite<I, P, R>(execution: IRedisWriteExecution<I, P, R>): Promise<R> {
  return runWithConcurrency<R>(
    {
      store: execution.organization.store,
      options: execution.ctx ?? {},
      policy: execution.policy,
      ...(execution.organization.ports.journal === undefined
        ? {}
        : { prepare: () => execution.organization.ports.journal!.prepare() }),
      execute: (context, proceed) =>
        redisOperate<I, Awaited<R>>(
          execution.organization,
          execution.name,
          execution.input,
          context,
          undefined,
          async (prepared): Promise<Awaited<R>> => {
            execution.observedInput = prepared
            execution.actual = execution.capture(prepared)
            return (await proceed()) as Awaited<R>
          },
          execution.count,
          undefined,
          true
        ),
      lock: () => execution.keys(execution.actual)
    },
    {
      attempt: (context) =>
        redisNativeAttempt(execution.organization, context, (draft) => {
          if (execution.observing) execution.observedDraft = draft
          return execution.run(draft, execution.actual, context)
        })
    }
  ).finally(execution.finish)
}
/** Keep completion telemetry on the original execution observer and exact final native draft. */
function redisObserveWrite<I, P, R>(execution: IRedisWriteExecution<I, P, R>): Promise<R> {
  return execution.organization.ports.execution.observe === undefined
    ? redisExecuteWrite(execution)
    : execution.organization.ports.execution.observe(
        () => ({
          operation: execution.name,
          input: execution.observedInput,
          ctx: execution.ctx,
          keys: () =>
            execution.observedDraft === undefined
              ? []
              : redisDraftKeys(execution.organization, execution.observedDraft)
        }),
        (enabled) => {
          execution.observing = enabled
          return redisExecuteWrite(execution)
        }
      )
}
/** Admit one root write, then preserve its original native lifetime until all cleanup settles. */
function redisWrite<I, P, R>(
  organization: IRedisOrganizationContext,
  name: string,
  input: I,
  ctx: IOperationContext | undefined,
  capture: (input: I) => P,
  keys: (input: P) => readonly ILockKey[],
  run: (draft: RedisDraft, input: P, context: IConcurrencyAttemptContext) => Promise<R>,
  count?: number,
  policy?: IConcurrencyPolicy
): Promise<R> {
  redisAssertWrite(organization.environment)
  const execution: IRedisWriteExecution<I, P, R> = {
    organization,
    name,
    input,
    ctx,
    capture,
    keys,
    run,
    count,
    policy,
    finish: organization.environment.controller.beginMutation(),
    actual: undefined!,
    observedInput: input,
    observedDraft: undefined,
    observing: false
  }
  return redisObserveWrite(execution)
}

/**
 * Every caller key is detached by the original domain owner before any native connection is
 * borrowed.
 */
function redisKey(organization: IRedisOrganizationContext, input: IStorageKey): IStorageKey {
  return snapshotStorageKey(input, RedisText.backend)
}
/**
 * Every caller key is detached by the original domain owner before any native connection is
 * borrowed.
 */
function redisTextKey(organization: IRedisOrganizationContext, input: string): string {
  assertStringStorageKey(input, RedisText.backend)
  return input
}
/**
 * Every caller key is detached by the original domain owner before any native connection is
 * borrowed.
 */
function redisChannelLocks(
  organization: IRedisOrganizationContext,
  channel: IRedisChannel,
  input: IStorageKey
): readonly ILockKey[] {
  return snapshotConcurrencyLockKeys([{ channel, key: input }], RedisText.backend).keys
}
/**
 * Every caller key is detached by the original domain owner before any native connection is
 * borrowed.
 */
function redisWriteLocks(
  organization: IRedisOrganizationContext,
  input: IStorageKey
): readonly ILockKey[] {
  return snapshotConcurrencyLockKeys(
    [
      { channel: 'text', key: input },
      { channel: 'record', key: input },
      ...(typeof input === 'string' ? [{ channel: 'bytes', key: input }] : [])
    ],
    RedisText.backend
  ).keys
}
/**
 * Public empty batches validate pure options but allocate no pipeline, timer, hook or native
 * attempt.
 */
function redisEmpty<R>(
  organization: IRedisOrganizationContext,
  ctx: IOperationContext | undefined,
  value: R
): Promise<R> {
  organization.environment.controller.assertLive()
  assertOperationContext(ctx)
  const policy = (ctx as IWriteOptions | undefined)?.concurrency
  if (policy !== undefined) resolveConcurrencyPolicy(organization.store, policy)
  return Promise.resolve(value)
}
/** Complete batch value capture retains one array length and each caller field value exactly once. */
function redisCaptureEntries(
  organization: IRedisOrganizationContext,
  entries: readonly {
    readonly key: IStorageKey
    readonly value: string
    readonly ttlMs?: number
  }[]
): readonly IRedisTextInput[] {
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
  return captured
}
/** Stage replacement is captured completely and encoded before its first native read or lock check. */
function redisPrepareEntries(
  organization: IRedisOrganizationContext,
  entries: readonly IRedisTextInput[]
): readonly IRedisValueInput[] {
  return redisCaptureEntries(organization, entries).map((entry) => ({
    key: entry.key,
    wire: encodeRedisValue('text', entry.value),
    ...(entry.ttlMs === undefined ? {} : { ttlMs: entry.ttlMs })
  }))
}
/** Pure capture detaches caller-owned records and bytes before any asynchronous pipeline can wait. */
function redisCapturePoint(
  organization: IRedisOrganizationContext,
  channel: IRedisChannel,
  input: IStorageKey,
  value: unknown
): { readonly key: IStorageKey; readonly value: unknown } {
  const capturedKey = redisKey(organization, input)
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
function redisPreparePoint(
  organization: IRedisOrganizationContext,
  channel: IRedisChannel,
  input: { readonly key: IStorageKey; readonly value: unknown }
): { readonly key: IStorageKey; readonly wire: string } {
  const capturedKey = redisKey(organization, input.key)
  if (channel === 'bytes' && !isUint8Array(input.value)) throw invalidArgument()
  return { key: capturedKey, wire: encodeRedisValue(channel, input.value) }
}
/** The original org key range maps directly to native lex bounds without splicing encoded tags. */
function redisBounds(
  organization: IRedisOrganizationContext,
  range?: IKeyRange,
  prefixKey?: IStorageKey
): readonly [string, string] {
  const all = snapshotStorageOrgKeyPrefix(organization.orgId, prefixKey, RedisText.backend)
  return [
    range?.lower === undefined
      ? '[' + redisHex(all.lower)
      : (range.lowerOpen ? '(' : '[') + organization.layout.encode(range.lower),
    range?.upper === undefined
      ? '(' + redisHex(all.upper)
      : (range.upperOpen ? '(' : '[') + organization.layout.encode(range.upper)
  ]
}
/** Ordered members are fetched in native key order and missing expired points never become rows. */
async function redisPage(
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
function redisIterator(
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
async function redisRemovePrefix(
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
async function redisClearBytes(
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
function redisScoped<I, R>(
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
function redisTtlTarget(organization: IRedisOrganizationContext, target: ITtlTarget): ITtlTarget {
  const captured = snapshotStorageTtlTarget(target, RedisText.backend)
  if (captured.channel === 'vector' && !organization.environment.vectorFactory) unsupported()
  return captured
}
/** Query writes reuse the original query selection core and this same native draft. */
function redisMutate(
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
/** Every original view receives fresh closures over the same draft, never a copied old scope. */
function redisCreateScope(
  organization: IRedisOrganizationContext,
  draft: RedisDraft
): IRedisInternalScope {
  const scope: IRedisInternalScope = {
    use: (capability) => useTransactionCapability(scope, capability),
    get: (key) =>
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.get,
        () => redisTextKey(organization, key),
        async (actual) =>
          ((await draft.read('text', redisTextKey(organization, actual))) as string | undefined) ??
          null
      ),
    set: (key, value, options) =>
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.set,
        () => ({
          ...redisCapturePoint(organization, 'text', redisTextKey(organization, key), value),
          policy: readTransactionConflictPolicy(options, RedisText.backend)
        }),
        async (actual) => {
          const prepared = redisPreparePoint(organization, 'text', actual)
          await draft.write(
            'text',
            prepared.key,
            prepared.wire,
            readTransactionConflictPolicy({ conflictPolicy: actual.policy }, RedisText.backend)
          )
        }
      ),
    remove: (key) =>
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.remove,
        () => redisTextKey(organization, key),
        async (actual) => {
          await draft.remove('text', redisTextKey(organization, actual))
        }
      ),
    has: (key) =>
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.has,
        () => redisTextKey(organization, key),
        async (actual) =>
          (await draft.read('text', redisTextKey(organization, actual))) !== undefined
      ),
    getBytes: (key) =>
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.getBytes,
        () => redisTextKey(organization, key),
        async (actual) =>
          ((await draft.read('bytes', redisTextKey(organization, actual))) as
            | Uint8Array
            | undefined) ?? null
      ),
    setBytes: (key, value, options) =>
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.setBytes,
        () => ({
          ...redisCapturePoint(organization, 'bytes', redisTextKey(organization, key), value),
          policy: readTransactionConflictPolicy(options, RedisText.backend)
        }),
        async (actual) => {
          const prepared = redisPreparePoint(organization, 'bytes', actual)
          await draft.write(
            'bytes',
            prepared.key,
            prepared.wire,
            readTransactionConflictPolicy({ conflictPolicy: actual.policy }, RedisText.backend)
          )
        }
      ),
    removeBytes: (key) =>
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.removeBytes,
        () => redisTextKey(organization, key),
        async (actual) => {
          await draft.remove('bytes', redisTextKey(organization, actual))
        }
      ),
    getRecord: (input) =>
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.getRecord,
        () => redisKey(organization, input),
        (actual) => draft.read('record', redisKey(organization, actual))
      ),
    putRecord: (value, input, options) =>
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.putRecord,
        () => ({
          ...redisCapturePoint(organization, 'record', input ?? crypto.randomUUID(), value),
          policy: readTransactionConflictPolicy(options, RedisText.backend)
        }),
        async (actual) => {
          const prepared = redisPreparePoint(organization, 'record', actual)
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
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.deleteRecord,
        () => redisKey(organization, input),
        async (actual) => {
          await draft.remove('record', redisKey(organization, actual))
        }
      ),
    iterateRecords: (range) => {
      assertTransactionOwner(organization.store, scope)
      return redisIterator(organization, range, undefined, draft, scope)
    },
    getMany: (inputs) =>
      redisScoped(
        organization,
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
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.setMany,
        () => redisCaptureEntries(organization, entries),
        async (actual) => {
          const prepared = redisPrepareEntries(organization, actual)
          for (const entry of prepared)
            await draft.write('text', entry.key, entry.wire, 'conflict', entry.ttlMs)
        },
        (actual) => actual.length
      ),
    removeMany: (inputs) =>
      redisScoped(
        organization,
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
      redisScoped(
        organization,
        scope,
        draft,
        RedisOperation.removeByPrefix,
        () => redisKey(organization, prefix),
        (actual) => redisRemovePrefix(organization, 'text', redisKey(organization, actual), draft)
      ),
    [recordsApi]: {
      query: <R>() =>
        createRecordQuery<R, undefined>(
          {
            asyncDisposeKey,
            pushdown: { source: RedisText.backend, operations: [], operators: [] },
            execute: () => {
              assertTransactionOwner(organization.store, scope)
              return redisIterator(organization, undefined, undefined, draft, scope)
            },
            mutate: (request, run) =>
              redisScoped(
                organization,
                scope,
                draft,
                request.operation === 'delete'
                  ? RedisOperation.queryDelete
                  : RedisOperation.queryUpdate,
                () => request,
                (actual, current) => redisMutate(organization, draft, actual, run, current)
              )
          },
          organization.environment.core.getChainMethods('query')
        ),
      removeByPrefix: (input) =>
        redisScoped(
          organization,
          scope,
          draft,
          RedisOperation.removeByPrefix,
          () => redisKey(organization, input),
          (actual) =>
            redisRemovePrefix(organization, 'record', redisKey(organization, actual), draft)
        )
    },
    [ttlApi]: {
      expire: (target, ms) =>
        redisScoped(
          organization,
          scope,
          draft,
          RedisOperation.expire,
          () => {
            const captured = redisTtlTarget(organization, target)
            assertStorageTtlDuration(ms, RedisText.backend)
            return { target: captured, ms }
          },
          (actual) => {
            const target = redisTtlTarget(organization, actual.target)
            assertStorageTtlDuration(actual.ms, RedisText.backend)
            return target.channel === 'vector'
              ? redisSelectedVector(organization).expire(draft, target, actual.ms)
              : draft.expire(target.channel, target.key, actual.ms)
          }
        ),
      remaining: (target) =>
        redisScoped(
          organization,
          scope,
          draft,
          RedisOperation.remaining,
          () => redisTtlTarget(organization, target),
          (actual) => {
            const target = redisTtlTarget(organization, actual)
            return target.channel === 'vector'
              ? redisSelectedVector(organization).remaining(draft, target)
              : draft.remaining(target.channel, target.key)
          }
        ),
      persist: (target) =>
        redisScoped(
          organization,
          scope,
          draft,
          RedisOperation.persist,
          () => redisTtlTarget(organization, target),
          (actual) => {
            const target = redisTtlTarget(organization, actual)
            return target.channel === 'vector'
              ? redisSelectedVector(organization).expire(draft, target)
              : draft.expire(target.channel, target.key)
          }
        )
    },
    [counterApi]: {
      increment: (input, by) =>
        redisScoped(
          organization,
          scope,
          draft,
          RedisOperation.increment,
          () => {
            snapshotStorageCounterIncrement(by, RedisText.backend)
            return { key: redisTextKey(organization, input), by }
          },
          (actual) => draft.increment(redisTextKey(organization, actual.key), actual.by)
        )
    }
  }
  organization.environment.scopeDrafts.set(scope, { store: organization.store, draft })
  return scope
}
/** One user transaction owns its original logical callback, budget and completed observation. */
type IRedisTransactionExecution<R> = {
  /** Original organization remains with this transaction across native attempts. */
  organization: IRedisOrganizationContext
  /** Original callback remains with this transaction across native attempts. */
  callback: (scope: IRedisTransactionScope) => R
  /** Original options remains with this transaction across native attempts. */
  options: ITransactionOptions
  /** Original finish remains with this transaction across native attempts. */
  finish: () => void
  /** Original observedDraft remains with this transaction across native attempts. */
  observedDraft: RedisDraft | undefined
  /** Original observing remains with this transaction across native attempts. */
  observing: boolean
}
/** Canonical scope registration and first failure belong to one exact native transaction attempt. */
type IRedisTransactionAttempt<R> = {
  /** This attempt borrows the original logical transaction without another lifetime owner. */
  execution: IRedisTransactionExecution<R>
  /** Original context facts are cleared only when this native attempt finishes. */
  context: IConcurrencyAttemptContext
  /** Original registration facts are cleared only when this native attempt finishes. */
  registration: ReturnType<IRedisOrganizationContext['transactionOwner']['register']> | undefined
  /** Original stages facts are cleared only when this native attempt finishes. */
  stages: ReturnType<ReturnType<typeof redisTransactions>['forTransaction']> | undefined
  /** Original changed facts are cleared only when this native attempt finishes. */
  changed: number
  /** Original failure facts are cleared only when this native attempt finishes. */
  failure: unknown
  /** Original failed facts are cleared only when this native attempt finishes. */
  failed: boolean
}
/** Run the callback and finalizers on their original short-lived native draft views. */
async function redisRunTransactionDraft<R>(
  attempt: IRedisTransactionAttempt<R>,
  draft: RedisDraft
): Promise<Awaited<R>> {
  if (attempt.execution.observing) attempt.execution.observedDraft = draft
  const scope = redisCreateScope(attempt.execution.organization, draft)
  attempt.registration = attempt.execution.organization.transactionOwner.register(scope, {
    createScope: () => redisCreateScope(attempt.execution.organization, draft),
    context: attempt.context,
    onFailure: (error) => {
      if (!attempt.failed) {
        attempt.failed = true
        attempt.failure = error
      }
    },
    beforeCommit: async (current) => {
      redisObserve(
        attempt.execution.organization.environment,
        redisTransactions(attempt.execution.organization).forTransaction(current),
        'beforeCommit'
      )
      await draft.journal?.record(current)
    }
  })
  if (draft.journalActive)
    draft.journal = attempt.execution.organization.ports.journal!.begin(scope)
  attempt.stages = redisTransactions(attempt.execution.organization).forTransaction(scope)
  redisObserve(
    attempt.execution.organization.environment,
    redisTransactions(attempt.execution.organization),
    'beforeTransaction'
  )
  redisObserve(attempt.execution.organization.environment, attempt.stages, 'onTransactionStart')
  let value: Awaited<R> | undefined
  try {
    value = (await attempt.execution.callback(scope)) as Awaited<R>
  } catch (error) {
    if (!attempt.failed) {
      attempt.failed = true
      attempt.failure = normalizeRedisTransactionFailure(error)
    }
  }
  attempt.registration.stopAdmission()
  if (attempt.failed) throw attempt.failure
  await attempt.registration.runFinalizers()
  throwIfAborted(attempt.context.signal)
  attempt.changed = [...draft.entries.values()].filter((entry) => entry.changed).length
  return value as Awaited<R>
}
/** Classify native settlement, close original iterators and preserve primary rollback errors. */
async function redisAttemptTransaction<R>(
  execution: IRedisTransactionExecution<R>,
  context: IConcurrencyAttemptContext
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  const attempt: IRedisTransactionAttempt<R> = {
    execution,
    context,
    registration: undefined,
    stages: undefined,
    changed: 0,
    failure: undefined,
    failed: false
  }
  try {
    const outcome = await redisNativeAttempt<Awaited<R>>(
      attempt.execution.organization,
      attempt.context,
      (draft) => redisRunTransactionDraft(attempt, draft),
      true
    )
    if (outcome.status === 'committed')
      redisObserve(
        attempt.execution.organization.environment,
        attempt.stages,
        'afterCommit',
        attempt.changed
      )
    else
      redisObserve(
        attempt.execution.organization.environment,
        attempt.stages,
        'afterRollback',
        StorageContractErrorCode.writeConflict
      )
    return outcome
  } catch (error) {
    attempt.registration?.stopAdmission()
    let failure = normalizeRedisTransactionFailure(error)
    try {
      await attempt.registration?.closeIterators()
    } catch (cleanup) {
      if (cleanup !== error)
        failure = redisError(
          RedisErrorCode.transactionFailed,
          new AggregateError([error, cleanup], RedisText.transactionFailed, {
            cause: error
          })
        )
    }
    redisObserve(
      attempt.execution.organization.environment,
      attempt.stages,
      'afterRollback',
      Reflect.get(failure, 'code')
    )
    throw failure
  } finally {
    attempt.registration?.close()
    redisObserve(attempt.execution.organization.environment, attempt.stages, 'onTransactionClose')
  }
}
/** Run the original transaction pipeline and shared logical concurrency owner unchanged. */
function redisExecuteTransaction<R>(execution: IRedisTransactionExecution<R>): Promise<Awaited<R>> {
  return runWithConcurrency<Awaited<R>>(
    {
      store: execution.organization.store,
      options: execution.options,
      ...(execution.organization.ports.journal === undefined
        ? {}
        : { prepare: () => execution.organization.ports.journal!.prepare() }),
      executeAttempt: (context, proceed) =>
        redisOperate(
          execution.organization,
          RedisOperation.transaction,
          {},
          context,
          undefined,
          proceed,
          undefined,
          undefined,
          true
        )
    },
    {
      attempt: (context) => redisAttemptTransaction(execution, context)
    }
  ).finally(execution.finish)
}
/** Observe the complete original transaction without another callback or attempt. */
function redisObserveTransaction<R>(execution: IRedisTransactionExecution<R>): Promise<Awaited<R>> {
  return execution.organization.ports.execution.observe === undefined
    ? redisExecuteTransaction(execution)
    : execution.organization.ports.execution.observe(
        () => ({
          operation: RedisOperation.transaction,
          input: {},
          keys: () =>
            execution.observedDraft === undefined
              ? []
              : redisDraftKeys(execution.organization, execution.observedDraft)
        }),
        (enabled) => {
          execution.observing = enabled
          return redisExecuteTransaction(execution)
        }
      )
}
/** Validate callback before taking the original accepted-work lease. */
function redisTransaction<R>(
  organization: IRedisOrganizationContext,
  callback: (scope: IRedisTransactionScope) => R,
  options: ITransactionOptions = {}
): Promise<Awaited<R>> {
  assertTransactionCallback(callback, RedisText.backend)
  redisAssertWrite(organization.environment)
  const execution: IRedisTransactionExecution<R> = {
    organization,
    callback,
    options,
    finish: organization.environment.controller.beginMutation(),
    observedDraft: undefined,
    observing: false
  }
  return redisObserveTransaction(execution)
}

/** Ordinary point readers share the same native wire decoding as transaction reads. */
function redisGet(
  organization: IRedisOrganizationContext,
  channel: IRedisChannel,
  input: IStorageKey,
  ctx?: IOperationContext
): Promise<unknown> {
  /** The one native key snapshot also supplies optional completed telemetry. */
  let captured = redisKey(organization, input)
  return redisRead(
    organization,
    channel === 'text'
      ? RedisOperation.get
      : channel === 'bytes'
        ? RedisOperation.getBytes
        : RedisOperation.getRecord,
    captured,
    ctx,
    async (actual, send) => {
      captured = redisKey(organization, actual)
      const raw = replyOptionalString(
        await send([RedisCommand.get, organization.layout.value(channel, captured)])
      )
      return raw === undefined ? undefined : decodeRedisValue(channel, raw)
    },
    1,
    () => redisChannelLocks(organization, channel, captured)
  )
}
/** Writes capture portable data before pipeline or connection acquisition. */
function redisPut(
  organization: IRedisOrganizationContext,
  channel: IRedisChannel,
  input: IStorageKey,
  value: unknown,
  ctx?: IWriteOptions
): Promise<void> {
  const captured = redisCapturePoint(organization, channel, input, value)
  return redisWrite(
    organization,
    channel === 'text'
      ? RedisOperation.set
      : channel === 'bytes'
        ? RedisOperation.setBytes
        : RedisOperation.putRecord,
    captured,
    ctx,
    (actual) => redisPreparePoint(organization, channel, actual),
    (actual) => redisWriteLocks(organization, actual.key),
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
function redisRemove(
  organization: IRedisOrganizationContext,
  channel: IRedisChannel,
  input: IStorageKey,
  ctx?: IOperationContext
): Promise<void> {
  return redisWrite(
    organization,
    channel === 'text'
      ? RedisOperation.remove
      : channel === 'bytes'
        ? RedisOperation.removeBytes
        : RedisOperation.deleteRecord,
    redisKey(organization, input),
    ctx,
    (...args) => redisKey(organization, ...args),
    (actual) => redisChannelLocks(organization, channel, actual),
    async (draft, actual) => {
      await draft.remove(channel, actual)
    },
    1
  )
}
/** Wrapping only observation retains the genuine native client, original lease and reply evidence. */
function redisObservedConnection(
  organization: IRedisOrganizationContext,
  connection: IRedisConnection
): IRedisConnection {
  const binary = connection.binaryCommand
  return {
    getClient: () => connection.getClient(),
    command: (args) => redisCommand(organization.environment, connection, args, organization.orgId),
    exec: (commands) =>
      redisExec(organization.environment, connection, commands, organization.orgId),
    ...(binary
      ? {
          binaryCommand: (args: Parameters<NonNullable<IRedisConnection['binaryCommand']>>[0]) =>
            redisObserveNative(
              organization.environment,
              args[0] as string,
              organization.orgId,
              () => connection.binaryCommand!(args)
            )
        }
      : {})
  }
}
/** Standard clear keeps its scope; org removal also covers every known native business layout. */
function redisClear(
  organization: IRedisOrganizationContext,
  native: boolean,
  ctx?: ITransactionOptions
): Promise<void> {
  return redisWrite(
    organization,
    RedisOperation.clearAll,
    {},
    ctx,
    (input) => input,
    () => [],
    async (draft) => {
      await redisRemovePrefix(organization, 'text', undefined, draft)
      await redisRemovePrefix(organization, 'record', undefined, draft)
      await redisClearBytes(organization, draft)
      await draft.clearVectorOrg()
      if (native) await draft.clearNativeOrg()
    }
  )
}
/** Capture one selected API for this exact original org store without rerunning a Feature factory. */
function redisSelectedVector(organization: IRedisOrganizationContext): IRedisVectorBinding {
  return (organization.vectorBinding ??= organization.environment.vectorFactory!(
    organization.store
  ))
}
/** Capture one selected API for this exact original org store without rerunning a Feature factory. */
function redisConfigureFeatures(organization: IRedisOrganizationContext): void {
  if (
    !organization.allOrganizations &&
    organization.environment.vectorFactory &&
    !organization.vectorPublication
  ) {
    organization.vectorPublication = organization.installer.prepare([
      implement(vector, redisSelectedVector(organization).api)
    ])
    organization.vectorPublication.publish()
  }
  if (
    !organization.allOrganizations &&
    organization.environment.durableFactory &&
    !organization.durablePublication
  ) {
    organization.durablePublication = organization.installer.prepare([
      implement(durableChangeFeed, organization.environment.durableFactory(organization.store))
    ])
    organization.durablePublication.publish()
  }
}
/** Capture one selected API for this exact original org store without rerunning a Feature factory. */
function redisReleaseFeatures(organization: IRedisOrganizationContext): void {
  organization.durablePublication?.release()
  organization.vectorPublication?.release()
}
/** Assemble the original nativeDriver methods from explicit organization state. */
function createRedisNativeDriver(organization: IRedisOrganizationContext): IRedisDriver {
  return {
    command: (args) =>
      redisObserveNative(organization.environment, args[0]!, organization.orgId, () =>
        organization.environment.driver.command(args)
      ),
    withConnection: (run) =>
      organization.environment.driver.withConnection((connection) =>
        run(redisObservedConnection(organization, connection))
      ),
    subscribe: (channel, listener) =>
      redisObserveNative(organization.environment, RedisCommand.subscribe, organization.orgId, () =>
        organization.environment.driver.subscribe(channel, listener)
      )
  }
}
/**
 * One borrowed native resource retains its original abort subscription and underlying Promise
 * identity.
 */
class RedisNativeResource implements IStorageResource {
  /** The existing installation set owns accepted resources until native cleanup settles. */
  readonly #organization: IRedisOrganizationContext
  /** The Feature's actual resource owns the original cleanup, not a new lifecycle. */
  readonly #underlying: IStorageResource
  /** The original merged signal remains owned until this native resource releases. */
  readonly #merged: ReturnType<typeof mergeSignals>
  /** Only the existing abort listener is removed after underlying cleanup settles. */
  #off: () => void = () => {}
  /** Register the original accepted resource before subscribing to its cancellation signal. */
  constructor(
    organization: IRedisOrganizationContext,
    underlying: IStorageResource,
    merged: ReturnType<typeof mergeSignals>
  ) {
    this.#organization = organization
    this.#underlying = underlying
    this.#merged = merged
    organization.environment.resources.add(this)
    this.#off = subscribeToAbort(
      merged.signal,
      () => {
        void this[asyncDisposeKey]()
      },
      organization.environment.report
    )
  }
  /** Release borrowed references after either successful or failed native cleanup. */
  #release(): void {
    this.#off()
    this.#merged.dispose()
    this.#organization.environment.resources.delete(this)
  }
  /** Return the underlying explicit Promise unchanged and observe its settlement only for release. */
  readonly dispose = (): Promise<void> => {
    const pending = this.#underlying.dispose()
    void pending.then(
      () => this.#release(),
      () => this.#release()
    )
    return pending
  }
  /**
   * Return the underlying symbolic Promise unchanged, preserving its original report-only
   * semantics.
   */
  readonly [asyncDisposeKey] = (): Promise<void> => {
    const pending = this.#underlying[asyncDisposeKey]()
    void pending.then(
      () => this.#release(),
      () => this.#release()
    )
    return pending
  }
}
/** Assemble the original native methods from explicit organization state. */
function createRedisNativePort(organization: IRedisOrganizationContext): IRedisNativeFeaturePort {
  return {
    driver: organization.nativeDriver,
    layout: organization.layout,
    assertLive: () => organization.environment.controller.assertLive(),
    beginOperation: () => organization.environment.controller.beginMutation(),
    own: (resource) => {
      organization.environment.controller.assertLive()
      organization.environment.resources.add(resource)
      return () => {
        organization.environment.resources.delete(resource)
      }
    },
    chain: () =>
      organization.environment.core.getChainMethods('vector') as Record<never, never> | undefined,
    watch: (ctx) =>
      createBackendChangeIterator(organization.environment.controller, {
        orgId: organization.orgId,
        channel: 'all',
        ctx
      }),
    mutate: (name, input, ctx, capture, keys, run, policy) =>
      redisWrite(organization, name, input, ctx, capture, keys, run, undefined, policy),
    enableVector: (create) => {
      organization.environment.vectorFactory = create
      organization.vectorBinding ??= create(organization.store)
    },
    now: () => organization.environment.core.featureExpose.getScheduler().now(),
    closingSignal: organization.environment.controller.closingSignal,
    allOrganizations: organization.allOrganizations,
    enableDurable: (maxLen, create) => {
      if (
        !Number.isSafeInteger(maxLen) ||
        maxLen < 1 ||
        (organization.environment.durableMaxLen !== undefined &&
          organization.environment.durableMaxLen !== maxLen)
      )
        throw invalidArgument()
      organization.environment.durableMaxLen = maxLen
      organization.environment.durableFactory = create
    },
    run: (name, input, ctx, writing, run, pipeline = true) => {
      if (writing) redisAssertWrite(organization.environment)
      else organization.environment.controller.assertLive()
      const finish = organization.environment.controller.beginMutation()
      return withAbort(ctx, async (signal, context) => {
        if (organization.ports.journal !== undefined) await organization.ports.journal.prepare()
        const invoke = (actual: typeof input) => {
          throwIfAborted(signal)
          return organization.nativeDriver.withConnection((connection) =>
            run(actual, connection, organization.layout, signal)
          )
        }
        return pipeline
          ? redisOperate(organization, name, input, context, undefined, invoke)
          : observeStorageBatch(
              redisOperations(organization),
              organization.environment.core.featureExpose.getScheduler(),
              name,
              undefined,
              () => invoke(input)
            )
      }).finally(finish)
    },
    resource: (name, input, ctx, run, pipeline = true) => {
      organization.environment.controller.assertLive()
      const finish = organization.environment.controller.beginMutation()
      let merged: ReturnType<typeof mergeSignals>
      try {
        merged = mergeSignals(ctx, organization.environment.report)
      } catch (error) {
        finish()
        throw error
      }
      const invoke = async (actual: typeof input): Promise<IStorageResource> => {
        if (organization.ports.journal !== undefined) await organization.ports.journal.prepare()
        throwIfAborted(merged.signal)
        const underlying = await run(actual, organization.layout, merged.signal)
        const resource = new RedisNativeResource(organization, underlying, merged)
        try {
          throwIfAborted(merged.signal)
        } catch (error) {
          await resource[asyncDisposeKey]()
          throw error
        }
        return resource
      }
      const pending = pipeline
        ? redisOperate(organization, name, input, merged.context, undefined, invoke)
        : observeStorageBatch(
            redisOperations(organization),
            organization.environment.core.featureExpose.getScheduler(),
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
    report: (error) => reportCleanupError(organization.environment.report, error)
  }
}
/** Assemble the original base methods from explicit organization state. */
function createRedisBase(
  organization: IRedisOrganizationContext
): IRedisNativeStore & { readonly [nativeFeaturePort]: IRedisNativeFeaturePort } {
  return {
    [nativeFeaturePort]: createRedisNativePort(organization),
    backend: RedisText.backend,
    capabilities: redisCapabilities,
    dispose: organization.environment.controller.dispose,
    [asyncDisposeKey]: () =>
      (organization.symbolic ??= organization.environment.controller
        .dispose()
        .then(undefined, (error) => reportCleanupError(organization.environment.report, error))),
    get: (input, ctx) =>
      redisGet(organization, 'text', redisTextKey(organization, input), ctx).then(
        (value) => (value as string | undefined) ?? null
      ),
    set: (input, value, ctx) =>
      redisPut(organization, 'text', redisTextKey(organization, input), value, ctx),
    remove: (input, ctx) =>
      redisRemove(organization, 'text', redisTextKey(organization, input), ctx),
    has: (input, ctx) =>
      redisGet(organization, 'text', redisTextKey(organization, input), ctx).then(
        (value) => value !== undefined
      ),
    getBytes: (input, ctx) =>
      redisGet(organization, 'bytes', redisTextKey(organization, input), ctx).then(
        (value) => (value as Uint8Array | undefined) ?? null
      ),
    setBytes: (input, value, ctx) => {
      if (!isUint8Array(value)) throw invalidArgument()
      return redisPut(organization, 'bytes', redisTextKey(organization, input), value, ctx)
    },
    removeBytes: (input, ctx) =>
      redisRemove(organization, 'bytes', redisTextKey(organization, input), ctx),
    getRecord: (input, ctx) => redisGet(organization, 'record', input, ctx),
    putRecord: async (value, input, ctx) => {
      const captured = redisKey(organization, input ?? crypto.randomUUID())
      await redisPut(organization, 'record', captured, value, ctx)
      return captured
    },
    deleteRecord: (input, ctx) => redisRemove(organization, 'record', input, ctx),
    keys: (ctx) =>
      redisRead(organization, RedisOperation.keys, {}, ctx, async (_input, send) => {
        const result: string[] = [],
          [initial, upper] = redisBounds(organization)
        let lower = initial
        for (;;) {
          const next = await redisPage(organization, 'text', send, lower, upper, 128)
          for (const [key] of next.rows) if (typeof key === 'string') result.push(key)
          if (next.done || next.last === undefined) return result
          lower = '(' + next.last
        }
      }),
    clearValues: (ctx) =>
      redisWrite(
        organization,
        RedisOperation.clearValues,
        {},
        ctx,
        (input) => input,
        () => [],
        async (draft) => {
          await redisRemovePrefix(organization, 'text', undefined, draft)
        }
      ),
    clearBytes: (ctx) =>
      redisWrite(
        organization,
        RedisOperation.clearBytes,
        {},
        ctx,
        (input) => input,
        () => [],
        (draft) => redisClearBytes(organization, draft)
      ),
    clearRecords: (ctx) =>
      redisWrite(
        organization,
        RedisOperation.clearRecords,
        {},
        ctx,
        (input) => input,
        () => [],
        async (draft) => {
          await redisRemovePrefix(organization, 'record', undefined, draft)
        }
      ),
    clearAll: (ctx) => redisClear(organization, false, ctx),
    iterateRecords: (range, ctx) => redisIterator(organization, range, ctx),
    transaction: (...args) => redisTransaction(organization, ...args),
    tx: () => {
      organization.environment.controller.assertLive()
      return createTransactionBuilder(
        organization.store,
        undefined,
        organization.environment.core.getChainMethods('tx')
      )
    },
    inspectLocks: (ctx) => {
      organization.environment.controller.assertLive()
      const finish = organization.environment.controller.beginMutation()
      return runWithConcurrency<readonly ILockHolding[]>(
        {
          store: organization.store,
          options: ctx ?? {},
          execute: (context, proceed) =>
            redisOperate(organization, RedisOperation.inspectLocks, {}, context, undefined, proceed)
        },
        {
          attempt: async (context) => {
            const stages = redisConcurrencyStages(organization)
            redisObserve(organization.environment, stages, 'beforeLockInspect')
            try {
              const value = await organization.environment.driver.withConnection((connection) =>
                createRedisLocks({
                  layout: organization.layout,
                  context,
                  owner: organization.environment.controller.origin,
                  label: organization.environment.label,
                  maxLockMs: organization.environment.maxLockMs,
                  send: (args) =>
                    redisCommand(organization.environment, connection, args, organization.orgId)
                }).inspect()
              )
              redisObserve(organization.environment, stages, 'afterLockInspect', value.length)
              return { status: 'committed' as const, value }
            } catch (error) {
              redisObserve(
                organization.environment,
                stages,
                'onLockInspectError',
                error instanceof Error ? Reflect.get(error, 'code') : undefined
              )
              throw error
            }
          }
        }
      ).finally(finish)
    },
    subscribeChanges: (listener) => {
      organization.environment.controller.assertLive()
      return organization.environment.controller.subscribe((change) => {
        if (organization.allOrganizations || change.orgId === organization.orgId)
          return listener(change)
      })
    },
    watch: (input, ctx) =>
      createBackendChangeIterator(organization.environment.controller, {
        orgId: organization.orgId,
        channel: 'value',
        key: redisTextKey(organization, input),
        ctx,
        execute: (advance, context) =>
          redisOperate(organization, RedisOperation.watch, {}, context, undefined, advance)
      })
  }
}
/** Assemble the original keyValue methods from explicit organization state. */
function createRedisKeyValue(
  organization: IRedisOrganizationContext,
  base: IRedisNativeStore
): IKeyValueApi {
  return {
    ...base,
    getMany: (inputs, ctx) => {
      const captured = snapshotStorageBatchKeys(inputs, RedisText.backend).map((entry) => entry.key)
      if (captured.length === 0) return redisEmpty(organization, ctx, [])
      /** The native batch's canonical snapshot supplies keys without re-reading pipeline input. */
      let prepared: ReturnType<typeof snapshotStorageBatchKeys> | undefined
      return redisRead(
        organization,
        RedisOperation.getMany,
        captured,
        ctx,
        async (actual, send) => {
          prepared = snapshotStorageBatchKeys(actual, RedisText.backend)
          const values = await send([
            RedisCommand.mget,
            ...prepared.map((entry) => organization.layout.value('text', entry.key))
          ])
          if (!Array.isArray(values) || values.length !== prepared.length)
            throw redisError(RedisErrorCode.decodeFailed, values)
          return values.map((value) => {
            const raw = replyOptionalString(value)
            return raw === undefined ? undefined : (decodeRedisValue('text', raw) as string)
          })
        },
        captured.length,
        () => (prepared ?? []).map((entry) => ({ channel: 'text', key: entry.key }))
      )
    },
    setMany: (entries, ctx) => {
      const captured = redisCaptureEntries(organization, entries)
      if (captured.length === 0) return redisEmpty(organization, ctx, undefined)
      return redisWrite(
        organization,
        RedisOperation.setMany,
        captured,
        ctx,
        (...args) => redisPrepareEntries(organization, ...args),
        (actual) => actual.flatMap((entry) => redisWriteLocks(organization, entry.key)),
        async (draft, actual) => {
          for (const entry of actual)
            await draft.write('text', entry.key, entry.wire, 'conflict', entry.ttlMs)
        },
        captured.length
      )
    },
    removeMany: (inputs, ctx) => {
      const captured = snapshotStorageBatchKeys(inputs, RedisText.backend).map((entry) => entry.key)
      if (captured.length === 0) return redisEmpty(organization, ctx, 0)
      return redisWrite(
        organization,
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
      redisWrite(
        organization,
        RedisOperation.removeByPrefix,
        redisKey(organization, input),
        ctx,
        (...args) => redisKey(organization, ...args),
        () => [],
        (draft, actual) => redisRemovePrefix(organization, 'text', actual, draft)
      )
  }
}
/** Assemble the original recordApi methods from explicit organization state. */
function createRedisRecordApi(organization: IRedisOrganizationContext): IRecordsApi<unknown, true> {
  return {
    query: <R>() =>
      createRecordQuery<R>(
        {
          asyncDisposeKey,
          pushdown: { source: RedisText.backend, operations: [], operators: [] },
          execute: ({ ctx }) => redisIterator(organization, undefined, ctx),
          watch: ({ ctx }) =>
            createBackendChangeIterator(organization.environment.controller, {
              orgId: organization.orgId,
              channel: 'record',
              ctx
            }),
          mutate: (request, run) =>
            redisWrite(
              organization,
              request.operation === 'delete'
                ? RedisOperation.queryDelete
                : RedisOperation.queryUpdate,
              request,
              request.ctx,
              (input) => input,
              () => [],
              (draft, actual) => redisMutate(organization, draft, actual, run),
              undefined,
              request.concurrency
            )
        },
        organization.environment.core.getChainMethods('query')
      ),
    removeByPrefix: (input, ctx) =>
      redisWrite(
        organization,
        RedisOperation.removeByPrefix,
        redisKey(organization, input),
        ctx,
        (...args) => redisKey(organization, ...args),
        () => [],
        (draft, actual) => redisRemovePrefix(organization, 'record', actual, draft)
      )
  }
}
/** Assemble the original timeToLive methods from explicit organization state. */
function createRedisTtlApi(organization: IRedisOrganizationContext): ITtlApi {
  return {
    expire: (input, ms, ctx) => {
      const target = redisTtlTarget(organization, input)
      assertStorageTtlDuration(ms, RedisText.backend)
      return redisWrite(
        organization,
        RedisOperation.expire,
        { target, ms },
        ctx,
        (actual) => {
          const target = redisTtlTarget(organization, actual.target)
          assertStorageTtlDuration(actual.ms, RedisText.backend)
          return { target, ms: actual.ms }
        },
        (actual) => [actual.target],
        (draft, actual) =>
          actual.target.channel === 'vector'
            ? redisSelectedVector(organization).expire(draft, actual.target, actual.ms)
            : draft.expire(actual.target.channel, actual.target.key, actual.ms),
        1
      )
    },
    remaining: (input, ctx) => {
      const target = redisTtlTarget(organization, input)
      if (target.channel === 'vector')
        return redisSelectedVector(organization).remainingRoot(target, ctx)
      /** Native TTL lookup and telemetry share the same actual canonical target. */
      let captured: ITtlTarget = target
      return redisRead(
        organization,
        RedisOperation.remaining,
        target,
        ctx,
        async (actual, send) => {
          captured = redisTtlTarget(organization, actual)
          if (captured.channel === 'vector') unsupported()
          const value = replyInteger(
            await send([
              RedisCommand.pttl,
              organization.layout.value(captured.channel, captured.key)
            ])
          )
          return value < 0 ? undefined : value
        },
        1,
        () => [captured]
      )
    },
    persist: (input, ctx) => {
      const target = redisTtlTarget(organization, input)
      return redisWrite(
        organization,
        RedisOperation.persist,
        target,
        ctx,
        (...args) => redisTtlTarget(organization, ...args),
        (actual) => [actual],
        (draft, actual) =>
          actual.channel === 'vector'
            ? redisSelectedVector(organization).expire(draft, actual)
            : draft.expire(actual.channel, actual.key),
        1
      )
    }
  }
}
/** Assemble the original counters methods from explicit organization state. */
function createRedisCounterApi(organization: IRedisOrganizationContext): ICounterApi {
  return {
    increment: (input, by, ctx) => {
      const captured = { key: redisTextKey(organization, input), by }
      snapshotStorageCounterIncrement(by, RedisText.backend)
      return redisWrite(
        organization,
        RedisOperation.increment,
        captured,
        ctx,
        (actual) => {
          snapshotStorageCounterIncrement(actual.by, RedisText.backend)
          return { key: redisTextKey(organization, actual.key), by: actual.by }
        },
        (actual) => redisWriteLocks(organization, actual.key),
        (draft, actual) => draft.increment(actual.key, actual.by),
        1
      )
    }
  }
}
/** Drain the original accepted resources and release org publication references once. */
async function disposeRedisEnvironment(environment: IRedisEnvironment): Promise<void> {
  const failures: unknown[] = []
  for (const resource of environment.resources) {
    try {
      await resource.dispose()
    } catch (error) {
      failures.push(error)
    }
  }
  environment.resources.clear()
  if (environment.subscription) {
    try {
      await environment.subscription.dispose()
    } catch (error) {
      failures.push(error)
    }
  }
  for (const projection of environment.projections.values()) {
    try {
      projection.releaseFeatures()
    } catch (error) {
      failures.push(error)
    }
  }
  environment.projections.clear()
  if (failures.length)
    throw redisError(
      RedisErrorCode.failed,
      new AggregateError(failures, RedisText.failed, { cause: failures[0] })
    )
}
/** Validate pure deployment metadata before publishing any organization or native port. */
function createRedisEnvironment(
  options: IRedisOptions,
  core: IStoragePluginCore
): IRedisEnvironment {
  const { driver, prefix = 'migaia', concurrency, owner, maxLockMs = 30000 } = options
  const label = owner?.label
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
  const environment: IRedisEnvironment = {
    driver,
    prefix,
    concurrency,
    label,
    maxLockMs,
    core,
    report: createStorageOperationReporter(),
    resources: new Set(),
    projections: new Map(),
    scopeDrafts: new WeakMap(),
    rootProjection: Symbol('redis-root-projection'),
    subscription: undefined,
    poison: undefined,
    durableMaxLen: undefined,
    durableFactory: undefined,
    vectorFactory: undefined,
    controller: undefined!
  }
  environment.controller = core.createChangeController(
    {
      backend: RedisText.backend,
      platform: driver,
      options,
      origin: crypto.randomUUID(),
      finalize: () => disposeRedisEnvironment(environment)
    },
    createBackendChangeController
  )
  return environment
}
/** Build one pure native organization projection without a second resource owner. */
function createRedisOrganization(
  environment: IRedisEnvironment,
  orgId: string,
  allOrganizations: boolean
): IRedisOrganizationProjection {
  const organization: IRedisOrganizationContext = {
    environment,
    nativeDriver: undefined!,
    orgId,
    allOrganizations,
    ports: environment.core.getOrgContext(orgId),
    layout: createRedisLayout(environment.prefix, orgId),
    store: undefined!,
    installer: undefined!,
    transactionOwner: undefined!,
    symbolic: undefined,
    vectorBinding: undefined,
    vectorPublication: undefined,
    durablePublication: undefined
  }
  organization.nativeDriver = createRedisNativeDriver(organization)
  const base = createRedisBase(organization)
  const keyValue = createRedisKeyValue(organization, base)
  const recordApi = createRedisRecordApi(organization)
  const timeToLive = createRedisTtlApi(organization)
  const counters = createRedisCounterApi(organization)
  organization.store = provideCapabilities(
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
        organization.installer = value
      }
    }
  )
  organization.transactionOwner = createTransactionOwner<unknown, IRedisInternalScope>(
    organization.store,
    normalizeRedisTransactionFailure,
    {
      activityMode: 'managed',
      asyncDisposeKey,
      defaultPolicy: organization.environment.concurrency,
      concurrencyStages: redisConcurrencyStages(organization)
    }
  )
  const journal = createRedisJournalBinding({
    forOrg: (next) => redisForOrg(organization.environment, next).journal,
    assertLive: () => organization.environment.controller.assertLive(),
    controller: organization.environment.controller,
    report: (error) => reportCleanupError(organization.environment.report, error),
    run: <R>(work: (draft: RedisDraft) => Promise<R>): Promise<R> => {
      redisAssertWrite(organization.environment)
      const release = organization.environment.controller.beginMutation()
      return runWithConcurrency<R>(
        {
          store: organization.store,
          options: { signal: organization.environment.controller.closingSignal },
          policy: ConcurrencyPolicy.optimistic()
        },
        { attempt: (context) => redisNativeAttempt(organization, context, work, true, true) }
      )
        .catch((error) => {
          throw normalizeRedisTransactionFailure(error)
        })
        .finally(release)
    },
    state: (scope) => {
      const binding = organization.environment.scopeDrafts.get(scope),
        info = assertTransactionOwner(binding?.store ?? organization.store, scope)
      if (binding === undefined || binding.draft.layout.orgId !== organization.orgId)
        throw invalidArgument()
      return { draft: binding.draft, info }
    }
  })
  return {
    store: organization.store,
    installer: organization.installer,
    configureFeatures: (...args) => redisConfigureFeatures(organization, ...args),
    releaseFeatures: (...args) => redisReleaseFeatures(organization, ...args),
    journal,
    drop: () => redisClear(organization, true)
  }
}
/** Native detection and subscription stay in the original explicit host detection phase. */
async function detectRedisEnvironment(environment: IRedisEnvironment): Promise<void> {
  const info = await environment.driver.command([RedisCommand.info, RedisCommand.server])
  if (typeof info !== 'string') throw redisError(RedisErrorCode.decodeFailed, info)
  const valkey = /^valkey_version:(\d+)\.(\d+)\.(\d+)/m.exec(info),
    redis = /^redis_version:(\d+)\.(\d+)\.(\d+)/m.exec(info),
    version = valkey ?? redis
  if (
    !version ||
    Number(version[1]) < 7 ||
    (Number(version[1]) === 7 &&
      (Number(version[2]) < 2 || (valkey && Number(version[2]) === 2 && Number(version[3]) < 5)))
  )
    unsupported()
  if (!environment.subscription)
    environment.subscription = await environment.driver.subscribe(
      createRedisLayout(environment.prefix, environment.core.defaultOrgId).changes,
      (wire) => {
        try {
          const change = decodeRedisChange(wire)
          if (change.origin !== environment.controller.origin)
            environment.controller.publishExternal(change)
        } catch (error) {
          reportCleanupError(environment.report, error)
        }
      }
    )
}
/** Construct pure store projections first; original host detection owns all native setup I/O. */
export function createRedisStore(
  options: IRedisOptions,
  core: IStoragePluginCore
): IRedisConstruction {
  const environment = createRedisEnvironment(options, core)
  const root = redisForOrg(environment, core.defaultOrgId, true)
  return {
    ...root,
    controller: environment.controller,
    journalBinding: root.journal,
    orgBinding: {
      backend: (orgId) => redisForOrg(environment, orgId).store,
      drop: async (orgId) => {
        await redisForOrg(environment, orgId).drop()
      }
    },
    detect: () => detectRedisEnvironment(environment)
  }
}
