// Organization context types, observation and root reads for the Redis store (see ./store.ts).
import {
  createTransactionOwner,
  createStorageOperationReporter,
  reportCleanupError,
  withAbort,
  throwIfAborted,
  observeStorageBatch,
  normalizeError,
  type IBackendChangeController
} from '@migaia/storage-host/sdk'
import { RedisCommand, RedisOperation } from './constants.ts'
import type {
  IDurableChangeFeedApi,
  IStorageKey,
  IOperationContext,
  IStorageResource,
  ICapabilityInstallPort,
  ITransactionRecordsApi,
  ITransactionTtlApi,
  ITransactionCounterApi,
  ILockKey
} from '@migaia/storage-contract'
import {
  StorageError,
  type IStoragePluginCore,
  type IStorageOrgBinding,
  type IStorageJournalBackendBinding
} from '@migaia/storage-host'
import {
  StorageHostErrorCode,
  STORAGE_REDIS_ERROR_SOURCE
} from '@migaia/storage-contract/error-code'
import { RedisDraft } from './transaction.ts'
import { createRedisLayout } from './layout.ts'
import { RedisText } from './constants.ts'
import type { IRedisOptions, IRedisStore, IRedisTransactionScope } from './types.ts'
import type { IRedisConnection, IRedisDriver } from './driver.ts'
import type { IRedisVectorBinding } from './native-feature.ts'
import { createRedisOrganization } from './store.ts'

/**
 * This maintenance script rechecks actual existence atomically before deleting stale ordered
 * members.
 */
export const pruneScript =
  "local n=0; for i=2,#KEYS do if redis.call('EXISTS',KEYS[i])==0 then n=n+redis.call('ZREM',KEYS[1],ARGV[i-1]) end end; return n"
/** Original transaction methods expose finite standard token APIs without another capability table. */
export const ttlApi = Symbol('redis-transaction-ttl'),
  counterApi = Symbol('redis-transaction-counter'),
  recordsApi = Symbol('redis-transaction-records')
/** Scope-private methods belong to the same original transaction view factory. */
export type IRedisInternalScope = IRedisTransactionScope & {
  readonly [ttlApi]: ITransactionTtlApi
  readonly [counterApi]: ITransactionCounterApi
  readonly [recordsApi]: ITransactionRecordsApi<unknown>
}
/** Captured write inputs hold detached public data, never caller-owned accessors or mutable bytes. */
export type IRedisValueInput = {
  readonly key: IStorageKey
  readonly wire: string
  readonly ttlMs?: number
}
/** Public pipeline inputs keep values paired with their canonical logical keys. */
export type IRedisTextInput = {
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
export type IRedisOrganizationProjection = {
  store: IRedisStore
  installer: ICapabilityInstallPort
  configureFeatures(): void
  releaseFeatures(): void
  journal: IStorageJournalBackendBinding
  drop(): Promise<void>
}
/** One installation owns org projections and the original shared controller, never the driver. */
export type IRedisEnvironment = {
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
export type IRedisOrganizationContext = {
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
      new StorageError(StorageHostErrorCode.extensionFailed, {
        backend: RedisText.backend,
        operation,
        cause
      }),
    (value): value is Error =>
      value instanceof Error && Reflect.get(value, 'source') === STORAGE_REDIS_ERROR_SOURCE
  )
}
/** Selected native writes are sealed after an unknown outcome without discarding read access. */
export function redisAssertWrite(environment: IRedisEnvironment): void {
  environment.controller.assertLive()
  if (environment.poison) throw environment.poison
}
/** Fixed command observation never includes arguments or application data. */
export async function redisObserveNative<R>(
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
export function redisCommand(
  environment: IRedisEnvironment,
  connection: IRedisConnection,
  args: readonly string[],
  orgId: string
): Promise<unknown> {
  return redisObserveNative(environment, args[0]!, orgId, () => connection.command(args))
}
/** EXEC observation measures the full actual native batch, without fabricating per-item timings. */
export function redisExec(
  environment: IRedisEnvironment,
  connection: IRedisConnection,
  commands: Parameters<IRedisConnection['exec']>[0],
  orgId: string
) {
  return redisObserveNative(environment, RedisCommand.exec, orgId, () => connection.exec(commands))
}
/** Each org receives a native provider projection without DDL, registry I/O or another lifetime. */
export function redisForOrg(
  environment: IRedisEnvironment,
  orgId: string,
  allOrganizations = false
) {
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
export function redisObserve(
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
export function redisOperations(organization: IRedisOrganizationContext) {
  return organization.ports.stageBindings.operationStages(organization.store)
}
/** All observations resolve through this exact original store and org binding. */
export function redisTransactions(organization: IRedisOrganizationContext) {
  return organization.ports.stageBindings.transactionStages(organization.store)
}
/** All observations resolve through this exact original store and org binding. */
export function redisConcurrencyStages(organization: IRedisOrganizationContext) {
  return organization.ports.stageBindings.concurrencyStages(organization.store)
}
/** One public terminal owns one pipeline and one storage-operation observation. */
export function redisOperate<I, R>(
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
export function redisRead<I, R>(
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
