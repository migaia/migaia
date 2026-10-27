// One concurrency attempt: budgets, waits, failure reports and the attempt executor (see ./concurrency.ts).
import {
  type ILockKey,
  type ITransactionOptions,
  ConcurrencyHolderState,
  type IConcurrencyHolder,
  type IConcurrencyDecision,
  type IConcurrencyStageObserver,
  type IConcurrencyConflict,
  invalidConcurrencyArgument,
  type INormalizedLockKey,
  type IConcurrencyAttemptContext,
  type IBackendKind,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText
} from '@migaia/storage-contract'
import {
  raceWithAbort,
  withTimeout,
  hostRethrowReporter,
  type IAbortTimeoutSignal,
  type IUtilsReporter
} from '@migaia/utils/promise'
import { isUtilsAbortError, isUtilsTimeoutError } from '@migaia/utils/error'
import { observeThenableRejection } from '@migaia/utils/function'
import { systemScheduler } from '@migaia/utils/scheduler'
import { storageKeyBytesIdentity } from './key.js'
import { snapshotLockKey, encodeLockContent } from './concurrency-lock-keys.js'

/** Stable concurrency decision values; internal, kept off the SDK star export. */
export const ConcurrencyAction = { wait: 'wait', reject: 'reject', retry: 'retry' } as const

/** Canonical attempt states stay with the original concurrency loop. */
export const ConcurrencyAttemptStatus = { committed: 'committed', conflict: 'conflict' } as const

/** Only an actual policy decision can change a subsequent attempt to waiting admission. */
export const ConcurrencyAdmission = { try: 'try', wait: 'wait' } as const

/** Acquisition refusal and completed-rollback conflicts have distinct public failure codes. */
export const ConcurrencyPhase = { acquire: 'acquire', commit: 'commit' } as const

/** A pipeline may return a recovery value or preserve the exact failure it observed. */
export const ConcurrencyExecutionStatus = { returned: 'returned', threw: 'threw' } as const

/** One logical operation owns timing and conflict counters, including nested persist admission. */
export type IConcurrencyBudget = {
  readonly cancellation: IAbortTimeoutSignal
  readonly deadlineFailure: StorageContractError
  readonly backend: IBackendKind
  readonly report: IUtilsReporter
  waitedMs: number
  logicalWaitedMs: number
  conflicts: number
}

/**
 * Captured options share canonical lock metadata and an optional running budget without granting
 * authority.
 */
export const concurrencyAttemptBudgets = new WeakMap<
  ITransactionOptions,
  {
    readonly budget?: IConcurrencyBudget
    readonly locks: readonly INormalizedLockKey[] | undefined
    readonly identities: readonly string[]
  }
>()

/**
 * Builder-only metadata shares the existing options table and creates no timing or transaction
 * owner.
 */
export function associateNormalizedLockKeys(
  options: ITransactionOptions,
  locks: readonly INormalizedLockKey[]
): void {
  concurrencyAttemptBudgets.set(options, { locks, identities: snapshotLockIdentities(locks) })
}

/** One immutable ordered string list is retained with the original normalized option metadata. */
export function snapshotLockIdentities(
  locks: readonly INormalizedLockKey[] | undefined
): readonly string[] {
  return locks?.map((entry) => storageKeyBytesIdentity(entry.encoded)) ?? []
}

/**
 * Reads the same active attempt's normalized, sorted and deduplicated lock identities. Repeated
 * reads and nested native attempts share one immutable string list; no logical key is inspected or
 * re-encoded here. Forged, builder-only and settled contexts reject with INVALID_ARGUMENT. This
 * grants no transaction, registration, lock acquisition or lifecycle authority.
 */
export function readConcurrencyLockIdentities(ctx: IConcurrencyAttemptContext): readonly string[] {
  /** Only the original live attempt metadata can grant read access to its immutable identities. */
  const captured = concurrencyAttemptBudgets.get(ctx)
  if (captured?.budget === undefined) throw invalidConcurrencyArgument()
  return captured.identities
}

