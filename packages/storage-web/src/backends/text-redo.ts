import {
  assertStringStorageKey,
  assertTransactionCallback,
  readTransactionConflictPolicy,
  snapshotStorageBatchKeys,
  snapshotStorageKeyPrefix,
  createTransactionOwner,
  assertTransactionOwner,
  runTransactionOperation,
  useTransactionCapability,
  createTransactionBuilder,
  runWithConcurrency,
  ConcurrencyHolderState,
  lockKey,
  kv,
  StorageContractError,
  StorageContractErrorCode,
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
type ITextPrepared = {
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
  readonly keys: () => readonly IStorageKey[]
  readonly prepare: (key: IStorageKey, value: string | null) => ITextPrepared
  readonly replay: (key: IStorageKey, image: unknown, present: boolean) => () => void
  readonly publish: (changes: readonly IStorageJournalChange[]) => void
}

/** A single finite draft adapter reuses the canonical transaction, key-lock and native lock owners. */
export function createTextRedo(input: ITextRedoInput) {
  const { runtime, controller, backend } = input
  /** Only the original installation captures local point-lock authority for this opt-in. */
  const locks = input.enabled ? runtime.createKeyLockPort() : undefined
  if (input.enabled && (runtime.journal === undefined || globalThis.navigator?.locks === undefined))
    throw new StorageContractError(StorageContractErrorCode.unsupported, { backend })
  /** Native protection borrows the original reporter; runWithConcurrency owns operation budgets. */
  const operationRuntime = createStorageOperationRuntime()
  /** One conservative namespace lock also covers local/session wrappers that alias a native port. */
  const physicalLock = encodeFlatStorageKey([TEXT_REDO_LOCK, input.namespace])
  /** Initialization supplies the exact provided base before any host publication. */
  let store!: IStorageStore<typeof kv> & IKeyValueStore & ITextRedoStore
  /** The canonical registry owns all scope identities, expiry and accepted-operation draining. */
  let owner!: ReturnType<typeof createTransactionOwner<unknown, ITextRedoScope>>
  /** Lookup holds actual draft data only; the canonical owner authenticates every incoming scope. */
  const attempts = new Map<
    string,
    { readonly changes: IStorageJournalChange[]; readonly apply: () => void }
  >()
  const current = (scope: object) => {
    const info = assertTransactionOwner(store, scope)
    const draft = attempts.get(info.id)
    if (draft === undefined)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    return draft
  }
  const redo = {
    transactionInfo: (scope: object) => assertTransactionOwner(store, scope),
    changes: (scope: object) => current(scope).changes.slice(),
    protect: <R>(run: () => Promise<R>, signal?: IOperationContext['signal']): Promise<R> =>
      withNativeTextOperation(
        async () => {
          controller.assertLive()
          return run()
        },
        backend,
        operationRuntime,
        controller.closingSignal,
        physicalLock,
        signal
      ),
    apply: (scope: object) => current(scope).apply(),
    replay: (changes: readonly IStorageJournalChange[]) => {
      /** Decode and prepare the entire persisted plan before the first native assignment. */
      const prepared = changes.map((change) => {
        try {
          if (change.target.channel !== 'text')
            throw new StorageContractError(StorageContractErrorCode.unsupported)
          const decoded = decodeStorageJournalImage(change.after)
          return input.replay(change.target.key, decoded.value, decoded.present)
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
      return () => input.publish(changes)
    },
    seal: (_cause: unknown) => {
      void controller
        .dispose()
        .catch((error) => reportCleanupError(operationRuntime.reporter, error))
    }
  }
  const unsupported = (): never => {
    throw new StorageContractError(StorageContractErrorCode.unsupported, { backend })
  }
  /** All root and explicit transactions share this existing attempt budget and exact scope owner. */
  const transaction = <R>(
    run: (scope: ITextRedoScope) => R,
    options?: ITransactionOptions,
    pipeline = true,
    keys?: readonly ILockKey[]
  ): Promise<Awaited<R>> => {
    controller.assertLive()
    assertTransactionCallback(run, backend)
    if (!input.enabled || locks === undefined || runtime.journal === undefined)
      return Promise.reject(
        new StorageContractError(StorageContractErrorCode.unsupported, { backend })
      )
    if (attempts.size !== 0)
      return Promise.reject(
        new StorageContractError(StorageContractErrorCode.writeConflict, { backend })
      )
    const release = controller.beginMutation()
    return runWithConcurrency(
      {
        store,
        options: options ?? {},
        prepare: () => runtime.journal!.prepare(),
        lock: () => keys ?? []
      },
      {
        attempt: (context) =>
          runtime.journal!.runRedo!(
            async () =>
              locks.attempt(
                context,
                {
                  status: ConcurrencyHolderState.held,
                  owner: controller.origin,
                  label: backend,
                  scope: 'local',
                  since: Date.now()
                },
                {
                  attempt: async () => {
                    if (!runtime.journal!.active() || runtime.journal!.runRedo === undefined)
                      unsupported()
                    const value = await (async () => {
                      throwIfAborted(context.signal)
                      /**
                       * Only touched keys and this transaction's actual assignment order remain in
                       * memory.
                       */
                      const values = new Map<string, string | null>()
                      const changed: IStorageJournalChange[] = []
                      const writes: Array<() => void> = []
                      const read = (key: IStorageKey): string | null => {
                        const id = encodeFlatStorageKey(key)
                        if (!values.has(id)) values.set(id, input.read(key))
                        return values.get(id)!
                      }
                      const stage = (key: IStorageKey, value: string | null): void => {
                        const before = read(key)
                        const prepared = input.prepare(key, value)
                        const after = encodeStorageJournalImage(
                          prepared.value !== null,
                          prepared.image
                        )
                        changed.push({
                          target: lockKey.text(key),
                          before: encodeStorageJournalImage(before !== null, before),
                          after,
                          afterRevision: null
                        })
                        values.set(encodeFlatStorageKey(key), prepared.value)
                        writes.push(prepared.apply)
                      }
                      const visible = (): readonly IStorageKey[] => {
                        const keys = new Map(
                          input.keys().map((key) => [encodeFlatStorageKey(key), key])
                        )
                        for (const change of changed) {
                          if (change.target.channel !== 'text') continue
                          const id = encodeFlatStorageKey(change.target.key)
                          if (values.get(id) === null) keys.delete(id)
                          else keys.set(id, change.target.key)
                        }
                        return [...keys.values()]
                      }
                      const createScope = (): ITextRedoScope => {
                        let scope!: ITextRedoScope
                        const operation = <I, T>(
                          name: string,
                          args: I,
                          work: (captured: I) => T
                        ): Promise<Awaited<T>> =>
                          runTransactionOperation(scope, (view) =>
                            pipeline
                              ? runtime.execution.run(
                                  {
                                    operation: storageBackendOperation(backend, name),
                                    input: args,
                                    scope: view,
                                    ctx: context
                                  },
                                  async (captured) => work(captured)
                                )
                              : work(args)
                          )
                        scope = {
                          use: (token) => useTransactionCapability(scope, token),
                          get: (key) =>
                            operation('get', key, (key) => {
                              assertStringStorageKey(key, backend)
                              return read(key)
                            }),
                          has: (key) =>
                            operation('has', key, (key) => {
                              assertStringStorageKey(key, backend)
                              return read(key) !== null
                            }),
                          set: (key, value, options) =>
                            operation('set', { key, value, options }, ({ key, value, options }) => {
                              assertStringStorageKey(key, backend)
                              readTransactionConflictPolicy(options, backend)
                              if (typeof value !== 'string')
                                throw new StorageContractError(
                                  StorageContractErrorCode.invalidArgument
                                )
                              stage(key, value)
                            }),
                          remove: (key) =>
                            operation('remove', key, (key) => {
                              assertStringStorageKey(key, backend)
                              if (read(key) !== null) stage(key, null)
                            }),
                          getMany: (keys) =>
                            operation('getMany', keys, (keys) =>
                              snapshotStorageBatchKeys(keys, backend).map(
                                ({ key }) => read(key) ?? undefined
                              )
                            ),
                          setMany: (entries) =>
                            operation('setMany', entries, (entries) => {
                              for (const { key, value } of snapshotBrowserBatchEntries(
                                entries,
                                backend
                              ))
                                stage(key, value)
                            }),
                          removeMany: (keys) =>
                            operation('removeMany', keys, (keys) => {
                              let count = 0
                              for (const [index, entry] of snapshotStorageBatchKeys(
                                keys,
                                backend
                              ).entries()) {
                                if (entry.firstIndex !== index) continue
                                if (read(entry.key) !== null) {
                                  stage(entry.key, null)
                                  count++
                                }
                              }
                              return count
                            }),
                          removeByPrefix: (prefix) =>
                            operation('removeByPrefix', prefix, (prefix) => {
                              const captured = snapshotStorageKeyPrefix(prefix, backend)
                              let count = 0
                              for (const key of visible()) {
                                if (captured.matches(key)) {
                                  stage(key, null)
                                  count++
                                }
                              }
                              return count
                            })
                        }
                        const api = runtime.createTransactionApi(scope)
                        if (api !== undefined)
                          Object.defineProperty(scope, 'api', { value: api, enumerable: true })
                        return Object.freeze(scope)
                      }
                      const scope = createScope()
                      let failure: unknown
                      const control = owner.register(scope, {
                        context,
                        createScope,
                        onFailure: (error) => {
                          failure ??= error
                        },
                        beforeCommit: async (view) => {
                          throwIfAborted(context.signal)
                          await runtime.journal!.beginRedo!(view)!.record(view)
                        }
                      })
                      const info = assertTransactionOwner(store, scope)
                      attempts.set(info.id, {
                        changes: changed,
                        apply: () => {
                          throwIfAborted(context.signal)
                          for (const write of writes) write()
                        }
                      })
                      try {
                        const commit = async (callback: (scope: ITextRedoScope) => R) => {
                          const result = await runTransactionOperation(scope, (current) =>
                            callback(current)
                          )
                          control.stopAdmission()
                          await control.runFinalizers()
                          if (failure !== undefined) throw failure
                          input.publish(changed)
                          return result
                        }
                        return pipeline
                          ? await runtime.execution.run(
                              {
                                operation: storageBackendOperation(backend, 'transaction'),
                                input: run,
                                ctx: context
                              },
                              commit
                            )
                          : await commit(run)
                      } catch (cause) {
                        throw normalizeError(cause, backend)
                      } finally {
                        attempts.delete(info.id)
                        await control.closeIterators()
                        control.close()
                      }
                    })()
                    return { status: 'committed', value }
                  }
                },
                runtime.stageBindings.concurrencyStages(store),
                controller.closingSignal
              ),
            context.signal
          )
      }
    ).finally(release)
  }
  return {
    initialize: (actual: IStorageStore<typeof kv> & IKeyValueStore & ITextRedoStore) => {
      store = actual
      if (input.enabled)
        owner = createTransactionOwner<unknown, ITextRedoScope>(
          store,
          (error) => normalizeError(error, backend),
          { asyncDisposeKey }
        )
    },
    transaction,
    tx: () => createTransactionBuilder(store, undefined, runtime.getChainMethods('tx')),
    /** All participating reads recover pending under the same physical protection before native IO. */
    read: async <R>(context: IOperationContext | undefined, run: () => R): Promise<Awaited<R>> => {
      controller.assertLive()
      if (attempts.size !== 0)
        throw new StorageContractError(StorageContractErrorCode.writeConflict, { backend })
      const release = controller.beginMutation()
      try {
        return await runWithConcurrency(
          { store, options: context ?? {}, prepare: () => runtime.journal!.prepare() },
          {
            attempt: async (attempt) => ({
              status: 'committed',
              value: await runtime.journal!.runRedo!(async () => {
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
      run: (scope: ITextRedoScope) => R
    ) => transaction(run, context, false, keys),
    binding: (forOrg: IStorageJournalBackendBinding['forOrg']): IStorageJournalBackendBinding => ({
      forOrg,
      openNamespace: async () => unsupported(),
      ...(input.enabled ? { redo } : {})
    }),
    clear: (context?: IWriteOptions) =>
      transaction(
        async (scope) => {
          await scope.removeMany(input.keys())
        },
        context,
        false
      ),
    batch: {
      getMany: async (keys, context) => {
        const values = snapshotStorageBatchKeys(keys, backend)
        if (!values.length) return []
        const operation = storageBackendOperation(backend, BrowserBatchMethod.getMany)
        return observeBrowserBatch(runtime, store, operation, values.length, () =>
          runtime.execution.run(
            { operation, input: values.map(({ key }) => key), ctx: context },
            (captured) => transaction((scope) => scope.getMany(captured), context, false)
          )
        )
      },
      setMany: async (entries, context) => {
        const values = snapshotBrowserBatchEntries(entries, backend)
        if (!values.length) return
        const operation = storageBackendOperation(backend, BrowserBatchMethod.setMany)
        return observeBrowserBatch(runtime, store, operation, values.length, () =>
          runtime.execution.run(
            { operation, input: values.map(({ key, value }) => ({ key, value })), ctx: context },
            (captured) => {
              const detached = snapshotBrowserBatchEntries(captured, backend)
              return transaction(
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
        const values = snapshotStorageBatchKeys(keys, backend)
        if (!values.length) return 0
        const operation = storageBackendOperation(backend, BrowserBatchMethod.removeMany)
        return observeBrowserBatch(runtime, store, operation, values.length, () =>
          runtime.execution.run(
            { operation, input: values.map(({ key }) => key), ctx: context },
            (captured) => {
              const detached = snapshotStorageBatchKeys(captured, backend)
              return transaction(
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
        const captured = snapshotStorageKeyPrefix(prefix, backend)
        const operation = storageBackendOperation(backend, BrowserBatchMethod.removeByPrefix)
        return observeBrowserBatch(runtime, store, operation, undefined, () =>
          runtime.execution.run({ operation, input: captured.key, ctx: context }, (prefix) =>
            transaction((scope) => scope.removeByPrefix(prefix), context, false)
          )
        )
      }
    } satisfies IBrowserBatchApi
  }
}
