import {
  assertStringStorageKey,
  assertTransactionCallback,
  readTransactionConflictPolicy,
  ConcurrencyHolderState,
  kv,
  StorageContractError,
  StorageContractErrorCode,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext,
  type IStorageKey,
  type ITransactionKeyValueApi,
  type ITransactionCapabilityView,
  type IKeyValueStore,
  type IStorageStore,
  type ITransactionOptions,
  type ITransactionBuilder,
  type IWriteOptions,
  type IOperationContext,
  type ILockKey
} from '@migaia/storage-contract'
import {
  snapshotStorageBatchKeys,
  snapshotStorageKeyPrefix
} from '@migaia/storage-host/authoring/key'
import {
  createTransactionOwner,
  assertTransactionOwner,
  runTransactionOperation,
  useTransactionCapability,
  createTransactionBuilder
} from '@migaia/storage-host/authoring/transaction'
import { runWithConcurrency, lockKey } from '@migaia/storage-host/authoring/concurrency'
import {
  encodeFlatStorageKey,
  encodeStorageJournalImage,
  decodeStorageJournalImage,
  createStorageOperationRuntime,
  throwIfAborted,
  reportCleanupError,
  type IBackendChangeController
} from '@migaia/storage-host/authoring/backend'
import type { IStorageJournalBackendBinding, IStorageJournalChange } from '@migaia/storage-host'
import {
  StorageError as JournalError,
  StorageErrorCode as JournalErrorCode,
  StorageErrorText as JournalErrorText
} from '@migaia/storage-host'
import { asyncDisposeKey } from '@migaia/plugin-host'
import type { IBackendRuntime, IBrowserBatchApi } from './construction.js'
import { snapshotBrowserBatchEntries, observeBrowserBatch, BrowserBatchMethod } from './batch.js'
import { normalizeError } from './errors.js'
import { withNativeTextOperation } from './native-value-write.js'
import { storageBackendOperation, TEXT_REDO_LOCK } from '../constants.js'

/** Text scopes expose their actual family only; records and bytes are never fabricated. */
export type ITextRedoScope = ITransactionKeyValueApi & ITransactionCapabilityView<typeof kv>
/** Existing text stores add explicit transaction terminals; disabled redo rejects before callback. */
export type ITextRedoStore = {
  transaction<R>(
    run: (scope: ITextRedoScope) => R,
    options?: ITransactionOptions
  ): Promise<Awaited<R>>
  tx(): ITransactionBuilder<ITextRedoScope>
}
/** One native assignment is encoded and validated before the original WAL begin. */
export type ITextPrepared = {
  readonly value: string | null
  readonly image: unknown
  readonly apply: () => void
}
/** The actual backend alone supplies physical IO and fixed namespace projection. */
type ITextRedoInput = {
  readonly enabled: boolean
  readonly backend: string
  readonly namespace: string
  readonly runtime: IBackendRuntime
  readonly controller: IBackendChangeController
  readonly read: (key: IStorageKey) => string | null
  /** Native snapshot backends may read all missing draft keys from one original header. */
  readonly readMany?: (keys: readonly IStorageKey[]) => readonly (string | undefined)[]
  readonly keys: () => readonly IStorageKey[]
  readonly prepare: (key: IStorageKey, value: string | null) => ITextPrepared
  readonly replay: (key: IStorageKey, image: unknown, present: boolean) => () => void
  readonly publish: (changes: readonly IStorageJournalChange[]) => void
}

/** Existing text-redo ports; the physical backend supplies native IO and owns publication. */
type ITextRedoEngine = {
  initialize(actual: IStorageStore<typeof kv> & IKeyValueStore & ITextRedoStore): void
  transaction<R>(
    run: (scope: ITextRedoScope) => R,
    options?: ITransactionOptions,
    pipeline?: boolean,
    keys?: readonly ILockKey[],
    prepare?: ITextRedoInput['prepare']
  ): Promise<Awaited<R>>
  tx(): ITransactionBuilder<ITextRedoScope>
  read<R>(context: IOperationContext | undefined, run: () => R): Promise<Awaited<R>>
  write<R>(
    keys: readonly ILockKey[],
    context: IWriteOptions | undefined,
    run: (scope: ITextRedoScope) => R,
    prepare?: ITextRedoInput['prepare']
  ): Promise<Awaited<R>>
  binding(forOrg: IStorageJournalBackendBinding['forOrg']): IStorageJournalBackendBinding
  clear(context?: IWriteOptions): Promise<void>
  readonly batch: IBrowserBatchApi
}