/** Internal managed waits distinguish logical policy budgets from physical database scheduling. */
export const ConcurrencyWaitKind = { logical: 'logical', physical: 'physical' } as const

/** An observation failure never replaces an operation result, even if the configured reporter fails. */
export function reportConcurrencyFailure(
  stages: IConcurrencyStageObserver | undefined,
  error: unknown
): void {
  observeThenableRejection(undefined, { error }, (failure) => {
    if (stages) stages.report(failure)
    else hostRethrowReporter(failure, { operation: 'raceWithAbort', phase: 'late-rejection' })
  })
}

/** Invoke an actual stage method with its receiver and observe ordinary Promise completion. */
export function observeConcurrencyResult(
  stages: IConcurrencyStageObserver,
  name: Exclude<keyof IConcurrencyStageObserver, 'kind' | 'report'>,
  args: readonly unknown[]
): void {
  try {
    /** The stage registry owns the callback receiver; no detached method or then getter is captured. */
    const result = (
      stages as unknown as Record<string, (...values: readonly unknown[]) => unknown>
    )[name]!(...args)
    if (result !== undefined)
      void Promise.resolve(result).catch((error) => reportConcurrencyFailure(stages, error))
  } catch (error) {
    reportConcurrencyFailure(stages, error)
  }
}

/** Optional stage selection does not grant cancellation or admission authority. */
export function readConcurrencyStage<
  TName extends Exclude<keyof IConcurrencyStageObserver, 'kind' | 'report'>
>(stages: IConcurrencyStageObserver | undefined, name: TName): IConcurrencyStageObserver[TName] {
  return stages?.[name]
}

/** Constructs lock diagnostics once at failure, detached from mutable policy/backend key views. */
export function concurrencyLockFailure(
  code: typeof StorageContractErrorCode.lockRejected | typeof StorageContractErrorCode.lockTimeout,
  backend: IBackendKind,
  keys: readonly ILockKey[],
  holder: IConcurrencyHolder | undefined,
  cause?: unknown
): StorageContractError {
  /** Error keys own their mutable components and cannot change a later attempt's physical identity. */
  const snapshot = keys.map((key) => snapshotLockKey(key, backend))
  /** Canonical bytes retain binary identity while JSON keeps ordinary logical keys readable. */
  const keyDescription =
    holder === undefined
      ? undefined
      : JSON.stringify(
          snapshot.map((key) => ({
            ...key,
            encoded: storageKeyBytesIdentity(encodeLockContent(key, backend))
          }))
        )
  /** Handoff is a real identity gap, never a substituted old label. */
  const holderDescription =
    holder?.status === ConcurrencyHolderState.held
      ? (holder.label ?? holder.owner)
      : ConcurrencyHolderState.handingOff
  return new StorageContractError(
    code,
    { backend, keys: snapshot, holder, cause },
    keyDescription === undefined
      ? undefined
      : StorageContractErrorText.lockFailure(code, keyDescription, holderDescription)
  )
}

/**
 * Maps only cancellation owned by this operation; backend failures otherwise pass through
 * unchanged.
 */
export function concurrencyAbort(
  budget: IConcurrencyBudget,
  physical: boolean,
  keys: readonly ILockKey[] = []
): StorageContractError | undefined {
  /** The single merged signal owns first-abort identity and preserves an external reason. */
  const signal = budget.cancellation.signal
  if (!signal?.aborted) return undefined
  /** This original signal retains the operation's first cancellation reason. */
  const reason = signal.reason
  if (reason === budget.deadlineFailure)
    return physical
      ? concurrencyLockFailure(
          StorageContractErrorCode.lockTimeout,
          budget.backend,
          keys,
          undefined,
          reason
        )
      : budget.deadlineFailure
  return new StorageContractError(StorageContractErrorCode.aborted, {
    backend: budget.backend,
    cause: reason
  })
}

