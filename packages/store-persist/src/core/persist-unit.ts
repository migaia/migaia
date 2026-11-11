import { runPersistCallback } from './persist-callback.ts'
import { createAbortController, type IAbortController } from '@migaia/lifecycle'
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IDisposer, IReactiveComputed, IReactiveSignal } from '@migaia/reactive'
import {
  readEnvelopeWithStages,
  removeEnvelope,
  writeEnvelopeWithStages,
  normalizeTransactionEncodingFailure
} from '../storage/codec.ts'
import { defaultJsonCodec } from '../storage/codec.ts'
import {
  assertVersionedEnvelope,
  StorageStageKind,
  type ITransactionScope,
  type ITransactionStageObserver,
  type IStorageBase,
  type IVersionedEnvelope,
  type IMigrationStep,
  type IMigrationReset,
  type ISyncMigrationSteps
} from '@migaia/storage-contract'
import {
  assertTransactionOwner,
  runTransactionOperation,
  migrateEnvelopeSync
} from '@migaia/storage-host/sdk'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { isUint8Array } from '@migaia/utils/bytes'
import {
  createStorePersistAbortError,
  createStorePersistAggregateError,
  createStorePersistTypeError
} from '../errors.ts'
import { StorePersistErrorCode } from '../error-code.ts'
import type {
  IHydrationStatus,
  IPersistHandle,
  IPersistStatus,
  IPersistUnit,
  IPersistUnitOptions,
  IWriteStatus
} from './types.ts'
import { PersistState, PersistCodecOutput } from '../state-constants.ts'
import { StorePersistErrorText } from '../error-text.ts'
import {
  assertPersistString,
  createPersistMigrationPlan,
  assertPersistStageKind,
  bindPersistStages
} from './options.ts'
import {
  registerPersistTransactionParticipant,
  type IPersistParticipationControl
} from './persist-transaction.ts'

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
  return new PersistUnitAttachment(unit, readPersistUnitOptions(options)).handle
}

/** Validated persist options with defaults applied and the migration plan built once. */
type IResolvedPersistUnitOptions<TState> = Readonly<{
  key: string
  runtime: IPersistUnitOptions<TState>['runtime']
  storage: IPersistUnitOptions<TState>['storage']
  codec: NonNullable<IPersistUnitOptions<TState>['codec']>
  version: number
  codecStages: IPersistUnitOptions<TState>['codecStages']
  transactionStages: IPersistUnitOptions<TState>['transactionStages']
  partialize: (state: TState) => Partial<TState>
  merge: (persisted: Partial<TState>, current: TState) => TState
  /** True when the caller supplied `merge`; otherwise hydration uses the plain-state merge. */
  customMerge: boolean
  debounceMs: number
  maxWaitMs: number | undefined
  /** One frozen plan is shared by every hydration attempt and never rebuilt during reads. */
  migrationPlan: ReturnType<typeof createPersistMigrationPlan>
  /** Own the debounce clock and timer through the same admitted scheduler snapshot. */
  scheduler: ReturnType<typeof resolveScheduler>
}>

/** Reads every option once, then validates codec, storage, callbacks, timings and stages. */
function readPersistUnitOptions<TState>(
  options: IPersistUnitOptions<TState>
): IResolvedPersistUnitOptions<TState> {
  /** Raw option values, read once; a throwing getter is INVALID_OPTION. */
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
    partialize = defaultPartialize as (state: TState) => Partial<TState>,
    merge = defaultPersistMerge as (persisted: Partial<TState>, current: TState) => TState,
    debounceMs = 0,
    maxWaitMs
  } = extracted

  assertPersistString(key, 'key')
  if (!codec)
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecNotResolved,
      StorePersistErrorText.noCodec(key)
    )
  /** Whether the codec exposes callable encode/decode; a throwing getter is INVALID_OPTION. */
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
  return {
    key,
    runtime,
    storage,
    codec,
    version,
    codecStages,
    transactionStages,
    partialize,
    merge,
    customMerge: extracted.merge !== undefined,
    debounceMs,
    maxWaitMs,
    migrationPlan,
    scheduler: resolveSchedulerOption(extracted) ?? resolveScheduler(systemScheduler)
  }
}