/** A single finite draft adapter reuses the canonical transaction, key-lock and native lock owners. */

/** A physical text-redo namespace retains its existing transaction, lock and journal owners. */
type ITextRedoContext = {
  /** Original input is captured before native construction begins. */
  readonly input: ITextRedoInput

  /** Original runtime ports shared by this physical redo namespace. */
  runtime: IBackendRuntime

  /** Original mutation and close owner; no second resource lifetime is introduced. */
  controller: IBackendChangeController

  /** Diagnostic backend identity retained through native attempts. */
  backend: string

  /** Only the original installation captures local point-lock authority for this opt-in. */
  locks: ReturnType<IBackendRuntime['createKeyLockPort']> | undefined

  /** Native protection borrows the original reporter; runWithConcurrency owns operation budgets. */
  operationRuntime: ReturnType<typeof createStorageOperationRuntime>

  /** One conservative namespace lock also covers local/session wrappers that alias a native port. */
  physicalLock: string

  /** Initialization supplies the exact provided base before any host publication. */
  store: IStorageStore<typeof kv> & IKeyValueStore & ITextRedoStore

  /** The canonical registry owns all scope identities, expiry and accepted-operation draining. */
  owner: ReturnType<typeof createTransactionOwner<unknown, ITextRedoScope>>

  /** Lookup holds actual draft data only; the canonical owner authenticates every incoming scope. */
  attempts: Map<string, { readonly changes: IStorageJournalChange[]; readonly apply: () => void }>

  /** Journal recovery ports for the same native physical namespace. */
  redo: NonNullable<IStorageJournalBackendBinding['redo']>
}
/** Construct one physical redo adapter without creating a second transaction or retry owner. */
export function createTextRedo(input: ITextRedoInput): ITextRedoEngine {
  /** Initialize native facts in original construction order before publishing any port. */
  const redoContext = { input } as ITextRedoContext

  redoContext.runtime = redoContext.input.runtime

  redoContext.controller = redoContext.input.controller

  redoContext.backend = redoContext.input.backend

  /** Only the original installation captures local point-lock authority for this opt-in. */
  redoContext.locks = redoContext.input.enabled
    ? redoContext.runtime.createKeyLockPort()
    : undefined

  if (
    redoContext.input.enabled &&
    (redoContext.runtime.journal === undefined || globalThis.navigator?.locks === undefined)
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: redoContext.backend
    })

  /** Native protection borrows the original reporter; runWithConcurrency owns operation budgets. */
  redoContext.operationRuntime = createStorageOperationRuntime()

  /** One conservative namespace lock also covers local/session wrappers that alias a native port. */
  redoContext.physicalLock = encodeFlatStorageKey([TEXT_REDO_LOCK, redoContext.input.namespace])

  /** Lookup holds actual draft data only; the canonical owner authenticates every incoming scope. */
  redoContext.attempts = new Map<
    string,
    { readonly changes: IStorageJournalChange[]; readonly apply: () => void }
  >()
  redoContext.redo = createTextRedoRedo(redoContext)
  return createTextRedoMethods(redoContext)
}

/** Resolve one authenticated scope to its currently admitted native draft. */
function current(redoContext: ITextRedoContext, scope: object) {
  const info = assertTransactionOwner(redoContext.store, scope)
  const draft = redoContext.attempts.get(info.id)
  if (draft === undefined) throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return draft
}