/**
 * Uses utils waiting primitives only. Timeout ends this wait, never an accepted native attempt; the
 * backend must remove its queued waiter and finish cleanup before its attempt settles.
 */
export async function waitForConcurrency<T>(
  budget: IConcurrencyBudget,
  pending: Promise<T>,
  kind: (typeof ConcurrencyWaitKind)[keyof typeof ConcurrencyWaitKind],
  logicalTimeoutMs: number | undefined,
  keys: readonly ILockKey[],
  holder: IConcurrencyHolder | undefined
): Promise<T> {
  /**
   * The pending Promise already exists; observe it even if utils rejects before starting its lazy
   * operation.
   */
  let started = false
  void pending.catch((error) => {
    if (!started) {
      /** Only this operation's own reason acknowledges cancellation. */
      const acknowledgement = error === budget.cancellation.signal?.reason
      if (!acknowledgement)
        budget.report(error, { operation: 'raceWithAbort', phase: 'late-rejection' })
    }
  })
  /** Only this actual blocking interval contributes to cumulative admission statistics. */
  const start = systemScheduler.now()
  try {
    /** The lazy operation transfers rejection observation to the canonical utils implementation. */
    const operation = (): Promise<T> => {
      started = true
      return pending
    }
    if (kind === ConcurrencyWaitKind.logical && logicalTimeoutMs !== undefined)
      return await withTimeout(operation, {
        timeoutMs: Math.max(0, logicalTimeoutMs - budget.logicalWaitedMs),
        signal: budget.cancellation.signal,
        report: budget.report
      })
    return await raceWithAbort(operation, {
      signal: budget.cancellation.signal,
      report: budget.report
    })
  } catch (error) {
    /**
     * Physical deadlines have their own public classification; external cancellation keeps its
     * reason.
     */
    const aborted = concurrencyAbort(budget, kind === ConcurrencyWaitKind.physical, keys)
    if (aborted) throw aborted
    if (kind === ConcurrencyWaitKind.logical && isUtilsTimeoutError(error))
      throw concurrencyLockFailure(
        StorageContractErrorCode.lockTimeout,
        budget.backend,
        keys,
        holder,
        error
      )
    if (isUtilsAbortError(error))
      throw new StorageContractError(StorageContractErrorCode.aborted, {
        backend: budget.backend,
        cause: error.cause
      })
    throw error
  } finally {
    /** Callback and cleanup execution are deliberately outside these measured waiting intervals. */
    const elapsed = Math.max(0, systemScheduler.now() - start)
    budget.waitedMs += elapsed
    if (kind === ConcurrencyWaitKind.logical) budget.logicalWaitedMs += elapsed
  }
}

/**
 * Captures policy fields once and rejects inapplicable combinations after the old attempt is
 * closed.
 */
export function readConcurrencyDecision(
  value: unknown,
  phase: IConcurrencyConflict['phase']
): IConcurrencyDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(StorageContractErrorText.concurrencyDecision)
  /** A changing result cannot supply different action/budget fields during validation and use. */
  const { action, timeoutMs, delayMs } = value as IConcurrencyDecision
  if (action === ConcurrencyAction.reject && timeoutMs === undefined && delayMs === undefined)
    return value as IConcurrencyDecision
  if (
    action === ConcurrencyAction.wait &&
    phase === ConcurrencyPhase.acquire &&
    delayMs === undefined &&
    (timeoutMs === undefined || (Number.isFinite(timeoutMs) && timeoutMs >= 0))
  )
    return value as IConcurrencyDecision
  if (
    action === ConcurrencyAction.retry &&
    timeoutMs === undefined &&
    (delayMs === undefined || (Number.isFinite(delayMs) && delayMs >= 0))
  )
    return value as IConcurrencyDecision
  throw new TypeError(StorageContractErrorText.concurrencyDecision)
}

