import { createAbortController, type IAbortController } from '@migaia/lifecycle'
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IDisposer } from '@migaia/reactive'
import {
  readEnvelopeWithStages,
  removeEnvelope,
  writeEnvelopeWithStages,
  normalizeTransactionEncodingFailure
} from '../storage/codec.js'
import { defaultJsonCodec } from '../storage/codec.js'
import {
  assertVersionedEnvelope,
  migrateEnvelopeSync,
  StorageStageKind,
  assertTransactionOwner,
  runTransactionOperation,
  type ITransactionScope,
  type ITransactionStageObserver,
  type IStorageBase,
  type IVersionedEnvelope,
  type IMigrationStep,
  type IMigrationReset,
  type ISyncMigrationSteps
} from '@migaia/storage-contract'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { isUint8Array } from '@migaia/utils/bytes'
import {
  createStorePersistAbortError,
  createStorePersistAggregateError,
  createStorePersistTypeError
} from '../errors.js'
import { StorePersistErrorCode } from '../error-code.js'
import type {
  IHydrationStatus,
  IPersistHandle,
  IPersistStatus,
  IPersistUnit,
  IPersistUnitOptions,
  IWriteStatus
} from './types.js'
import { PersistState, PersistCodecOutput } from '../state-constants.js'
import { StorePersistErrorText } from '../error-text.js'
import {
  assertPersistString,
  createPersistMigrationPlan,
  assertPersistStageKind,
  bindPersistStages
} from './options.js'
import {
  registerPersistTransactionParticipant,
  type IPersistParticipationControl
} from './persist-transaction.js'

/** Maximum single delay accepted by Web/Node timers. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Rejects an accidental async callback before its Promise can enter state or storage. */
function assertSynchronousCallbackResult<T>(key: string, name: string, value: T): T {
  let then: unknown
  try {
    then = (value as { readonly then?: unknown } | null)?.then
  } catch (error) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.callbackAsync(key, name),
      { cause: error }
    )
  }
  if (typeof then === 'function') {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.callbackAsync(key, name)
    )
  }
  return value
}

function disposedError(cause?: unknown): Error {
  return createStorePersistAbortError(
    StorePersistErrorCode.abortedByDispose,
    StorePersistErrorText.aborted,
    cause
  )
}

/** Reconciles plain-object hydration using startup snapshot as the local-write baseline. */
function mergePersistedPlainState<TState>(
  persisted: Partial<TState>,
  current: TState,
  start: TState
): TState {
  /** Accepts ordinary dictionaries regardless of whether they inherit from `Object.prototype`. */
  const isPlainPrototype = (value: object): boolean => {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  }
  if (
    persisted === null ||
    typeof persisted !== 'object' ||
    current === null ||
    typeof current !== 'object' ||
    start === null ||
    typeof start !== 'object' ||
    Array.isArray(persisted) ||
    Array.isArray(current) ||
    Array.isArray(start) ||
    !isPlainPrototype(persisted) ||
    !isPlainPrototype(current) ||
    !isPlainPrototype(start)
  )
    return persisted as TState

  const result: Record<string, unknown> = { ...(current as object) }
  for (const key of Object.keys(persisted as object)) {
    const locallyChanged = !Object.is(
      (current as Record<string, unknown>)[key],
      (start as Record<string, unknown>)[key]
    )
    if (!locallyChanged) result[key] = (persisted as Record<string, unknown>)[key]
  }
  return result as TState
}

/**
 * Connects an `IPersistUnit` to storage hydration and debounced writes. Hydration reads storage and
 * restores the unit. Unit changes trigger storage writes.
 *
 * `persist()`, `persistCollection()`, and `persistKeyed()` adapt their native APIs to
 * `IPersistUnit` and call this engine. Debouncing, disposal, and hydration races are implemented
 * here once.
 *
 * Returns a handle synchronously and starts the first read immediately; await ready before
 * depending on restored state. A failed read/restore blocks scheduled writes until recovery.
 * Writes/removals are serialized, while transform and unit callbacks remain synchronous and may
 * fail through their owning boundary. Invalid configuration throws before subscription; later
 * hydration/write failures are exposed by the handle's promises and error values. Storage, unit and
 * Runtime are borrowed; dispose stops this attachment rather than disposing those resources.
 */