/** Build recovery, protection and replay ports on the original journal owner. */
function createTextRedoRedo(redoContext: ITextRedoContext): ITextRedoContext['redo'] {
  return {
    transactionInfo: (scope: object) => assertTransactionOwner(redoContext.store, scope),
    changes: (scope: object) => current(redoContext, scope).changes.slice(),
    protect: <R>(run: () => Promise<R>, signal?: IOperationContext['signal']): Promise<R> =>
      withNativeTextOperation(
        async () => {
          redoContext.controller.assertLive()
          return run()
        },
        redoContext.backend,
        redoContext.operationRuntime,
        redoContext.controller.closingSignal,
        redoContext.physicalLock,
        signal
      ),
    apply: (scope: object) => current(redoContext, scope).apply(),
    replay: (changes: readonly IStorageJournalChange[]) => {
      /** Decode and prepare the entire persisted plan before the first native assignment. */
      const prepared = changes.map((change) => {
        try {
          if (change.target.channel !== 'text')
            throw new StorageContractError(StorageContractErrorCode.unsupported)
          const decoded = decodeStorageJournalImage(change.after)
          return redoContext.input.replay(change.target.key, decoded.value, decoded.present)
        } catch (cause) {
          if (cause instanceof JournalError && cause.code === JournalErrorCode.journalRecordInvalid)
            throw cause
          throw new JournalError(
            JournalErrorCode.journalRecordInvalid,
            { cause },
            JournalErrorText.journalRecordInvalid
          )
        }
      })
      for (const apply of prepared) apply()
      return () => redoContext.input.publish(changes)
    },
    seal: (_cause: unknown) => {
      void redoContext.controller
        .dispose()
        .catch((error) => reportCleanupError(redoContext.operationRuntime.reporter, error))
    }
  }
}

/** Reject a native text capability that the configured owner does not provide. */
function unsupported(redoContext: ITextRedoContext): never {
  throw new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: redoContext.backend
  })
}

/** All root and explicit transactions share this existing attempt budget and exact scope owner. */
function transaction<R>(
  redoContext: ITextRedoContext,
  run: (scope: ITextRedoScope) => R,
  options?: ITransactionOptions,
  pipeline = true,
  keys?: readonly ILockKey[],
  prepare: ITextRedoInput['prepare'] = redoContext.input.prepare
): Promise<Awaited<R>> {
  redoContext.controller.assertLive()
  assertTransactionCallback(run, redoContext.backend)
  if (
    !redoContext.input.enabled ||
    redoContext.locks === undefined ||
    redoContext.runtime.journal === undefined
  )
    return Promise.reject(
      new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: redoContext.backend
      })
    )
  if (redoContext.attempts.size !== 0)
    return Promise.reject(
      new StorageContractError(StorageContractErrorCode.writeConflict, {
        backend: redoContext.backend
      })
    )
  const release = redoContext.controller.beginMutation()
  return runWithConcurrency(
    {
      store: redoContext.store,
      options: options ?? {},
      prepare: () => redoContext.runtime.journal!.prepare(),
      lock: () => keys ?? []
    },
    { attempt: (context) => attemptTextRedo(redoContext, context, run, pipeline, prepare) }
  ).finally(release)
}
/** Publish the original redo, native read and batch methods against their physical namespace. */
function createTextRedoMethods(redoContext: ITextRedoContext): ITextRedoEngine {
  return {
    initialize: (actual: IStorageStore<typeof kv> & IKeyValueStore & ITextRedoStore) => {
      redoContext.store = actual
      if (redoContext.input.enabled)
        redoContext.owner = createTransactionOwner<unknown, ITextRedoScope>(
          redoContext.store,
          (error) => normalizeError(error, redoContext.backend),
          { asyncDisposeKey }
        )
    },
    transaction: <R>(
      run: (scope: ITextRedoScope) => R,
      options?: ITransactionOptions,
      pipeline = true,
      keys?: readonly ILockKey[],
      prepare: ITextRedoInput['prepare'] = redoContext.input.prepare
    ) => transaction(redoContext, run, options, pipeline, keys, prepare),
    tx: () =>
      createTransactionBuilder(
        redoContext.store,
        undefined,
        redoContext.runtime.getChainMethods('tx')
      ),
    /** All participating reads recover pending under the same physical protection before native IO. */
    read: async <R>(context: IOperationContext | undefined, run: () => R): Promise<Awaited<R>> => {
      redoContext.controller.assertLive()
      if (redoContext.attempts.size !== 0)
        throw new StorageContractError(StorageContractErrorCode.writeConflict, {
          backend: redoContext.backend
        })
      const release = redoContext.controller.beginMutation()
      try {
        return await runWithConcurrency(
          {
            store: redoContext.store,
            options: context ?? {},
            prepare: () => redoContext.runtime.journal!.prepare()
          },
          {
            attempt: async (attempt) => ({
              status: 'committed',
              value: await redoContext.runtime.journal!.runRedo!(async () => {
                throwIfAborted(attempt.signal)
                return run()
              }, attempt.signal)
            })
          }
        )
      } finally {
        release()
      }
    },
    write: <R>(
      keys: readonly ILockKey[],
      context: IWriteOptions | undefined,
      run: (scope: ITextRedoScope) => R,
      prepare?: ITextRedoInput['prepare']
    ) => transaction(redoContext, run, context, false, keys, prepare),
    binding: (forOrg: IStorageJournalBackendBinding['forOrg']): IStorageJournalBackendBinding => ({
      forOrg,
      openNamespace: async () => unsupported(redoContext),
      ...(redoContext.input.enabled ? { redo: redoContext.redo } : {})
    }),
    clear: (context?: IWriteOptions) =>
      transaction(
        redoContext,
        async (scope) => {
          await scope.removeMany(redoContext.input.keys())
        },
        context,
        false
      ),
    batch: createTextRedoBatch(redoContext)
  }
}