/** Original pipeline segment outcomes are observed before another native attempt begins. */
export type IAttemptExecution<TResult> = {
  readonly ready: Promise<void>
  readonly completed: Promise<
    | {
        readonly status: typeof ConcurrencyExecutionStatus.returned
        readonly value: Awaited<TResult>
      }
    | { readonly status: typeof ConcurrencyExecutionStatus.threw; readonly cause: unknown }
  >
  readonly entered: boolean
  resolve(value: Awaited<TResult>): void
  reject(cause: unknown): void
}

/** A segment borrows only its real pipeline callback and the original loop’s preparation port. */
type IAttemptExecutionPort<TResult> = {
  execute(invoke: () => Promise<Awaited<TResult>>): Awaited<TResult> | PromiseLike<Awaited<TResult>>
  prepare(): StorageContractError | undefined
}

/** Own one segment’s terminal admission and native result without another loop or timing owner. */
export class ConcurrencyAttemptExecution<TResult> implements IAttemptExecution<TResult> {
  /** The runner owns the actual preparation and executeAttempt callbacks. */
  readonly #port: IAttemptExecutionPort<TResult>
  /**
   * Native settlement stays pending through acquisition refusals and resolves only after actual
   * cleanup.
   */
  readonly #native: Promise<Awaited<TResult>>
  /** Complete the exact native Promise borrowed by the pipeline terminal. */
  #resolveNative!: (value: Awaited<TResult>) => void
  /** Preserve the exact coded failure observed by catch and recovery. */
  #rejectNative!: (cause: unknown) => void
  /** Wake the original loop at terminal admission or actual pipeline completion. */
  #resolveReady!: () => void
  /** A terminal can admit native work once for this actual segment. */
  #invoked = false
  /** Successful preparation is the sole authority to begin this segment’s native attempts. */
  #entered = false
  /** Original loop waits for terminal admission or a legal stage halt. */
  readonly ready: Promise<void>
  /** Both outcomes are observed before a completed segment is released. */
  readonly completed: IAttemptExecution<TResult>['completed']
  /** Build all result ports before invoking the real pipeline callback. */
  constructor(port: IAttemptExecutionPort<TResult>) {
    this.#port = port
    this.#native = new Promise((resolve, reject) => {
      this.#resolveNative = resolve
      this.#rejectNative = reject
    })
    void this.#native.then(undefined, () => undefined)
    this.ready = new Promise((resolve) => {
      this.#resolveReady = resolve
    })
    this.completed = this.#complete()
  }
  /** Admission facts have no setter and grant no native port to callers. */
  get entered(): boolean {
    return this.#entered
  }
  /** Actual native commit settlement resumes the pipeline’s after-next path. */
  resolve(value: Awaited<TResult>): void {
    this.#resolveNative(value)
  }
  /** Actual native conflict/failure resumes that same pipeline’s catch/finally path. */
  reject(cause: unknown): void {
    this.#rejectNative(cause)
  }
  /** Duplicate calls reject before key derivation or native admission. */
  #enter(): Promise<Awaited<TResult>> {
    if (this.#invoked) return Promise.reject(invalidConcurrencyArgument())
    this.#invoked = true
    /** Preparation runs synchronously at the original terminal before it yields to the native loop. */
    const aborted = this.#port.prepare()
    if (aborted) return Promise.reject(aborted)
    this.#entered = true
    this.#resolveReady()
    return this.#native
  }
  /** Observe the original segment’s complete asynchronous unwind, including legal early return. */
  async #complete(): IAttemptExecution<TResult>['completed'] {
    try {
      return {
        status: ConcurrencyExecutionStatus.returned,
        value: await this.#port.execute(() => this.#enter())
      }
    } catch (cause) {
      return { status: ConcurrencyExecutionStatus.threw, cause }
    } finally {
      this.#resolveReady()
    }
  }
}
