// Organization context types, keys and operation runners for the PostgreSQL store (see ./store.ts).
import {
  createStorageBatchKeyCapture,
  runTransactionOperation,
  snapshotStorageTtlTarget,
  createStorageOperationReporter,
  throwIfAborted,
  type IBackendChangeController
} from '@migaia/storage-host/sdk'
import type { IPgQuantizedOptions } from './features/quantized.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  assertStorageTtlDuration,
  type IStorageKey,
  type ITransactionOptions,
  type IKeyValueApi,
  type IRecordsApi,
  type ITransactionRecordsApi,
  type ITtlApi,
  type ITtlTarget,
  type ITransactionTtlApi,
  type ICounterApi,
  type ITransactionCounterApi,
  type ICapabilityInstallPort,
  type ICapabilityPublication,
  type ILockKey,
  type IStorageStore
} from '@migaia/storage-contract'
import type {
  IStoragePluginCore,
  IStorageBackendOrgContext,
  IStorageOrgBinding,
  IStorageJournalBackendBinding
} from '@migaia/storage-host'
import type { IPgConfiguration, IPgTables } from './schema.js'
import { probePostgres } from './probe.js'
import { createPgTransactions, observePg } from './transaction.js'
import { createPgJournalImages, createPgJournalBinding } from './journal.js'
import { createPgChanges } from './changes.js'
import { createPgVectors } from './vector.js'
import type { IPgReplicationSelection } from './logical-replication.js'
import { pgLockKey, type IPgState } from './native.js'
import { createPgCodecs } from './codec.js'
import { PgNames } from './constants.js'
import { invalidArgument } from './errors.js'
import { PostgresErrorText } from './error-text.js'
import type {
  IPostgresStore,
  IPostgresTransactionScope,
  IPgServer,
  IPgConnection,
  IPgNativeOperation
} from './types.js'
import { createPgOrgVectorApi } from './store-apis.js'
import { createPgOrgBase } from './store-org-base.js'