/** Default partialize: persist the whole snapshot. */
function defaultPartialize<TState>(state: TState): Partial<TState> {
  return state as Partial<TState>
}

/**
 * Default merge. Plain-object snapshots use a shallow current-first merge so a startup mutation is
 * not lost while storage is loading. Collection/array shapes remain replacement-based; callers can
 * provide a shape-specific merge.
 */
function defaultPersistMerge<TState>(persisted: Partial<TState>, current: TState): TState {
  if (
    persisted !== null &&
    typeof persisted === 'object' &&
    current !== null &&
    typeof current === 'object' &&
    !Array.isArray(persisted) &&
    !Array.isArray(current) &&
    (Object.getPrototypeOf(persisted) === Object.prototype ||
      Object.getPrototypeOf(persisted) === null) &&
    (Object.getPrototypeOf(current) === Object.prototype || Object.getPrototypeOf(current) === null)
  )
    return { ...(current as object), ...(persisted as object) } as TState
  return persisted as TState
}

/** A live coordination owns admission until its actual transaction finishes. */
type IPersistParticipation = {
  readonly control: IPersistParticipationControl
  transactionId?: string
  store?: IStorageBase
  flushChain: Promise<void>
  flushed: boolean
  lastFlushedRevision: number
}

/**
 * One persistence attachment of a unit to storage: hydration, debounced serialized writes,
 * transaction participation and disposal. The public handle forwards to this owner.
 */
class PersistUnitAttachment<TState> {
  /** Persisted unit; borrowed, never disposed here. */
  readonly #unit: IPersistUnit<TState>
  /** Validated options. */
  readonly #options: IResolvedPersistUnitOptions<TState>
  /** Hydration progress. */
  readonly hydrationStatus: IReactiveSignal<IHydrationStatus>
  /** Last hydration failure. */
  readonly hydrationError: IReactiveSignal<unknown>
  /** Write progress. */
  readonly writeStatus: IReactiveSignal<IWriteStatus>
  /** Last write failure. */
  readonly writeError: IReactiveSignal<unknown>
  /** Reactive terminal projection only; the internal open marker is not a public status value. */
  readonly #lifecycleDisposed: IReactiveSignal<boolean>
  /** Combined public status. */
  readonly status: IReactiveComputed<IPersistStatus>
  /** Combined hydration/write error. */
  readonly error: IReactiveComputed<unknown>
  /** Whether hydration succeeded. */
  readonly hydrated: IReactiveComputed<boolean>
  /** Stops the unit subscription. */
  #stopSubscription: IDisposer | undefined
  /** At most one timer owns the current quiet/max-wait window. */
  #timer: IScheduledTask | undefined
  /** First-change deadline remains stable while later changes extend the quiet interval. */
  #writeDeadline: number | undefined
  /** Set by dispose; stops all admission. */
  #disposed = false
  /** The one cleanup outcome survives a prior synchronous dispose call. */
  #disposalFailure: unknown
  /** A thrown undefined is still a cleanup failure and must reject asynchronous disposal. */
  #disposalFailed = false
  /** Bumped by dispose so late write outcomes from an earlier generation are ignored. */
  #generationEpoch = 0
  /** Abort controllers of in-flight adapter operations. */
  readonly #activeOperations = new Set<IAbortController>()
  /** Whether the current hydration attempt finished (success or failure). */
  #hydrationSettled = false
  /** Whether the current hydration attempt failed. */
  #hydrationFailed = false
  /** True while restoring a hydrated snapshot; such restores are not application changes. */
  #hydrating = false
  /** A change arrived before hydration settled; write once hydration succeeds. */
  #dirtyDuringHydrate = false
  /** Shares a recovery read so concurrent callers cannot restore two snapshots out of order. */
  #retryPromise: Promise<void> | undefined
  /** Unit snapshot at attachment, used by the default plain-state merge. */
  readonly #hydrationStartSnapshot: TState
  /** 串行写队列：所有写入排成一条链，避免异步存储下"慢的旧写入后完成、覆盖新写入"的乱序问题。 */
  #writeChain: Promise<void> = Promise.resolve()
  /**
   * Actual unsettled write result shared by strict flush and background callers; recovery is
   * separate.
   */
  #writeDrain: Promise<void> | undefined
  /** Another write was requested while the drain loop runs. */
  #writeRequested = false
  /** Only unsettled existing mutations are retained, so participation sees their real outcomes. */
  readonly #pendingWrites = new Set<Promise<void>>()
  /** Application notifications identify changes made after the last successful snapshot. */
  #changeRevision = 0
  /** Each successful native write records the notification revision captured with that snapshot. */
  #persistedRevision = 0
  /** A live coordination owns admission until its actual transaction finishes. */
  #participation: IPersistParticipation | undefined
  /** Closing only this handle's private utility queue rejects its not-yet-started coordinations. */
  readonly #closeParticipationQueue: (reason: unknown) => void
  /** Explicit and symbol callers share cleanup but retain separate stable Promise identities. */
  #disposalPromise: Promise<void> | undefined
  /** Symbol disposal reports primary failure without rejecting a language-managed cleanup. */
  #symbolDisposalPromise: Promise<void> | undefined
  /** The original attempt owns readiness success/rejection, including disposal cancellation. */
  readonly ready: Promise<void>
  /** Background barriers may always settle without changing the public attempt result. */
  readonly settled: Promise<void>
  /** Original public handle; it alone receives private enlistment authority. */
  readonly handle: IPersistHandle