/** Recover and acquire original native text locks through the sole concurrency attempt owner. */
function attemptTextRedo<R>(
  redoContext: ITextRedoContext,
  context: IConcurrencyAttemptContext,
  run: (scope: ITextRedoScope) => R,
  pipeline: boolean,
  prepare: ITextRedoInput['prepare']
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  return redoContext.runtime.journal!.runRedo!(
    () =>
      redoContext.locks!.attempt(
        context,
        {
          status: ConcurrencyHolderState.held,
          owner: redoContext.controller.origin,
          label: redoContext.backend,
          scope: 'local',
          since: Date.now()
        },
        { attempt: () => commitTextRedo(redoContext, context, run, pipeline, prepare) },
        redoContext.runtime.stageBindings.concurrencyStages(redoContext.store),
        redoContext.controller.closingSignal
      ),
    context.signal
  )
}
/** Classify one admitted physical draft result without introducing another retry loop. */
async function commitTextRedo<R>(
  redoContext: ITextRedoContext,
  context: IConcurrencyAttemptContext,
  run: (scope: ITextRedoScope) => R,
  pipeline: boolean,
  prepare: ITextRedoInput['prepare']
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  if (!redoContext.runtime.journal!.active() || redoContext.runtime.journal!.runRedo === undefined)
    unsupported(redoContext)
  const value = await runTextDraft(redoContext, context, run, pipeline, prepare)
  return { status: 'committed', value }
}
/** Own one transaction's native draft until commit, rollback and iterator cleanup finish. */