/** These original scope extensions bind standard tokens to exactly one native transaction. */
export const ttlScope = Symbol('postgres-ttl')
/** Counter binds the same text draft and never opens a nested root transaction. */
export const counterScope = Symbol('postgres-counter')
/** Original complete views retain their actual record query source until owner invalidation. */
export const recordsScope = Symbol('postgres-records')
/** Private method facts hold no separate admission or lifecycle authority. */
export type IPgScope<T> = IPostgresTransactionScope<T> & {
  readonly [ttlScope]: ITransactionTtlApi
  readonly [counterScope]: ITransactionCounterApi
  readonly [recordsScope]: ITransactionRecordsApi<T>
}
/** The installation window receives only original provider/controller/native borrowing ports. */
export type IPostgresConstruction<T> = {
  readonly store: IPostgresStore<IPgServer, T>
  readonly installer: ICapabilityInstallPort
  readonly controller: IBackendChangeController
  readonly configuration: IPgConfiguration
  readonly tables: IPgTables
  readonly orgBinding: IStorageOrgBinding
  readonly journalBinding: IStorageJournalBackendBinding
  readonly runNative: IPgNativeOperation
  createVectorApi(): import('@migaia/storage-contract').IVectorApi<true>
  createDurableApi(): import('@migaia/storage-contract').IDurableChangeFeedApi
  dropVectorOrg(client: IPgConnection, orgId: string): Promise<void>
  reportReplication(facts: import('./types.js').IPgReplicationHealth): void
  releaseOrgCapabilities(): void
  getTransactionClient(scope: IPostgresTransactionScope): IPgConnection
  assertNativeRoot(value: object): void
}
/** String-only channels use the original public key assertion before canonical byte capture. */
export function textKey(key: string): string {
  assertStringStorageKey(key, PgNames.backend)
  return key
}
/** Input strings are detached scalar payloads; unsupported runtime values fail before native work. */
export function textValue(value: string): string {
  if (typeof value !== 'string')
    throw invalidArgument(new TypeError(PostgresErrorText.invalidArgument))
  return value
}
/** Cross-channel writes acquire the original finite key set before reading their first baseline. */
export function pointLocks(key: IStorageKey | undefined): readonly ILockKey[] {
  if (key === undefined) return []
  return [
    pgLockKey('text', key),
    ...(typeof key === 'string' ? [pgLockKey('bytes', key)] : []),
    pgLockKey('record', key)
  ]
}
/** Capture batch membership and scalar entries before awaited native admission can observe mutation. */
export function textEntries(entries: Parameters<IKeyValueApi['setMany']>[0]) {
  if (!Array.isArray(entries)) throw invalidArgument()
  const keyCapture = createStorageBatchKeyCapture(PgNames.backend)
  const length = entries.length
  const result: {
    readonly key: IStorageKey
    readonly identity: string
    readonly value: string
    readonly ttlMs: number | undefined
  }[] = []
  for (let index = 0; index < length; index += 1) {
    const entry = entries[index]!
    const captured = keyCapture(entry.key)
    const value = textValue(entry.value)
    const ttlMs = entry.ttlMs
    if (captured.firstIndex !== index) throw invalidArgument()
    if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, PgNames.backend)
    result.push({
      key: captured.key,
      identity: captured.identity,
      value,
      ttlMs
    })
  }
  return result
}
/** A TTL target may reach vector only after the selected Feature supplies its original table port. */
/** Shared physical PostgreSQL resources; organization modules only borrow this owner. */
export type IPgStoreEnvironment = {
  readonly configuration: IPgConfiguration
  readonly core: IStoragePluginCore
  readonly probe: Awaited<ReturnType<typeof probePostgres>>
  readonly tables: IPgTables
  readonly report: ReturnType<typeof createStorageOperationReporter>
  readonly states: WeakMap<object, { readonly store: IStorageStore; readonly state: IPgState }>
  readonly controller: IBackendChangeController
  readonly changes: Awaited<ReturnType<typeof createPgChanges>> | undefined
  readonly vectorSelected: () => boolean
  readonly replicationSelected: () => IPgReplicationSelection | undefined
  readonly quantizedSelected: () => IPgQuantizedOptions['mode'] | undefined
}
/** Fixed organization state is passed explicitly to SQL, record, vector and transaction jobs. */
export type IPgOrganizationContext<T> = {
  readonly environment: IPgStoreEnvironment
  readonly runtime: IStorageBackendOrgContext
  readonly orgView: boolean
  /** The public organization view keeps capability and operation identity stable. */
  store: IPostgresStore<IPgServer, T>
  /** Capabilities are installed on this exact organization view. */
  installer: ICapabilityInstallPort | undefined
  /** The canonical transaction adapter owns every authentic scope for this organization. */
  engine: ReturnType<typeof createPgTransactions<IPgScope<T>>>
  /** Symbolic disposal returns one report-only settlement promise. */
  symbolic: Promise<void> | undefined
  /** A selected organization lazily creates one native vector owner. */
  vectors: ReturnType<typeof createPgVectors> | undefined
  /** The organization releases its original vector publication at disposal. */
  vectorPublication: ICapabilityPublication | undefined
  /** The organization releases its original feed publication at disposal. */
  durablePublication: ICapabilityPublication | undefined
  /** A selected organization lazily creates one durable feed view. */
  durableApi: import('@migaia/storage-contract').IDurableChangeFeedApi | undefined
  /** The public operation table delegates native work through this organization context. */
  base: ReturnType<typeof createPgOrgBase<T>>
  /** TTL operations share the native revision and deadline owner. */
  ttlApi: ITtlApi
  /** Counters share native transaction admission and conflict policy. */
  counterApi: ICounterApi
  /** Record query construction reuses the canonical query runtime. */
  recordsApi: IRecordsApi<T>
  /** Image encoding and capture share this organization native layout. */
  journalImages: ReturnType<typeof createPgJournalImages>
  /** The private journal binding borrows only authentic organization scopes. */
  journal: ReturnType<typeof createPgJournalBinding>
}

/** Detach a caller target because TTL pruning and guarded writes await native I/O. */
export function pgOrgTtlTarget<T>(
  organization: IPgOrganizationContext<T>,
  input: ITtlTarget
): ITtlTarget {
  /** The target key must stay stable while pruning, locking and applying the deadline await. */
  const target = snapshotStorageTtlTarget(input, PgNames.backend)
  if (target.channel === 'vector' && !organization.environment.vectorSelected())
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  if (target.channel === 'vector') createPgOrgVectorApi(organization)
  return target
}