  /** Creates signals, subscribes, starts hydration and registers transaction participation. */
  constructor(unit: IPersistUnit<TState>, options: IResolvedPersistUnitOptions<TState>) {
    this.#unit = unit
    this.#options = options
    const runtime = options.runtime
    this.hydrationStatus = runtime.signal<IHydrationStatus>(PersistState.loading)
    this.hydrationError = runtime.signal<unknown>(undefined)
    this.writeStatus = runtime.signal<IWriteStatus>(PersistState.idle)
    this.writeError = runtime.signal<unknown>(undefined)
    this.#lifecycleDisposed = runtime.signal<boolean>(false)
    this.status = runtime.computed<IPersistStatus>(() => this.#readStatus())
    this.error = runtime.computed<unknown>(() => this.#readError())
    this.hydrated = runtime.computed(() => this.hydrationStatus.value === PersistState.success)
    this.#hydrationStartSnapshot = unit.snapshot()
    this.#stopSubscription = unit.subscribe(this.scheduleWrite)
    this.ready = this.#hydrateAttempt()
    this.settled = this.ready.catch(() => undefined)
    this.handle = createPersistHandle(this)
    this.#closeParticipationQueue = registerPersistTransactionParticipant(this.handle, {
      storage: options.storage,
      disposed: () => this.#disposed,
      pause: (control) => this.#pause(control),
      bind: (scope, owner) => this.#bind(scope, owner),
      finish: (committed, failure) => this.#finish(committed, failure)
    })
  }

  /** Public status: disposed, loading, error, or ready. */
  #readStatus(): IPersistStatus {
    if (this.#lifecycleDisposed.value) return PersistState.disposed
    if (this.hydrationStatus.value === PersistState.loading) return PersistState.loading
    if (
      this.hydrationStatus.value === PersistState.error ||
      this.writeStatus.value === PersistState.error
    )
      return PersistState.error
    return PersistState.ready
  }