/** One admitted text draft owns its touched values, ordered assignments and authentic scope. */
type ITextDraftContext<R> = {
  /** Original redoContext is captured before native construction begins. */
  readonly redoContext: ITextRedoContext
  /** Original context is captured before native construction begins. */
  readonly context: IConcurrencyAttemptContext
  /** Original run is captured before native construction begins. */
  readonly run: (scope: ITextRedoScope) => R
  /** Original pipeline is captured before native construction begins. */
  readonly pipeline: boolean
  /** Original prepare is captured before native construction begins. */
  readonly prepare: ITextRedoInput['prepare']

  /** Only touched keys and this transaction's actual assignment order remain in memory. */
  /** Touched native values and staged replacements for this one admitted draft. */
  values: Map<string, string | null>

  /** WAL changes kept in the original native assignment order. */
  changed: Array<
    IStorageJournalChange & { readonly target: Extract<ILockKey, { readonly channel: 'text' }> }
  >

  /** Prepared synchronous assignments applied only by the existing redo commit. */
  writes: Array<() => void>

  /** Authentic root scope registered with the canonical transaction owner. */
  scope: ITextRedoScope

  /** First accepted-operation failure retained until finalizer completion. */
  failure: unknown

  /** Registration controlling admission, finalizers and iterator cleanup. */
  control: ReturnType<ITextRedoContext['owner']['register']>

  /** Canonical transaction identity used to register and remove this native draft. */
  info: ReturnType<typeof assertTransactionOwner>
}
/** Own one draft from native admission through commit or rollback cleanup. */
async function runTextDraft<R>(
  redoContext: ITextRedoContext,
  context: IConcurrencyAttemptContext,
  run: (scope: ITextRedoScope) => R,
  pipeline: boolean,
  prepare: ITextRedoInput['prepare']
): Promise<Awaited<R>> {
  /** Initialize native facts in original construction order before publishing any port. */
  const draftState = { redoContext, context, run, pipeline, prepare } as ITextDraftContext<R>

  throwIfAborted(draftState.context.signal)

  /** Only touched keys and this transaction's actual assignment order remain in memory. */
  draftState.values = new Map<string, string | null>()

  draftState.changed = []

  draftState.writes = []

  draftState.scope = createScope(draftState)

  draftState.control = draftState.redoContext.owner.register(draftState.scope, {
    context: draftState.context,
    createScope: () => createScope(draftState),
    onFailure: (error) => {
      draftState.failure ??= error
    },
    beforeCommit: async (view) => {
      throwIfAborted(draftState.context.signal)
      await draftState.redoContext.runtime.journal!.beginRedo!(view)!.record(view)
    }
  })

  draftState.info = assertTransactionOwner(draftState.redoContext.store, draftState.scope)

  draftState.redoContext.attempts.set(draftState.info.id, {
    changes: draftState.changed,
    apply: () => {
      throwIfAborted(draftState.context.signal)
      for (const write of draftState.writes) write()
    }
  })

  try {
    return draftState.pipeline
      ? await draftState.redoContext.runtime.execution.run(
          {
            operation: storageBackendOperation(draftState.redoContext.backend, 'transaction'),
            input: draftState.run,
            ctx: draftState.context
          },
          (callback) => commitTextDraft(draftState, callback)
        )
      : await commitTextDraft(draftState, draftState.run)
  } catch (cause) {
    throw normalizeError(cause, draftState.redoContext.backend)
  } finally {
    draftState.redoContext.attempts.delete(draftState.info.id)
    await draftState.control.closeIterators()
    draftState.control.close()
  }
}

/** Read one touched native key once and retain its staged replacement. */
function read<R>(draftState: ITextDraftContext<R>, key: IStorageKey): string | null {
  const id = encodeFlatStorageKey(key)
  if (!draftState.values.has(id)) draftState.values.set(id, draftState.redoContext.input.read(key))
  return draftState.values.get(id)!
}

/** Append one prepared assignment and its before/after journal images in call order. */
function stage<R>(draftState: ITextDraftContext<R>, key: IStorageKey, value: string | null): void {
  const before = read(draftState, key)
  const prepared = draftState.prepare(key, value)
  const after = encodeStorageJournalImage(prepared.value !== null, prepared.image)
  draftState.changed.push({
    target: lockKey.text(key),
    before: encodeStorageJournalImage(before !== null, before),
    after,
    afterRevision: null
  })
  draftState.values.set(encodeFlatStorageKey(key), prepared.value)
  draftState.writes.push(prepared.apply)
}

/** Project the current staged key set over the original native namespace. */
function visible<R>(draftState: ITextDraftContext<R>): readonly IStorageKey[] {
  const keys = new Map(
    draftState.redoContext.input.keys().map((key) => [encodeFlatStorageKey(key), key])
  )
  for (const change of draftState.changed) {
    const id = encodeFlatStorageKey(change.target.key)
    if (draftState.values.get(id) === null) keys.delete(id)
    else keys.set(id, change.target.key)
  }
  return [...keys.values()]
}

