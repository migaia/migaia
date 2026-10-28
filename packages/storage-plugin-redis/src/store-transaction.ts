// Transaction drafts, root get/put/remove and native features for the Redis store (see ./store.ts).
import { runWithConcurrency, throwIfAborted } from '@migaia/storage-host/sdk'
import { RedisCommand, RedisOperation } from './constants.ts'
import {
  StorageContractErrorCode,
  durableChangeFeed,
  vector,
  implement,
  assertTransactionCallback,
  readTransactionConflictPolicy,
  type IStorageKey,
  type IOperationContext,
  type IWriteOptions,
  type ITransactionOptions,
  type IConcurrencyAttemptContext,
  type IConcurrencyAttempt
} from '@migaia/storage-contract'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import { RedisDraft } from './transaction.ts'
import { decodeRedisValue, replyOptionalString, type IRedisChannel } from './layout.ts'
import { normalizeRedisTransactionFailure, redisError } from './errors.ts'
import { RedisText } from './constants.ts'
import type { IRedisTransactionScope } from './types.ts'
import type { IRedisConnection, IRedisDriver } from './driver.ts'
import type { IRedisVectorBinding } from './native-feature.ts'
import { redisNativeAttempt } from './store-native-attempt.ts'
import { redisRemovePrefix, redisClearBytes } from './store-records.ts'
import { redisCreateScope } from './store-scope.ts'
import {
  redisTransactions,
  redisObserve,
  redisOperate,
  redisAssertWrite,
  redisRead,
  redisCommand,
  redisExec,
  redisObserveNative
} from './store-state.ts'
import type { IRedisOrganizationContext } from './store-state.ts'
import {
  redisDraftKeys,
  redisKey,
  redisChannelLocks,
  redisCapturePoint,
  redisWrite,
  redisPreparePoint,
  redisWriteLocks
} from './store-write.ts'

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
export function redisTransaction<R>(
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
export function redisGet(
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
export function redisPut(
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
export function redisRemove(
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
export function redisObservedConnection(
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
export function redisClear(
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
export function redisSelectedVector(organization: IRedisOrganizationContext): IRedisVectorBinding {
  return (organization.vectorBinding ??= organization.environment.vectorFactory!(
    organization.store
  ))
}
/** Capture one selected API for this exact original org store without rerunning a Feature factory. */
export function redisConfigureFeatures(organization: IRedisOrganizationContext): void {
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
export function redisReleaseFeatures(organization: IRedisOrganizationContext): void {
  organization.durablePublication?.release()
  organization.vectorPublication?.release()
}
/** Assemble the original nativeDriver methods from explicit organization state. */
export function createRedisNativeDriver(organization: IRedisOrganizationContext): IRedisDriver {
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