export function persistUnit<
  TState,
  const TSteps extends Readonly<Record<number, IMigrationStep>> | IMigrationReset
>(
  unit: IPersistUnit<TState>,
  options: Omit<IPersistUnitOptions<TState>, 'migrations'> & {
    readonly migrations?: TSteps & ISyncMigrationSteps<NoInfer<TSteps>>
  }
): IPersistHandle
export function persistUnit<TState>(
  unit: IPersistUnit<TState>,
  options: IPersistUnitOptions<TState>
): IPersistHandle {
  let extracted: {
    key: string
    runtime: IPersistUnitOptions<TState>['runtime']
    storage: IPersistUnitOptions<TState>['storage']
    codec: IPersistUnitOptions<TState>['codec']
    version: IPersistUnitOptions<TState>['version']
    migrations: IPersistUnitOptions<TState>['migrations']
    codecStages: IPersistUnitOptions<TState>['codecStages']
    transactionStages: IPersistUnitOptions<TState>['transactionStages']
    partialize: IPersistUnitOptions<TState>['partialize']
    merge: IPersistUnitOptions<TState>['merge']
    debounceMs: IPersistUnitOptions<TState>['debounceMs']
    maxWaitMs: IPersistUnitOptions<TState>['maxWaitMs']
    scheduler: IPersistUnitOptions<TState>['scheduler']
  }
  try {
    extracted = {
      key: options.key,
      runtime: options.runtime,
      storage: options.storage,
      codec: options.codec,
      version: options.version,
      migrations: options.migrations,
      codecStages: options.codecStages,
      transactionStages: options.transactionStages,
      partialize: options.partialize,
      merge: options.merge,
      debounceMs: options.debounceMs,
      maxWaitMs: options.maxWaitMs,
      scheduler: options.scheduler
    }
  } catch (error) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.optionsObject,
      { cause: error }
    )
  }
  const {
    key,
    runtime,
    storage,
    codec = defaultJsonCodec,
    version = 0,
    migrations,
    codecStages,
    transactionStages,
    partialize = (state: TState) => state as Partial<TState>,
    // Plain-object snapshots use a shallow current-first merge so a startup
    // mutation is not lost while storage is loading. Collection/array shapes
    // remain replacement-based; callers can provide a shape-specific merge.
    merge = (persisted: Partial<TState>, current: TState) => {
      if (
        persisted !== null &&
        typeof persisted === 'object' &&
        current !== null &&
        typeof current === 'object' &&
        !Array.isArray(persisted) &&
        !Array.isArray(current) &&
        (Object.getPrototypeOf(persisted) === Object.prototype ||
          Object.getPrototypeOf(persisted) === null) &&
        (Object.getPrototypeOf(current) === Object.prototype ||
          Object.getPrototypeOf(current) === null)
      )
        return { ...(current as object), ...(persisted as object) } as TState
      return persisted as TState
    },
    debounceMs = 0,
    maxWaitMs
  } = extracted

  assertPersistString(key, 'key')
  if (!codec)
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecNotResolved,
      StorePersistErrorText.noCodec(key)
    )
  let codecShapeValid = false
  try {
    codecShapeValid =
      typeof codec === 'object' &&
      typeof codec.encode === 'function' &&
      typeof codec.decode === 'function'
  } catch (error) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.codecInvalid(key),
      { cause: error }
    )
  }
  if (!codecShapeValid) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.codecInvalid(key)
    )
  }
  try {
    if (
      storage === null ||
      typeof storage !== 'object' ||
      typeof storage.get !== 'function' ||
      typeof storage.set !== 'function' ||
      typeof storage.remove !== 'function' ||
      typeof storage.keys !== 'function' ||
      storage.capabilities === null ||
      typeof storage.capabilities !== 'object'
    ) {
      throw new Error(StorePersistErrorText.storageInvalid(key))
    }
  } catch (error) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.storageInvalid(key),
      { cause: error }
    )
  }
  for (const [name, callback] of [
    ['partialize', partialize],
    ['merge', merge]
  ] as const) {
    if (callback !== undefined && typeof callback !== 'function') {
      throw createStorePersistTypeError(
        StorePersistErrorCode.invalidOption,
        StorePersistErrorText.callback(key, name)
      )
    }
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.invalidVersion(key)
    )
  }
  if (!Number.isFinite(debounceMs) || debounceMs < 0 || debounceMs > MAX_TIMER_DELAY_MS) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.debounce(key)
    )
  }

  if (
    maxWaitMs !== undefined &&
    (!Number.isFinite(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > MAX_TIMER_DELAY_MS)
  ) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.maxWait(key)
    )
  }
  /** One frozen plan is shared by every hydration attempt and never rebuilt during reads. */
  const migrationPlan = createPersistMigrationPlan(key, version, migrations)
  assertPersistStageKind(
    codecStages,
    StorageStageKind.codec,
    StorePersistErrorText.codecStagesInvalid
  )
  assertPersistStageKind(
    transactionStages,
    StorageStageKind.transaction,
    StorePersistErrorText.transactionStagesInvalid
  )
  /** Own the debounce clock and timer through the same admitted scheduler snapshot. */
  const scheduler = resolveSchedulerOption(extracted) ?? resolveScheduler(systemScheduler)

  const hydrationStatus = runtime.signal<IHydrationStatus>(PersistState.loading)
  const hydrationError = runtime.signal<unknown>(undefined)
  const writeStatus = runtime.signal<IWriteStatus>(PersistState.idle)
  const writeError = runtime.signal<unknown>(undefined)
  /** Reactive terminal projection only; the internal open marker is not a public status value. */
  const lifecycleDisposed = runtime.signal<boolean>(false)
  const status = runtime.computed<IPersistStatus>(() => {
    if (lifecycleDisposed.value) return PersistState.disposed
    if (hydrationStatus.value === PersistState.loading) return PersistState.loading
    if (hydrationStatus.value === PersistState.error || writeStatus.value === PersistState.error)
      return PersistState.error
    return PersistState.ready
  })
  const error = runtime.computed<unknown>(() => {
    const hydration = hydrationError.value
    const write = writeError.value
    if (hydration !== undefined && write !== undefined) {
      return createStorePersistAggregateError(
        StorePersistErrorCode.hydrateAndWriteFailed,
        [hydration, write],
        StorePersistErrorText.hydrationWriteFailed
      )
    }
    return hydration ?? write ?? undefined
  })
  const hydrated = runtime.computed(() => hydrationStatus.value === PersistState.success)

  let stopSubscription: IDisposer | undefined
  /** At most one timer owns the current quiet/max-wait window. */
  let timer: IScheduledTask | undefined
  /** First-change deadline remains stable while later changes extend the quiet interval. */
  let writeDeadline: number | undefined
  let disposed = false
  /** The one cleanup outcome survives a prior synchronous dispose call. */
  let disposalFailure: unknown
  /** A thrown undefined is still a cleanup failure and must reject asynchronous disposal. */
  let disposalFailed = false
  let generationEpoch = 0
  const activeOperations = new Set<IAbortController>()
  let hydrationSettled = false
  let hydrationFailed = false
  let hydrating = false
  let dirtyDuringHydrate = false
  /** Shares a recovery read so concurrent callers cannot restore two snapshots out of order. */
  let retryPromise: Promise<void> | undefined
  const hydrationStartSnapshot = unit.snapshot()
  // 串行写队列：所有写入排成一条链，避免异步存储下"慢的旧写入后完成、覆盖新写入"的乱序问题。
  let writeChain: Promise<void> = Promise.resolve()
  /**
   * Actual unsettled write result shared by strict flush and background callers; recovery is
   * separate.
   */
  let writeDrain: Promise<void> | undefined
  let writeRequested = false
  /** Only unsettled existing mutations are retained, so this participation sees their real outcomes. */
  const pendingWrites = new Set<Promise<void>>()
  /** Application notifications identify changes made after the last successful snapshot. */
  let changeRevision = 0
  /** Each successful native write records the notification revision captured with that snapshot. */
  let persistedRevision = 0
  /** A live coordination owns admission until its actual transaction finishes. */
  let participation:
    | {
        readonly control: IPersistParticipationControl
        transactionId?: string
        store?: IStorageBase
        flushChain: Promise<void>
        flushed: boolean
        lastFlushedRevision: number
      }
    | undefined
  /** Closing only this handle's private utility queue rejects its not-yet-started coordinations. */
  let closeParticipationQueue: ((reason: unknown) => void) | undefined

  /** Pending mutation failures remain visible to a coordinator that admitted before they settled. */
  function trackPendingWrite(operation: Promise<void>): Promise<void> {
    pendingWrites.add(operation)
    void operation.then(
      () => pendingWrites.delete(operation),
      () => pendingWrites.delete(operation)
    )
    return operation
  }

  /** Direct calls cannot wait behind their own active transaction or bypass its snapshot. */
  function assertDirectOperation(): void {
    if (participation !== undefined)
      throw createStorePersistTypeError(
        StorePersistErrorCode.invalidOption,
        StorePersistErrorText.transactionDirectOperation
      )
  }

  function assertActive(): void {
    if (disposed) throw disposedError()
  }

  async function runAdapterOperation<T>(
    operation: (signal: IAbortSignal) => T | Promise<T>
  ): Promise<T> {
    assertActive()
    const controller = createAbortController()
    activeOperations.add(controller)
    try {
      const result = await operation(controller.signal)
      assertActive()
      return result
    } catch (caught) {
      if (disposed) throw disposedError(caught)
      throw caught
    } finally {
      activeOperations.delete(controller)
    }
  }

  async function runWriteOperation(operation: () => void | Promise<void>): Promise<void> {
    const operationGeneration = generationEpoch
    writeStatus.value = PersistState.writing
    try {
      await operation()
      if (disposed || operationGeneration !== generationEpoch) return
      writeStatus.value = PersistState.idle
      writeError.value = undefined
    } catch (operationError) {
      if (disposed || operationGeneration !== generationEpoch) throw operationError
      writeStatus.value = PersistState.error
      writeError.value = operationError
      throw operationError
    }
  }

  /** Coalesces requests under one observable drain, including its original rejection. */
  function enqueueWrite(): Promise<void> {
    writeRequested = true
    // A strict flush must observe the currently running debounced write itself;
    // chaining after writeChain would only see its error-swallowing recovery promise.
    if (writeDrain) return writeDrain

    const operation = trackPendingWrite(
      writeChain.then(async () => {
        while (!disposed && writeRequested) {
          writeRequested = false
          await runWriteOperation(() =>
            runAdapterOperation(async (signal) => {
              /** The persisted revision belongs to the snapshot taken before awaiting the codec. */
              const snapshotRevision = changeRevision
              const envelope: IVersionedEnvelope<Partial<TState>> = {
                version,
                state: assertSynchronousCallbackResult(
                  key,
                  'partialize',
                  partialize(unit.snapshot())
                )
              }
              await writeEnvelopeWithStages(storage, key, codec, envelope, { signal }, codecStages)
              persistedRevision = snapshotRevision
            })
          )
        }
      })
    )
    writeChain = operation.catch(() => undefined)
    writeDrain = operation
    void operation.then(
      () => {
        if (writeDrain === operation) writeDrain = undefined
      },
      () => {
        if (writeDrain === operation) writeDrain = undefined
      }
    )
    return operation
  }

  /** Cancels a whole debounce window; final disposal uses the result to retain its last snapshot. */
  function clearWriteTimer(): boolean {
    /** Clear ownership before cancellation so another operation cannot cancel this handle twice. */
    const scheduled = timer
    timer = undefined
    writeDeadline = undefined
    scheduled?.cancel()
    return scheduled !== undefined
  }

  /** Coalesces changes until quiet time or the first change's optional maximum deadline. */
  function scheduleWrite(): void {
    if (disposed) return
    // Restoring an archive is not an application mutation and must not write that archive back.
    if (hydrating) return
    changeRevision++
    if (participation !== undefined) return
    if (hydrationFailed || !hydrationSettled) {
      dirtyDuringHydrate = true
      return
    }
    if (debounceMs <= 0) {
      void enqueueWrite().catch(() => undefined)
      return
    }
    /** One clock read determines both the next quiet interval and the unchanged maximum window. */
    const now = scheduler.now()
    /** Retain the original deadline while cancelling the old quiet timer. */
    const deadline = writeDeadline ?? (maxWaitMs === undefined ? undefined : now + maxWaitMs)
    clearWriteTimer()
    writeDeadline = deadline
    timer = scheduler.schedule(
      () => {
        timer = undefined
        writeDeadline = undefined
        void enqueueWrite().catch(() => undefined)
      },
      deadline === undefined ? debounceMs : Math.min(debounceMs, Math.max(0, deadline - now))
    )
  }

  /**
   * Starts the write of a debounce window that dispose cut short. The snapshot is taken now, while
   * the unit is still intact; the write runs after the write chain and is not awaited. Its failure
   * is published on `writeError`, because the handle no longer reports write status.
   */
  function startFinalWrite(): void {
    /** Envelope built from the snapshot at dispose time. */
    let envelope: IVersionedEnvelope<Partial<TState>>
    try {
      envelope = {
        version,
        state: assertSynchronousCallbackResult(key, 'partialize', partialize(unit.snapshot()))
      }
    } catch (caught) {
      writeError.value = caught
      return
    }
    writeChain = writeChain
      .then(() => writeEnvelopeWithStages(storage, key, codec, envelope, {}, codecStages))
      .catch((caught: unknown) => {
        writeError.value = caught
      })
  }

  stopSubscription = unit.subscribe(scheduleWrite)

  const hydrateAttempt = async (): Promise<void> => {
    hydrationSettled = false
    hydrationFailed = false
    hydrationStatus.value = PersistState.loading
    hydrationError.value = undefined
    try {
      const raw = await runAdapterOperation((signal) =>
        readEnvelopeWithStages(storage, key, codec, { signal }, codecStages)
      )
      assertActive()
      if (raw !== undefined) {
        const envelope = assertVersionedEnvelope(raw)
        const state = migrateEnvelopeSync(migrationPlan, envelope) as Partial<TState>
        // Always reconcile the persisted snapshot with the current snapshot. The
        // default object merge preserves fields initialized or mutated while the
        // async read was in flight; custom store shapes can provide their own merge.
        hydrating = true
        try {
          const current = unit.snapshot()
          const reconciled =
            extracted.merge === undefined
              ? mergePersistedPlainState(state, current, hydrationStartSnapshot)
              : assertSynchronousCallbackResult(key, 'merge', merge(state, current))
          unit.restore(reconciled)
        } finally {
          hydrating = false
        }
      }
      assertActive()
      hydrationStatus.value = PersistState.success
      hydrationError.value = undefined
      hydrationSettled = true
      const shouldWriteAfterHydrate = dirtyDuringHydrate
      dirtyDuringHydrate = false
      if (shouldWriteAfterHydrate) scheduleWrite()
    } catch (caught) {
      if (disposed) throw caught
      hydrationError.value = caught
      hydrationStatus.value = PersistState.error
      hydrationSettled = true
      hydrationFailed = true
      throw caught
    }
  }

  /** The original attempt owns readiness success/rejection, including disposal cancellation. */
  const ready = hydrateAttempt()
  /** Background barriers may always settle without changing the public attempt result. */
  const settled = ready.catch(() => undefined)

  /** Stops admission immediately and queues the final snapshot before releasing the subscription. */
  const dispose = (): void => {
    if (disposed) return
    try {
      disposed = true
      /** The same cancellation reaches an active native transaction before its callback returns. */
      const cancellation = disposedError()
      participation?.control.abort(cancellation)
      closeParticipationQueue?.(cancellation)
      generationEpoch++
      for (const controller of activeOperations) controller.abort()
      activeOperations.clear()
      writeStatus.value = PersistState.disposed
      lifecycleDisposed.value = true
      /** An admitted write is aborted below or never starts, because its loop stops on `disposed`. */
      const writeAdmitted = writeDrain !== undefined
      if ((clearWriteTimer() || writeAdmitted) && participation === undefined) {
        // A pending debounce window or an admitted write still owes storage the latest state.
        startFinalWrite()
      }
      stopSubscription?.()
    } catch (cause) {
      disposalFailed = true
      disposalFailure = cause
      throw cause
    }
  }

  /** Explicit and symbol callers share cleanup but retain separate stable Promise identities. */
  let disposalPromise: Promise<void> | undefined
  /** Symbol disposal reports primary failure without rejecting a language-managed cleanup. */
  let symbolDisposalPromise: Promise<void> | undefined
  /** Synchronous admission stops first; the Promise still waits for all admitted writes. */
  const disposeAsync = (): Promise<void> => {
    if (disposalPromise !== undefined) return disposalPromise
    /** Retain actual transaction completion before disposal can change attachment state. */
    const transactionCompletion = participation?.control.completion
    // Cache before unsubscribe can reenter disposal, while stopping admission synchronously.
    disposalPromise = Promise.resolve()
      .then(() => writeChain)
      .then(() => transactionCompletion)
      .then(() => {
        if (disposalFailed) throw disposalFailure
      })
    try {
      dispose()
    } catch (cause) {
      disposalFailed = true
      disposalFailure = cause
    }
    return disposalPromise
  }
  /** Runtime reporting uses the observer's owning reporter when one was supplied. */
  const reportDisposalFailure = (cause: unknown): void => {
    observeThenableRejection(undefined, { error: cause }, (error) => {
      if (codecStages === undefined) throw error
      codecStages.report(error)
    })
  }

  /** All adapters return this original handle, which alone receives private enlistment authority. */
  const handle: IPersistHandle = {
    status,
    error,
    hydrated,
    hydrationStatus,
    hydrationError,
    writeStatus,
    writeError,
    ready,
    settled,
    async retryHydrate() {
      assertActive()
      assertDirectOperation()
      if (!hydrationFailed) {
        await settled
        if (hydrationFailed) throw hydrationError.value
        return
      }
      if (retryPromise !== undefined) return retryPromise
      retryPromise = hydrateAttempt()
      try {
        await retryPromise
      } finally {
        retryPromise = undefined
      }
    },
    flush(tx) {
      if (tx !== undefined) {
        try {
          return flushTransaction(tx)
        } catch (cause) {
          return Promise.reject(cause)
        }
      }
      return flushDirect()
    },
    async clear() {
      assertActive()
      assertDirectOperation()
      clearWriteTimer()
      await settled
      if (hydrationFailed) throw hydrationError.value
      assertActive()
      assertDirectOperation()
      /** Existing queued removals remain observable until their real completion. */
      const operation = trackPendingWrite(
        writeChain.then(async () => {
          assertActive()
          await runWriteOperation(() =>
            runAdapterOperation((signal) => removeEnvelope(storage, key, { signal }, codec))
          )
        })
      )
      writeChain = operation.catch(() => undefined)
      await operation
      assertActive()
    },
    get disposed() {
      return disposed
    },
    dispose,
    disposeAsync,
    [asyncDisposeKey]() {
      symbolDisposalPromise ??= disposeAsync().catch(reportDisposalFailure)
      return symbolDisposalPromise
    }
  }

  /** Direct flushing retains the original queue, hydration and cancellation behavior. */
  async function flushDirect(): Promise<void> {
    assertActive()
    assertDirectOperation()
    const pendingWrite = writeDrain
    clearWriteTimer()
    await settled
    if (hydrationFailed) throw hydrationError.value
    // Capture the write already observed by this flush before checking the
    // lifecycle again. If dispose wins while the adapter ignores abort, its
    // late storage failure must remain reachable as the AbortError cause.
    if (pendingWrite) await pendingWrite
    assertActive()
    assertDirectOperation()
    await enqueueWrite()
    assertActive()
  }

  /** Captures and starts conversion inside the canonical operation owner before queuing requests. */
  function flushTransaction(tx: Omit<ITransactionScope, 'use'>): Promise<void> {
    assertActive()
    /** Only a handle enlisted in this active original transaction may use any derived view. */
    const active = participation
    if (active === undefined || active.transactionId === undefined || active.store === undefined)
      throw createStorePersistTypeError(
        StorePersistErrorCode.invalidOption,
        StorePersistErrorText.transactionParticipation
      )
    /** Keep the ownership guard's failure as cause without wrapping local mismatch twice. */
    let transactionId: string
    try {
      transactionId = assertTransactionOwner(active.store, tx).id
    } catch (cause) {
      throw createStorePersistTypeError(
        StorePersistErrorCode.invalidOption,
        StorePersistErrorText.transactionParticipation,
        { cause }
      )
    }
    if (transactionId !== active.transactionId)
      throw createStorePersistTypeError(
        StorePersistErrorCode.invalidOption,
        StorePersistErrorText.transactionParticipation
      )
    return runTransactionOperation(tx, (scope) => {
      active.flushed = true
      writeStatus.value = PersistState.writing
      /** Snapshot failures belong to encoding and are registered before the first native request. */
      let envelope: IVersionedEnvelope<unknown>
      /** The notification revision is read in the same synchronous call as the state snapshot. */
      const snapshotRevision = changeRevision
      try {
        /** Async identity byte codecs must receive this call's bytes, not a later mutable view. */
        const state = assertSynchronousCallbackResult(
          key,
          'partialize',
          partialize(unit.snapshot())
        )
        envelope = {
          version,
          state:
            codec.output === PersistCodecOutput.binary && isUint8Array(state)
              ? new Uint8Array(state)
              : state
        }
      } catch (cause) {
        throw normalizeTransactionEncodingFailure(cause)
      }
      /** Observation binds the authentic operation view, without keeping a root-store fallback. */
      const selectedCodecStages = bindPersistStages(codecStages, scope)
      /** The transaction owner remains responsible for mode, identity and view expiration. */
      const selectedTransactionStages = bindPersistStages(transactionStages, scope)
      observePersistFlush(selectedTransactionStages, 'beforePersistFlush')
      /** Retain this predecessor without observing a rejected ordering Promise before conversion. */
      const previousFlush = active.flushChain
      /** Conversion sees this call's state immediately; native writes retain the original order. */
      const operation = writeEnvelopeWithStages(
        {
          capabilities: storage.capabilities,
          set: (archiveKey, text) => scope.set(archiveKey, text, { conflictPolicy: 'replace' }),
          getBytes: (archiveKey) => scope.getBytes(archiveKey),
          setBytes: (archiveKey, bytes) =>
            scope.setBytes(archiveKey, bytes, { conflictPolicy: 'replace' })
        },
        key,
        codec,
        envelope,
        {},
        selectedCodecStages,
        normalizeTransactionEncodingFailure,
        () => previousFlush.then(assertActive)
      ).then(() => {
        active.lastFlushedRevision = snapshotRevision
        observePersistFlush(selectedTransactionStages, 'afterPersistFlush')
      })
      active.flushChain = operation
      return operation
    })
  }

  /** Public transaction observations cannot wait, veto conversion, or replace its failure. */
  function observePersistFlush(
    observer: ITransactionStageObserver | undefined,
    stage: 'beforePersistFlush' | 'afterPersistFlush'
  ): void {
    if (observer === undefined) return
    try {
      /** Dynamic callback getters belong to the same report-only observation boundary. */
      const callback = observer[stage]
      if (callback === undefined) return
      /** No business state or encoded value enters this observation. */
      const result = Reflect.apply(callback, observer, [])
      observeThenableRejection(result, inspectThenable(result), (error) => observer.report(error))
    } catch (error) {
      observeThenableRejection(undefined, { error }, (failure) => observer.report(failure))
    }
  }

  closeParticipationQueue = registerPersistTransactionParticipant(handle, {
    storage,
    disposed: () => disposed,
    async pause(control) {
      assertActive()
      participation = {
        control,
        flushChain: Promise.resolve(),
        flushed: false,
        lastFlushedRevision: persistedRevision
      }
      clearWriteTimer()
      /** Snapshot every already-admitted outcome before new direct mutations are closed out. */
      const pending = [...pendingWrites]
      await settled
      if (retryPromise !== undefined) await retryPromise
      if (hydrationFailed) throw hydrationError.value
      /** Wait all old work before examining failure, so another handle can never overtake it. */
      const outcomes = await Promise.allSettled(pending)
      for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason
      await writeChain
      assertActive()
    },
    bind(scope, owner) {
      assertActive()
      if (participation === undefined)
        throw createStorePersistTypeError(
          StorePersistErrorCode.invalidOption,
          StorePersistErrorText.transactionParticipation
        )
      participation.store = owner
      participation.transactionId = assertTransactionOwner(owner, scope).id
      participation.flushChain = Promise.resolve()
      participation.flushed = false
    },
    finish(committed, failure) {
      /** Stop retaining native identity as soon as its owner has actually settled. */
      const completed = participation
      participation = undefined
      if (completed === undefined || disposed) return
      if (committed && completed.flushed) persistedRevision = completed.lastFlushedRevision
      if (completed.flushed) {
        writeStatus.value = committed ? PersistState.idle : PersistState.error
        writeError.value = committed ? undefined : failure
      }
      if (changeRevision !== persistedRevision) {
        try {
          scheduleWrite()
        } catch (cause) {
          // A committed transaction stays committed; failed mirroring remains an ordinary write outcome.
          writeError.value = cause
          writeStatus.value = PersistState.error
          throw cause
        }
      }
    }
  })
  return handle
}