/** One admitted text draft owns its touched values, ordered assignments and authentic scope. */
type ITextRedoScopeContext<R> = {
  /** Original draftState is captured before native construction begins. */
  readonly draftState: ITextDraftContext<R>

  scope: ITextRedoScope

  /** Feature API selected for this one authentic transaction scope. */
  api: ReturnType<IBackendRuntime['createTransactionApi']>
}
/** Create an authentic operation view sharing the original admitted native draft. */
function createScope<R>(draftState: ITextDraftContext<R>): ITextRedoScope {
  /** Initialize native facts in original construction order before publishing any port. */
  const scopeState = { draftState } as ITextRedoScopeContext<R>

  scopeState.scope = {
    use: (token) => useTransactionCapability(scopeState.scope, token),
    get: (key) =>
      operation(scopeState, 'get', key, (key) => {
        assertStringStorageKey(key, scopeState.draftState.redoContext.backend)
        return read(scopeState.draftState, key)
      }),
    has: (key) =>
      operation(scopeState, 'has', key, (key) => {
        assertStringStorageKey(key, scopeState.draftState.redoContext.backend)
        return read(scopeState.draftState, key) !== null
      }),
    set: (key, value, options) =>
      operation(scopeState, 'set', { key, value, options }, ({ key, value, options }) => {
        assertStringStorageKey(key, scopeState.draftState.redoContext.backend)
        readTransactionConflictPolicy(options, scopeState.draftState.redoContext.backend)
        if (typeof value !== 'string')
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        stage(scopeState.draftState, key, value)
      }),
    remove: (key) =>
      operation(scopeState, 'remove', key, (key) => {
        assertStringStorageKey(key, scopeState.draftState.redoContext.backend)
        if (read(scopeState.draftState, key) !== null) stage(scopeState.draftState, key, null)
      }),
    getMany: (keys) =>
      operation(scopeState, 'getMany', keys, (keys) => {
        const captured = snapshotStorageBatchKeys(keys, scopeState.draftState.redoContext.backend)
        if (scopeState.draftState.redoContext.input.readMany !== undefined) {
          const missing = captured.filter(
            ({ key }) => !scopeState.draftState.values.has(encodeFlatStorageKey(key))
          )
          const native = scopeState.draftState.redoContext.input.readMany(
            missing.map(({ key }) => key)
          )
          for (let index = 0; index < missing.length; index++)
            scopeState.draftState.values.set(
              encodeFlatStorageKey(missing[index]!.key),
              native[index] ?? null
            )
        }
        return captured.map(({ key }) => read(scopeState.draftState, key) ?? undefined)
      }),
    setMany: (entries) =>
      operation(scopeState, 'setMany', entries, (entries) => {
        for (const { key, value } of snapshotBrowserBatchEntries(
          entries,
          scopeState.draftState.redoContext.backend
        ))
          stage(scopeState.draftState, key, value)
      }),
    removeMany: (keys) =>
      operation(scopeState, 'removeMany', keys, (keys) => {
        let count = 0
        for (const [index, entry] of snapshotStorageBatchKeys(
          keys,
          scopeState.draftState.redoContext.backend
        ).entries()) {
          if (entry.firstIndex !== index) continue
          if (read(scopeState.draftState, entry.key) !== null) {
            stage(scopeState.draftState, entry.key, null)
            count++
          }
        }
        return count
      }),
    removeByPrefix: (prefix) =>
      operation(scopeState, 'removeByPrefix', prefix, (prefix) => {
        const captured = snapshotStorageKeyPrefix(prefix, scopeState.draftState.redoContext.backend)
        let count = 0
        for (const key of visible(scopeState.draftState)) {
          if (captured.matches(key)) {
            stage(scopeState.draftState, key, null)
            count++
          }
        }
        return count
      })
  }

  scopeState.api = scopeState.draftState.redoContext.runtime.createTransactionApi(scopeState.scope)

  if (scopeState.api !== undefined)
    Object.defineProperty(scopeState.scope, 'api', { value: scopeState.api, enumerable: true })
  return scopeState.scope
}