  /** Public error: both failures aggregated, or whichever one exists. */
  #readError(): unknown {
    const hydration = this.hydrationError.value
    const write = this.writeError.value
    if (hydration !== undefined && write !== undefined) {
      return createStorePersistAggregateError(
        StorePersistErrorCode.hydrateAndWriteFailed,
        [hydration, write],
        StorePersistErrorText.hydrationWriteFailed
      )
    }
    return hydration ?? write ?? undefined
  }

  /** Whether dispose ran. */
  get disposed(): boolean {
    return this.#disposed
  }

  /** Pending mutation failures remain visible to a coordinator that admitted before they settled. */
  #trackPendingWrite(operation: Promise<void>): Promise<void> {
    this.#pendingWrites.add(operation)
    void operation.then(
      () => this.#pendingWrites.delete(operation),
      () => this.#pendingWrites.delete(operation)
    )
    return operation
  }

  /** Direct calls cannot wait behind their own active transaction or bypass its snapshot. */
  #assertDirectOperation(): void {
    if (this.#participation !== undefined)
      throw createStorePersistTypeError(
        StorePersistErrorCode.invalidOption,
        StorePersistErrorText.transactionDirectOperation
      )
  }

  /** Throws the disposed error after dispose. */
  readonly #assertActive = (): void => {
    if (this.#disposed) throw disposedError()
  }

  /** Runs one cancellable adapter operation; disposal aborts it and rewrites its failure. */
  async #runAdapterOperation<T>(operation: (signal: IAbortSignal) => T | Promise<T>): Promise<T> {
    this.#assertActive()
    /** Cancels this operation on dispose. */
    const controller = createAbortController()
    this.#activeOperations.add(controller)
    try {
      const result = await operation(controller.signal)
      this.#assertActive()
      return result
    } catch (caught) {
      if (this.#disposed) throw disposedError(caught)
      throw caught
    } finally {
      this.#activeOperations.delete(controller)
    }
  }

  /** Publishes write status around one write; a stale generation leaves status untouched. */
  async #runWriteOperation(operation: () => void | Promise<void>): Promise<void> {
    /** Generation this write belongs to. */
    const operationGeneration = this.#generationEpoch
    this.writeStatus.value = PersistState.writing
    try {
      await operation()
      if (this.#disposed || operationGeneration !== this.#generationEpoch) return
      this.writeStatus.value = PersistState.idle
      this.writeError.value = undefined
    } catch (operationError) {
      if (this.#disposed || operationGeneration !== this.#generationEpoch) throw operationError
      this.writeStatus.value = PersistState.error
      this.writeError.value = operationError
      throw operationError
    }
  }

  /** The current partialized snapshot. */
  #partializedSnapshot(): Partial<TState> {
    return assertSynchronousCallbackResult(
      this.#options.key,
      'partialize',
      this.#options.partialize(this.#unit.snapshot())
    )
  }

  /** Adapter operation writing the current snapshot and recording its revision. */
  readonly #writeOperation = async (signal: IAbortSignal): Promise<void> => {
    /** The persisted revision belongs to the snapshot taken before awaiting the codec. */
    const snapshotRevision = this.#changeRevision
    const envelope: IVersionedEnvelope<Partial<TState>> = {
      version: this.#options.version,
      state: runPersistCallback(
        StorePersistErrorCode.encodeFailed,
        StorePersistErrorText.partializeFailed,
        () => this.#partializedSnapshot()
      )
    }
    await writeEnvelopeWithStages(
      this.#options.storage,
      this.#options.key,
      this.#options.codec,
      envelope,
      { signal },
      this.#options.codecStages
    )
    this.#persistedRevision = snapshotRevision
  }

  /** Adapter operation removing the stored envelope. */
  readonly #removeOperation = (signal: IAbortSignal) =>
    removeEnvelope(this.#options.storage, this.#options.key, { signal }, this.#options.codec)

  /** Adapter operation reading the stored envelope. */
  readonly #readOperation = (signal: IAbortSignal) =>
    readEnvelopeWithStages(
      this.#options.storage,
      this.#options.key,
      this.#options.codec,
      { signal },
      this.#options.codecStages
    )

  /** Writes until no further write was requested while one ran. */
  async #drainWrites(): Promise<void> {
    while (!this.#disposed && this.#writeRequested) {
      this.#writeRequested = false
      await this.#runWriteOperation(() => this.#runAdapterOperation(this.#writeOperation))
    }
  }

  /** Coalesces requests under one observable drain, including its original rejection. */
  #enqueueWrite(): Promise<void> {
    this.#writeRequested = true
    // A strict flush must observe the currently running debounced write itself; chaining after
    // writeChain would only see its error-swallowing recovery promise.
    if (this.#writeDrain) return this.#writeDrain
    /** The drain this request joins. */
    const operation = this.#trackPendingWrite(this.#writeChain.then(() => this.#drainWrites()))
    this.#writeChain = operation.catch(() => undefined)
    this.#writeDrain = operation
    void operation.then(
      () => this.#releaseDrain(operation),
      () => this.#releaseDrain(operation)
    )
    return operation
  }

  /** Forgets a settled drain unless a newer one replaced it. */
  #releaseDrain(operation: Promise<void>): void {
    if (this.#writeDrain === operation) this.#writeDrain = undefined
  }

  /** Cancels a whole debounce window; final disposal uses the result to retain its last snapshot. */
  #clearWriteTimer(): boolean {
    /** Clear ownership before cancellation so another operation cannot cancel this handle twice. */
    const scheduled = this.#timer
    this.#timer = undefined
    this.#writeDeadline = undefined
    scheduled?.cancel()
    return scheduled !== undefined
  }

  /** Coalesces changes until quiet time or the first change's optional maximum deadline. */
  readonly scheduleWrite = (): void => {
    if (this.#disposed) return
    // Restoring an archive is not an application mutation and must not write that archive back.
    if (this.#hydrating) return
    this.#changeRevision++
    if (this.#participation !== undefined) return
    if (this.#hydrationFailed || !this.#hydrationSettled) {
      this.#dirtyDuringHydrate = true
      return
    }
    if (this.#options.debounceMs <= 0) {
      void this.#enqueueWrite().catch(() => undefined)
      return
    }
    /** One clock read determines both the next quiet interval and the unchanged maximum window. */
    const now = this.#options.scheduler.now()
    /** Retain the original deadline while cancelling the old quiet timer. */
    const deadline =
      this.#writeDeadline ??
      (this.#options.maxWaitMs === undefined ? undefined : now + this.#options.maxWaitMs)
    this.#clearWriteTimer()
    this.#writeDeadline = deadline
    this.#timer = this.#options.scheduler.schedule(
      () => this.#onWriteTimer(),
      deadline === undefined
        ? this.#options.debounceMs
        : Math.min(this.#options.debounceMs, Math.max(0, deadline - now))
    )
  }

  /** Debounce window ended: start the write. */
  #onWriteTimer(): void {
    this.#timer = undefined
    this.#writeDeadline = undefined
    void this.#enqueueWrite().catch(() => undefined)
  }

  /**
   * Starts the write of a debounce window that dispose cut short. The snapshot is taken now, while
   * the unit is still intact; the write runs after the write chain and is not awaited. Its failure
   * is published on `writeError`, because the handle no longer reports write status.
   */
  #startFinalWrite(): void {
    /** Envelope built from the snapshot at dispose time. */
    let envelope: IVersionedEnvelope<Partial<TState>>
    try {
      envelope = { version: this.#options.version, state: this.#partializedSnapshot() }
    } catch (caught) {
      this.writeError.value = caught
      return
    }
    this.#writeChain = this.#writeChain
      .then(() =>
        writeEnvelopeWithStages(
          this.#options.storage,
          this.#options.key,
          this.#options.codec,
          envelope,
          {},
          this.#options.codecStages
        )
      )
      .catch((caught: unknown) => {
        this.writeError.value = caught
      })
  }

  /** One hydration attempt: read, migrate, merge with the live snapshot and restore. */
  async #hydrateAttempt(): Promise<void> {
    this.#hydrationSettled = false
    this.#hydrationFailed = false
    this.hydrationStatus.value = PersistState.loading
    this.hydrationError.value = undefined
    try {
      /** Stored envelope, if any. */
      const raw = await this.#runAdapterOperation(this.#readOperation)
      this.#assertActive()
      if (raw !== undefined) this.#restoreEnvelope(raw)
      this.#assertActive()
      this.hydrationStatus.value = PersistState.success
      this.hydrationError.value = undefined
      this.#hydrationSettled = true
      /** Whether a change arrived while hydrating. */
      const shouldWriteAfterHydrate = this.#dirtyDuringHydrate
      this.#dirtyDuringHydrate = false
      if (shouldWriteAfterHydrate) this.scheduleWrite()
    } catch (caught) {
      if (this.#disposed) throw caught
      this.hydrationError.value = caught
      this.hydrationStatus.value = PersistState.error
      this.#hydrationSettled = true
      this.#hydrationFailed = true
      throw caught
    }
  }

  /**
   * Restores one stored envelope. Always reconciles the persisted snapshot with the current one:
   * the default object merge preserves fields initialized or mutated while the async read was in
   * flight; custom store shapes can provide their own merge.
   */
  #restoreEnvelope(raw: unknown): void {
    /** Validated envelope. */
    const envelope = assertVersionedEnvelope(raw)
    /** Migrated persisted state. */
    const state = migrateEnvelopeSync(this.#options.migrationPlan, envelope) as Partial<TState>
    this.#hydrating = true
    try {
      /** Live snapshot at restore time. */
      const current = this.#unit.snapshot()
      /** State actually restored. */
      const reconciled = this.#options.customMerge
        ? runPersistCallback(
            StorePersistErrorCode.mergeFailed,
            StorePersistErrorText.mergeFailed,
            () =>
              assertSynchronousCallbackResult(
                this.#options.key,
                'merge',
                this.#options.merge(state, current)
              )
          )
        : mergePersistedPlainState(state, current, this.#hydrationStartSnapshot)
      this.#unit.restore(reconciled)
    } finally {
      this.#hydrating = false
    }
  }

  /** Stops admission immediately and queues the final snapshot before releasing the subscription. */
  readonly dispose = (): void => {
    if (this.#disposed) return
    try {
      this.#disposed = true
      /** The same cancellation reaches an active native transaction before its callback returns. */
      const cancellation = disposedError()
      this.#participation?.control.abort(cancellation)
      this.#closeParticipationQueue(cancellation)
      this.#generationEpoch++
      for (const controller of this.#activeOperations) controller.abort()
      this.#activeOperations.clear()
      this.writeStatus.value = PersistState.disposed
      this.#lifecycleDisposed.value = true
      /** An admitted write is aborted below or never starts, because its loop stops on `disposed`. */
      const writeAdmitted = this.#writeDrain !== undefined
      if ((this.#clearWriteTimer() || writeAdmitted) && this.#participation === undefined) {
        // A pending debounce window or an admitted write still owes storage the latest state.
        this.#startFinalWrite()
      }
      this.#stopSubscription?.()
    } catch (cause) {
      this.#disposalFailed = true
      this.#disposalFailure = cause
      throw cause
    }
  }

  /** Synchronous admission stops first; the Promise still waits for all admitted writes. */
  readonly disposeAsync = (): Promise<void> => {
    if (this.#disposalPromise !== undefined) return this.#disposalPromise
    /** Retain actual transaction completion before disposal can change attachment state. */
    const transactionCompletion = this.#participation?.control.completion
    // Cache before unsubscribe can reenter disposal, while stopping admission synchronously.
    this.#disposalPromise = Promise.resolve()
      .then(() => this.#writeChain)
      .then(() => transactionCompletion)
      .then(() => this.#rethrowDisposalFailure())
    try {
      this.dispose()
    } catch (cause) {
      this.#disposalFailed = true
      this.#disposalFailure = cause
    }
    return this.#disposalPromise
  }

  /** Rejects asynchronous disposal with the recorded cleanup failure, if any. */
  #rethrowDisposalFailure(): void {
    if (this.#disposalFailed) throw this.#disposalFailure
  }

  /** Symbol disposal: shared cleanup that only reports a failure. */
  readonly symbolDispose = (): Promise<void> => {
    this.#symbolDisposalPromise ??= this.disposeAsync().catch(this.#reportDisposalFailure)
    return this.#symbolDisposalPromise
  }

  /** Runtime reporting uses the observer's owning reporter when one was supplied. */
  readonly #reportDisposalFailure = (cause: unknown): void => {
    observeThenableRejection(undefined, { error: cause }, (error) =>
      this.#reportCodecStageFailure(error)
    )
  }

  /** Reports through the codec stages, or rethrows to the default reporter when there are none. */
  #reportCodecStageFailure(error: unknown): void {
    if (this.#options.codecStages === undefined) throw error
    this.#options.codecStages.report(error)
  }

  /** Retries a failed hydration; otherwise waits for the current one. */
  readonly retryHydrate = async (): Promise<void> => {
    this.#assertActive()
    this.#assertDirectOperation()
    if (!this.#hydrationFailed) {
      await this.settled
      if (this.#hydrationFailed) throw this.hydrationError.value
      return
    }
    if (this.#retryPromise !== undefined) return this.#retryPromise
    this.#retryPromise = this.#hydrateAttempt()
    try {
      await this.#retryPromise
    } finally {
      this.#retryPromise = undefined
    }
  }

  /** Flushes directly, or inside the given transaction scope. */
  readonly flush = (tx?: Omit<ITransactionScope, 'use'>): Promise<void> => {
    if (tx !== undefined) {
      try {
        return this.#flushTransaction(tx)
      } catch (cause) {
        return Promise.reject(cause)
      }
    }
    return this.#flushDirect()
  }

  /** Removes the stored envelope after hydration settles, behind any queued write. */
  readonly clear = async (): Promise<void> => {
    this.#assertActive()
    this.#assertDirectOperation()
    this.#clearWriteTimer()
    await this.settled
    if (this.#hydrationFailed) throw this.hydrationError.value
    this.#assertActive()
    this.#assertDirectOperation()
    /** Existing queued removals remain observable until their real completion. */
    const operation = this.#trackPendingWrite(this.#writeChain.then(() => this.#removeStored()))
    this.#writeChain = operation.catch(() => undefined)
    await operation
    this.#assertActive()
  }

  /** Queued removal body. */
  async #removeStored(): Promise<void> {
    this.#assertActive()
    await this.#runWriteOperation(() => this.#runAdapterOperation(this.#removeOperation))
  }

  /** Direct flushing retains the original queue, hydration and cancellation behavior. */
  async #flushDirect(): Promise<void> {
    this.#assertActive()
    this.#assertDirectOperation()
    /** Write already running when the flush started. */
    const pendingWrite = this.#writeDrain
    this.#clearWriteTimer()
    await this.settled
    if (this.#hydrationFailed) throw this.hydrationError.value
    // Capture the write already observed by this flush before checking the lifecycle again. If
    // dispose wins while the adapter ignores abort, its late storage failure must remain reachable
    // as the AbortError cause.
    if (pendingWrite) await pendingWrite
    this.#assertActive()
    this.#assertDirectOperation()
    await this.#enqueueWrite()
    this.#assertActive()
  }

  /** Captures and starts conversion inside the canonical operation owner before queuing requests. */
  #flushTransaction(tx: Omit<ITransactionScope, 'use'>): Promise<void> {
    this.#assertActive()
    /** Only a handle enlisted in this active original transaction may use any derived view. */
    const active = this.#participation
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
    return runTransactionOperation(tx, (scope) => this.#flushInScope(active, scope))
  }

  /** One transactional flush: snapshot now, write through the scope after the previous flush. */
  #flushInScope(
    active: IPersistParticipation,
    scope: Omit<ITransactionScope, 'use'>
  ): Promise<void> {
    active.flushed = true
    this.writeStatus.value = PersistState.writing
    /** Snapshot failures belong to encoding and are registered before the first native request. */
    let envelope: IVersionedEnvelope<unknown>
    /** The notification revision is read in the same synchronous call as the state snapshot. */
    const snapshotRevision = this.#changeRevision
    try {
      /** Async identity byte codecs must receive this call's bytes, not a later mutable view. */
      const state = this.#partializedSnapshot()
      envelope = {
        version: this.#options.version,
        state:
          this.#options.codec.output === PersistCodecOutput.binary && isUint8Array(state)
            ? new Uint8Array(state)
            : state
      }
    } catch (cause) {
      throw normalizeTransactionEncodingFailure(cause)
    }
    /** Observation binds the authentic operation view, without keeping a root-store fallback. */
    const selectedCodecStages = bindPersistStages(this.#options.codecStages, scope)
    /** The transaction owner remains responsible for mode, identity and view expiration. */
    const selectedTransactionStages = bindPersistStages(this.#options.transactionStages, scope)
    observePersistFlush(selectedTransactionStages, 'beforePersistFlush')
    /** Retain this predecessor without observing a rejected ordering Promise before conversion. */
    const previousFlush = active.flushChain
    /** Conversion sees this call's state immediately; native writes retain the original order. */
    const operation = writeEnvelopeWithStages(
      {
        capabilities: this.#options.storage.capabilities,
        set: (archiveKey, text) => scope.set(archiveKey, text, { conflictPolicy: 'replace' }),
        getBytes: (archiveKey) => scope.getBytes(archiveKey),
        setBytes: (archiveKey, bytes) =>
          scope.setBytes(archiveKey, bytes, { conflictPolicy: 'replace' })
      },
      this.#options.key,
      this.#options.codec,
      envelope,
      {},
      selectedCodecStages,
      normalizeTransactionEncodingFailure,
      () => previousFlush.then(this.#assertActive)
    ).then(() => {
      active.lastFlushedRevision = snapshotRevision
      observePersistFlush(selectedTransactionStages, 'afterPersistFlush')
    })
    active.flushChain = operation
    return operation
  }

  /** Transaction admission: hold admission and wait for every already-admitted write. */
  async #pause(control: IPersistParticipationControl): Promise<void> {
    this.#assertActive()
    this.#participation = {
      control,
      flushChain: Promise.resolve(),
      flushed: false,
      lastFlushedRevision: this.#persistedRevision
    }
    this.#clearWriteTimer()
    /** Snapshot every already-admitted outcome before new direct mutations are closed out. */
    const pending = [...this.#pendingWrites]
    await this.settled
    if (this.#retryPromise !== undefined) await this.#retryPromise
    if (this.#hydrationFailed) throw this.hydrationError.value
    /** Wait all old work before examining failure, so another handle can never overtake it. */
    const outcomes = await Promise.allSettled(pending)
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason
    await this.#writeChain
    this.#assertActive()
  }

  /** Binds the admitted participation to its native transaction scope. */
  #bind(scope: object, owner: IStorageBase): void {
    this.#assertActive()
    if (this.#participation === undefined)
      throw createStorePersistTypeError(
        StorePersistErrorCode.invalidOption,
        StorePersistErrorText.transactionParticipation
      )
    this.#participation.store = owner
    this.#participation.transactionId = assertTransactionOwner(owner, scope as never).id
    this.#participation.flushChain = Promise.resolve()
    this.#participation.flushed = false
  }

  /** Transaction ended: publish its outcome and resume normal writes if changes remain. */
  #finish(committed: boolean, failure: unknown): void {
    /** Stop retaining native identity as soon as its owner has actually settled. */
    const completed = this.#participation
    this.#participation = undefined
    if (completed === undefined || this.#disposed) return
    if (committed && completed.flushed) this.#persistedRevision = completed.lastFlushedRevision
    if (completed.flushed) {
      this.writeStatus.value = committed ? PersistState.idle : PersistState.error
      this.writeError.value = committed ? undefined : failure
    }
    if (this.#changeRevision !== this.#persistedRevision) {
      try {
        this.scheduleWrite()
      } catch (cause) {
        // A committed transaction stays committed; failed mirroring remains an ordinary write outcome.
        this.writeError.value = cause
        this.writeStatus.value = PersistState.error
        throw cause
      }
    }
  }
}

/** The public handle; every member forwards to its attachment. */
function createPersistHandle<TState>(attachment: PersistUnitAttachment<TState>): IPersistHandle {
  return {
    status: attachment.status,
    error: attachment.error,
    hydrated: attachment.hydrated,
    hydrationStatus: attachment.hydrationStatus,
    hydrationError: attachment.hydrationError,
    writeStatus: attachment.writeStatus,
    writeError: attachment.writeError,
    ready: attachment.ready,
    settled: attachment.settled,
    retryHydrate: attachment.retryHydrate,
    flush: attachment.flush,
    clear: attachment.clear,
    get disposed() {
      return attachment.disposed
    },
    dispose: attachment.dispose,
    disposeAsync: attachment.disposeAsync,
    [asyncDisposeKey]: attachment.symbolDispose
  }
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