/** Organization construction uses the explicit PostgreSQL organization context. */
function pgOrgOperationStages<T>(organization: IPgOrganizationContext<T>) {
  return organization.runtime.stageBindings.operationStages(organization.store)
}

/** Observation encloses actual settlement; report-only hooks cannot alter an operation. */
export async function observePgOrgOperation<T, R>(
  organization: IPgOrganizationContext<T>,
  operation: string,
  scope: IPgScope<T> | undefined,
  run: () => R,
  count = 1
): Promise<Awaited<R>> {
  const stages = pgOrgOperationStages(organization)
  const observer = scope === undefined ? stages : stages.forTransaction(scope)
  const transactionObserver =
    scope === undefined
      ? undefined
      : organization.runtime.stageBindings
          .transactionStages(organization.store)
          .forTransaction(scope)
  const started = Date.now()
  if (transactionObserver !== undefined)
    observePg(transactionObserver, 'beforeTxOperation', operation)
  observePg(observer, 'beforeStorageOperation', operation, count)
  try {
    const value = await run()
    if (transactionObserver !== undefined)
      observePg(transactionObserver, 'afterTxOperation', operation)
    observePg(observer, 'afterStorageOperation', operation, Date.now() - started, count)
    return value
  } catch (cause) {
    observePg(
      observer,
      'onStorageOperationError',
      operation,
      typeof cause === 'object' && cause !== null && 'code' in cause
        ? String(cause.code)
        : undefined
    )
    throw cause
  }
}

/** Scope admission precedes pipeline stages, codecs and native queries. */
export function runPgScopeOperation<T, I, R>(
  organization: IPgOrganizationContext<T>,
  scope: IPgScope<T>,
  operation: string,
  prepare: () => I,
  run: (state: IPgState, current: IPgScope<T>, input: I) => R,
  empty?: { readonly when: (input: I) => boolean; readonly value: NoInfer<Awaited<R>> }
): Promise<Awaited<R>> {
  return runTransactionOperation(scope, (current) => {
    const state = organization.engine.stateFor(current)
    const input = prepare()
    if (empty?.when(input)) return empty.value
    return organization.runtime.execution.run(
      { operation, input, ctx: state.ctx, scope: current, internal: true },
      (actual) => {
        throwIfAborted(state.ctx?.signal)
        return observePgOrgOperation(
          organization,
          operation,
          current,
          () =>
            run(
              {
                ...state,
                codecs: createPgCodecs(
                  organization.runtime.stageBindings
                    .codecStages(organization.store)
                    .forTransaction(current)
                )
              },
              current,
              actual
            ),
          Array.isArray(actual) ? actual.length : 1
        )
      }
    )
  })
}

/** Root operations use one original concurrency attempt and the same native data functions. */
export async function runPgRootOperation<T, I, R>(
  organization: IPgOrganizationContext<T>,
  operation: string,
  ctx: ITransactionOptions | undefined,
  prepare: () => I,
  run: (state: IPgState, input: I) => R,
  lock?: (input: I) => readonly ILockKey[],
  enveloped = false,
  empty?: { readonly when: (input: I) => boolean; readonly value: NoInfer<Awaited<R>> }
): Promise<Awaited<R>> {
  organization.environment.controller.assertLive()
  let input = prepare()
  if (empty?.when(input)) return empty.value
  const invoke = () =>
    organization.engine.run(
      (scope) =>
        run(
          {
            ...organization.engine.stateFor(scope),
            codecs: createPgCodecs(
              organization.runtime.stageBindings.codecStages(organization.store)
            )
          },
          input
        ),
      ctx,
      operation,
      {
        input,
        ...(lock === undefined ? {} : { lock: () => lock(input) }),
        capture: (actual) => {
          input = actual as I
        },
        observe: (work) =>
          observePgOrgOperation(
            organization,
            operation,
            undefined,
            work,
            Array.isArray(input) ? input.length : 1
          )
      },
      !enveloped
    )
  return enveloped ? observePgOrgOperation(organization, operation, undefined, invoke) : invoke()
}