/** Run one scope operation through canonical admission and optional pipeline execution. */
function operation<R, I, T>(
  scopeState: ITextRedoScopeContext<R>,
  name: string,
  args: I,
  work: (captured: I) => T
): Promise<Awaited<T>> {
  return runTransactionOperation(scopeState.scope, (view) =>
    scopeState.draftState.pipeline
      ? scopeState.draftState.redoContext.runtime.execution.run(
          {
            operation: storageBackendOperation(scopeState.draftState.redoContext.backend, name),
            input: args,
            scope: view,
            ctx: scopeState.draftState.context
          },
          async (captured) => work(captured)
        )
      : work(args)
  )
}

/** Compose batch endpoints using the physical redo and transaction owners. */
function createTextRedoBatch(redoContext: ITextRedoContext): IBrowserBatchApi {
  return {
    getMany: async (keys, context) => {
      const values = snapshotStorageBatchKeys(keys, redoContext.backend)
      if (!values.length) return []
      const operation = storageBackendOperation(redoContext.backend, BrowserBatchMethod.getMany)
      return observeBrowserBatch(
        redoContext.runtime,
        redoContext.store,
        operation,
        values.length,
        () =>
          redoContext.runtime.execution.run(
            { operation, input: values.map(({ key }) => key), ctx: context },
            (captured) =>
              transaction(redoContext, (scope) => scope.getMany(captured), context, false)
          )
      )
    },
    setMany: async (entries, context) => {
      const values = snapshotBrowserBatchEntries(entries, redoContext.backend)
      if (!values.length) return
      const operation = storageBackendOperation(redoContext.backend, BrowserBatchMethod.setMany)
      return observeBrowserBatch(
        redoContext.runtime,
        redoContext.store,
        operation,
        values.length,
        () =>
          redoContext.runtime.execution.run(
            { operation, input: values.map(({ key, value }) => ({ key, value })), ctx: context },
            (captured) => {
              const detached = snapshotBrowserBatchEntries(captured, redoContext.backend)
              return transaction(
                redoContext,
                (scope) => scope.setMany(detached),
                context,
                false,
                detached.map(({ key }) => lockKey.text(key))
              )
            }
          )
      )
    },
    removeMany: async (keys, context) => {
      const values = snapshotStorageBatchKeys(keys, redoContext.backend)
      if (!values.length) return 0
      const operation = storageBackendOperation(redoContext.backend, BrowserBatchMethod.removeMany)
      return observeBrowserBatch(
        redoContext.runtime,
        redoContext.store,
        operation,
        values.length,
        () =>
          redoContext.runtime.execution.run(
            { operation, input: values.map(({ key }) => key), ctx: context },
            (captured) => {
              const detached = snapshotStorageBatchKeys(captured, redoContext.backend)
              return transaction(
                redoContext,
                (scope) => scope.removeMany(detached.map(({ key }) => key)),
                context,
                false,
                detached.map(({ key }) => lockKey.text(key))
              )
            }
          )
      )
    },
    removeByPrefix: async (prefix, context) => {
      const captured = snapshotStorageKeyPrefix(prefix, redoContext.backend)
      const operation = storageBackendOperation(
        redoContext.backend,
        BrowserBatchMethod.removeByPrefix
      )
      return observeBrowserBatch(redoContext.runtime, redoContext.store, operation, undefined, () =>
        redoContext.runtime.execution.run(
          { operation, input: captured.key, ctx: context },
          (prefix) =>
            transaction(redoContext, (scope) => scope.removeByPrefix(prefix), context, false)
        )
      )
    }
  } satisfies IBrowserBatchApi
}

/** Drain accepted operations and finalizers before publishing this draft's actual changes. */
async function commitTextDraft<R>(
  draftState: ITextDraftContext<R>,
  callback: (scope: ITextRedoScope) => R
): Promise<Awaited<R>> {
  const result = await runTransactionOperation(draftState.scope, (current) => callback(current))
  draftState.control.stopAdmission()
  await draftState.control.runFinalizers()
  if (draftState.failure !== undefined) throw draftState.failure
  draftState.redoContext.input.publish(draftState.changed)
  return result
}
