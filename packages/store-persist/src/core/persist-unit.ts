import { createAbortController, type IAbortController } from '@migaia/lifecycle'
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IDisposer } from '@migaia/reactive'
import { readEnvelope, removeEnvelope, writeEnvelope } from '../storage/codec.js'
import { defaultJsonCodec } from '../storage/codec.js'
import { assertEnvelope, type IEnvelope } from './envelope.js'
import {
  createStorePersistAbortError,
  createStorePersistAggregateError,
  createStorePersistError,
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
import { PersistState } from '../state-constants.js'
import { StorePersistErrorText } from '../error-text.js'
import { assertPersistString } from './options.js'

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
    migrate: IPersistUnitOptions<TState>['migrate']
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
      migrate: options.migrate,
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
    migrate,
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
    ['migrate', migrate],
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

    const operation = writeChain.then(async () => {
      while (!disposed && writeRequested) {
        writeRequested = false
        await runWriteOperation(() =>
          runAdapterOperation(async (signal) => {
            const envelope: IEnvelope<Partial<TState>> = {
              version,
              state: assertSynchronousCallbackResult(key, 'partialize', partialize(unit.snapshot()))
            }
            await writeEnvelope(storage, key, codec, envelope, { signal })
          })
        )
      }
    })
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
    if (hydrating || hydrationFailed || !hydrationSettled) {
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
    let envelope: IEnvelope<Partial<TState>>
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
      .then(() => writeEnvelope(storage, key, codec, envelope, {}))
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
        readEnvelope(storage, key, codec, { signal })
      )
      assertActive()
      if (raw !== undefined) {
        const envelope = assertEnvelope<Partial<TState>>(raw, key)
        let state = envelope.state
        if (envelope.version !== version) {
          if (!migrate) {
            throw createStorePersistError(
              StorePersistErrorCode.envelopeInvalid,
              StorePersistErrorText.versionMismatch(key, envelope.version, version)
            )
          }
          state = assertSynchronousCallbackResult(
            key,
            'migrate',
            migrate(state as TState, envelope.version)
          ) as Partial<TState>
        }
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

  return {
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
    async flush() {
      assertActive()
      const pendingWrite = writeDrain
      clearWriteTimer()
      await settled
      if (hydrationFailed) throw hydrationError.value
      // Capture the write already observed by this flush before checking the
      // lifecycle again. If dispose wins while the adapter ignores abort, its
      // late storage failure must remain reachable as the AbortError cause.
      if (pendingWrite) await pendingWrite
      assertActive()
      await enqueueWrite()
      assertActive()
    },
    async clear() {
      assertActive()
      clearWriteTimer()
      await settled
      if (hydrationFailed) throw hydrationError.value
      assertActive()
      const operation = writeChain.then(async () => {
        assertActive()
        await runWriteOperation(() =>
          runAdapterOperation((signal) => removeEnvelope(storage, key, { signal }))
        )
      })
      writeChain = operation.catch(() => undefined)
      await operation
      assertActive()
    },
    get disposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      generationEpoch++
      for (const controller of activeOperations) controller.abort()
      activeOperations.clear()
      writeStatus.value = PersistState.disposed
      lifecycleDisposed.value = true
      if (clearWriteTimer()) {
        // A pending debounced write still owes storage the latest state.
        startFinalWrite()
      }
      stopSubscription?.()
    }
  }
}
