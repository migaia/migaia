import {
  StorageContractError,
  StorageContractErrorCode,
  createTransactionOwner,
  assertTransactionCallback,
  assertTransactionOwner,
  runWithConcurrency,
  type IStorageStore,
  type ITransactionOptions,
  type IConcurrencyAttemptContext,
  type IConcurrencyAttempt,
  type ITransactionStageObserver,
  type ILockKey,
  type IOperationContext
} from '@migaia/storage-contract'
import type { IStorageBackendOrgContext } from '@migaia/storage-host'
import {
  createStorageOperationReporter,
  reportCleanupError,
  throwIfAborted,
  type IBackendChangeController
} from '@migaia/storage-host/authoring/backend'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { sleep } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import type { IPgConfiguration, IPgTables } from './schema.js'
import type { IPgState } from './native.js'
import { commitPgRevisions, recheckPgRevisions } from './native.js'
import {
  acquirePgLocks,
  verifyPgLocks,
  releasePgLocks,
  guardPgKeys,
  guardPgRange,
  PgLockConflict,
  type IPgLockLease
} from './locks.js'
import { normalizeTransactionFailure, normalizePostgresError } from './errors.js'
import { PgNames, PgSqlState, PgOperation } from './constants.js'
import { PostgresErrorText } from './error-text.js'
import { pgCodecs } from './codec.js'
/** Observation always retains its original receiver and remains report-only. */
export function observePg<T extends object, K extends keyof T>(
  observer: T,
  key: K,
  ...args: NonNullable<T[K]> extends (...args: infer A) => unknown ? A : never
): void {
  const report = createStorageOperationReporter()
  try {
    const callback = observer[key]
    if (typeof callback !== 'function') return
    const result = Reflect.apply(callback, observer, args)
    observeThenableRejection(result, inspectThenable(result), (cause) =>
      reportCleanupError(report, cause)
    )
  } catch (cause) {
    reportCleanupError(report, cause)
  }
}
/** Only native driver SQL states, preserved on the owned cause chain, cause physical replay. */
function physicalPgFailure(value: unknown): boolean {
  return walkErrorCauses(value).some(
    (cause) =>
      cause !== null &&
      typeof cause === 'object' &&
      (('code' in cause &&
        (cause.code === PgSqlState.serialization || cause.code === PgSqlState.deadlock)) ||
        ('errno' in cause &&
          (cause.errno === PgSqlState.serialization || cause.errno === PgSqlState.deadlock)))
  )
}
/** Native transaction state is borrowed only after the original contract owner authenticates a view. */
export function createPgTransactions<TScope extends object>(input: {
  readonly states: WeakMap<object, { readonly store: IStorageStore; readonly state: IPgState }>
  readonly store: IStorageStore
  readonly configuration: IPgConfiguration
  readonly tables: IPgTables
  readonly runtime: IStorageBackendOrgContext
  readonly controller: IBackendChangeController
  readonly createScope: (state: IPgState) => TScope
  readonly publish: (state: IPgState) => void
  readonly beforeCommit?: (state: IPgState) => Promise<void>
  readonly onIsolation?: (value: string) => void
}) {
  const {
    store,
    configuration,
    tables,
    runtime,
    controller,
    createScope,
    publish,
    beforeCommit,
    onIsolation
  } = input
  const concurrencyStages = runtime.stageBindings.concurrencyStages(store)
  const transactionStages = runtime.stageBindings.transactionStages(store)
  const states = input.states
  const owner = createTransactionOwner<unknown, TScope>(store, normalizeTransactionFailure, {
    activityMode: 'managed',
    defaultPolicy: configuration.concurrency,
    concurrencyStages
  })
  const makeScope = (state: IPgState): TScope => {
    const scope = createScope(state)
    states.set(scope, { store, state })
    return scope
  }
  const stateFor = (scope: TScope): IPgState => {
    assertTransactionOwner(store, scope)
    return states.get(scope)!.state
  }
  /** One physical replay belongs to one logical attempt and retains its original baseline and lease. */
  const attempt = async <R>(
    context: IConcurrencyAttemptContext,
    callback: (scope: TScope) => R,
    lease: IPgLockLease | undefined,
    publicTransaction: boolean
  ): Promise<IConcurrencyAttempt<Awaited<R>>> => {
    const normalize = publicTransaction ? normalizeTransactionFailure : normalizePostgresError
    const baseline = new Map<string, bigint>()
    for (;;) {
      throwIfAborted(context.signal)
      const client = await configuration.driver.connect(context)
      const state: IPgState = {
        codecs: pgCodecs,
        client,
        orgId: runtime.orgId,
        ctx: context,
        baseline,
        observed: new Map(),
        changed: new Map(),
        expirations: new Map(),
        failure: undefined,
        guardKeys: (keys) =>
          guardPgKeys(client, tables, runtime.orgId, controller.origin, lease, keys),
        guardRange: (channel, prefix) =>
          guardPgRange(client, tables, runtime.orgId, controller.origin, lease, channel, prefix)
      }
      let begun = false
      let commitSent = false
      let registration: ReturnType<typeof owner.register<TScope>> | undefined
      let terminal: ITransactionStageObserver | undefined
      let primary: unknown
      let failed = false
      let retry = false
      const settled = await (async (): Promise<IConcurrencyAttempt<Awaited<R>> | undefined> => {
        try {
          await client.query('BEGIN ISOLATION LEVEL READ COMMITTED', [], context)
          begun = true
          const isolation = (await client.query('SHOW transaction_isolation', [], context)).rows[0]
            ?.transaction_isolation
          if (typeof isolation !== 'string')
            throw new StorageContractError(StorageContractErrorCode.unsupported, {
              backend: PgNames.backend
            })
          onIsolation?.(isolation)
          await verifyPgLocks(client, tables, runtime.orgId, lease)
          const scope = makeScope(state)
          registration = owner.register(scope, {
            createScope: () => makeScope(state),
            context,
            onFailure: (failure) => {
              state.failure ??= failure
            },
            beforeCommit: async (checkScope) => {
              observePg(transactionStages.forTransaction(checkScope), 'beforeCommit')
              await beforeCommit?.(state)
            }
          })
          terminal = transactionStages.forTransaction(scope)
          observePg(terminal, 'onTransactionStart')
          let value: Awaited<R> | undefined
          try {
            value = await callback(scope)
          } catch (cause) {
            state.failure ??= normalize(cause)
          } finally {
            registration.stopAdmission()
          }
          if (state.failure) throw state.failure
          await registration.runFinalizers()
          throwIfAborted(context.signal)
          await verifyPgLocks(client, tables, runtime.orgId, lease)
          const conflict = await commitPgRevisions(state, tables)
          if (conflict !== undefined) {
            await client.query('ROLLBACK', [])
            begun = false
            observePg(terminal, 'afterRollback', StorageContractErrorCode.writeConflict)
            return { status: 'conflict', phase: 'commit', keys: conflict, holder: undefined }
          }
          throwIfAborted(context.signal)
          commitSent = true
          await client.query('COMMIT', [])
          begun = false
          observePg(
            terminal,
            'afterCommit',
            [...state.changed.values()].reduce((count, keys) => count + keys.size, 0)
          )
          publish(state)
          return { status: 'committed', value: value as Awaited<R> }
        } catch (cause) {
          primary = cause
          failed = true
          try {
            registration?.stopAdmission()
            await registration?.closeIterators()
          } catch (secondary) {
            if (secondary !== primary)
              primary = new AggregateError(
                [primary, secondary],
                PostgresErrorText.transactionFailed
              )
          }
          if (begun && !commitSent) {
            try {
              await client.query('ROLLBACK', [])
              begun = false
              if (terminal)
                observePg(
                  terminal,
                  'afterRollback',
                  typeof primary === 'object' && primary !== null && 'code' in primary
                    ? String(primary.code)
                    : undefined
                )
            } catch (secondary) {
              throw normalizeTransactionFailure(
                new AggregateError([primary, secondary], PostgresErrorText.transactionFailed)
              )
            }
          }
          if (!commitSent && physicalPgFailure(cause) && primary === cause) {
            if (await recheckPgRevisions(state, tables)) {
              observePg(concurrencyStages, 'onRetry', context.attempt, 0, 'physical')
              retry = true
            } else
              return {
                status: 'conflict',
                phase: 'commit',
                keys: [...state.observed.values()],
                holder: undefined,
                cause
              }
          }
          if (cause instanceof PgLockConflict && primary === cause)
            return { status: 'conflict', phase: 'acquire', keys: cause.keys, holder: cause.holder }
          if (!retry) throw normalize(primary)
        }
      })().then(
        (value) => ({ failed: false as const, value }),
        (cause) => ({ failed: true as const, cause })
      )
      registration?.close()
      if (terminal) observePg(terminal, 'onTransactionClose')
      try {
        await client.dispose()
      } catch (secondary) {
        throw normalizeTransactionFailure(
          failed
            ? new AggregateError([primary, secondary], PostgresErrorText.transactionFailed)
            : secondary
        )
      }
      if (settled.failed) throw settled.cause
      if (settled.value !== undefined) return settled.value
      if (retry) await context.waitPhysical(sleep(10, { signal: context.signal }))
    }
  }
  /**
   * The existing loop alone captures options, applies policy, owns budgets and executes each
   * pipeline.
   */
  const run = <R>(
    callback: (scope: TScope) => R,
    options: ITransactionOptions = {},
    operation = 'transaction',
    execution?: {
      readonly input: unknown
      readonly capture: (input: unknown) => void
      readonly lock?: () => readonly ILockKey[]
      readonly observe?: <V>(invoke: () => Promise<V>) => Promise<V>
    },
    pipeline = true
  ): Promise<Awaited<R>> => {
    assertTransactionCallback(callback, PgNames.backend)
    controller.assertLive()
    const release = controller.beginMutation()
    const result = runWithConcurrency<Awaited<R>>(
      {
        store,
        options,
        ...(execution?.lock === undefined ? {} : { lock: execution.lock }),
        ...(pipeline
          ? {
              executeAttempt: (
                ctx: IOperationContext,
                invoke: () => Promise<Awaited<Awaited<R>>>
              ) =>
                runtime.execution.run(
                  { operation, input: execution?.input ?? {}, ctx },
                  (input) => {
                    execution?.capture(input)
                    return execution?.observe === undefined ? invoke() : execution.observe(invoke)
                  }
                )
            }
          : {})
      },
      {
        attempt: async (context) => {
          if (context.orgId !== undefined && context.orgId !== runtime.orgId)
            throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
              backend: PgNames.backend
            })
          const lease = await acquirePgLocks(
            configuration,
            tables,
            runtime.orgId,
            controller.origin,
            context
          )
          if (lease instanceof PgLockConflict)
            return { status: 'conflict', phase: 'acquire', keys: lease.keys, holder: lease.holder }
          let primary: unknown
          let failed = false
          let result: IConcurrencyAttempt<Awaited<R>> | undefined
          try {
            result = await attempt(context, callback, lease, operation === PgOperation.transaction)
          } catch (cause) {
            primary = cause
            failed = true
          }
          try {
            await releasePgLocks(configuration, tables, runtime.orgId, lease)
          } catch (secondary) {
            if (failed)
              throw normalizeTransactionFailure(
                new AggregateError([primary, secondary], PostgresErrorText.transactionFailed)
              )
            throw normalizeTransactionFailure(secondary)
          }
          if (failed) throw primary
          return result!
        }
      }
    )
    void result.then(release, release)
    return result
  }
  return { run, stateFor, registerIterator: owner.registerIterator }
}
