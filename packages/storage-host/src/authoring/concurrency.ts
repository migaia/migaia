import {
  type ILockKey,
  type IConcurrencyPolicy,
  type IConcurrencyDecision,
  type IConcurrencyStageObserver,
  type IConcurrencyConflict,
  ConcurrencyLocking,
  invalidConcurrencyArgument,
  assertConcurrencyPolicy,
  readConcurrencyPolicy,
  defineConcurrencyPolicy,
  type INormalizedLockKey,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext,
  type IConcurrencyPort,
  type IConcurrencyRequest,
  type IBackendKind,
  StorageContractError,
  StorageContractErrorCode,
  type IConflictPolicy,
  type IOperationContext
} from '@migaia/storage-contract'
import {
  createAbortTimeoutSignal,
  raceWithAbort,
  sleep,
  type IUtilsReporter
} from '@migaia/utils/promise'
import { IdentifyError } from '@migaia/utils/error'
import { systemScheduler } from '@migaia/utils/scheduler'
import { snapshotOperationContext } from './context.js'
import { readTransactionConcurrency, resolveConcurrencyPolicy } from './transaction.js'
import {
  concurrencyAttemptBudgets,
  snapshotLockIdentities,
  reportConcurrencyFailure,
  ConcurrencyAdmission,
  ConcurrencyAttemptExecution,
  concurrencyAbort,
  ConcurrencyExecutionStatus,
  readConcurrencyStage,
  observeConcurrencyResult,
  ConcurrencyAttemptStatus,
  ConcurrencyPhase,
  waitForConcurrency,
  ConcurrencyWaitKind,
  readConcurrencyDecision,
  concurrencyLockFailure
} from './concurrency-attempt.js'
import type { IConcurrencyBudget, IAttemptExecution } from './concurrency-attempt.js'
import {
  normalizeLockKeys,
  snapshotConcurrencyExtensions,
  uniqueNormalizedLockKeys,
  snapshotLockKey
} from './concurrency-lock-keys.js'
import { ConcurrencyAction } from './concurrency-attempt.js'

/** Preset labels describe policy behavior and never authorize a structurally copied policy. */
const ConcurrencyPreset = { wait: 'wait', fail: 'fail', optimistic: 'optimistic' } as const

/** Existing waiting semantics use thirty seconds only for logical lock admission. */
const DEFAULT_LOCK_WAIT_MS = 30_000

/** The optimistic preset retries three real conflicts unless explicitly configured otherwise. */
const DEFAULT_OPTIMISTIC_RETRIES = 3

/** Preset retry delay is independent of physical database admission. */
const DEFAULT_OPTIMISTIC_BACKOFF_MS = 20

/** Preset options are ordinary records; every admitted duration/count is a nonnegative safe integer. */
function policyNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalidConcurrencyArgument()
  return value
}

/** Rejects unsupported option containers before executing any policy callback. */
function assertPolicyOptions(options: unknown): void {
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw invalidConcurrencyArgument()
}

/** Presets create authentic policy identities through the same canonical definition path. */
export const ConcurrencyPolicy = Object.freeze({
  /** Wait only on acquisition; commit conflicts reject after the native attempt has ended. */
  wait(options?: {
    readonly timeoutMs?: number
  }): IConcurrencyPolicy & { readonly locking: 'pessimistic' } {
    assertPolicyOptions(options)
    /** Logical wait budget never becomes a physical database timeout. */
    const timeoutMs = policyNumber(options?.timeoutMs, DEFAULT_LOCK_WAIT_MS)
    return defineConcurrencyPolicy({
      name: ConcurrencyPreset.wait,
      locking: ConcurrencyLocking.pessimistic,
      decide: (conflict) =>
        conflict.phase === 'acquire'
          ? { action: ConcurrencyAction.wait, timeoutMs }
          : { action: ConcurrencyAction.reject }
    })
  },
  /** Reject every actual conflict without imposing an artificial physical-admission budget. */
  fail(): IConcurrencyPolicy & { readonly locking: 'pessimistic' } {
    return defineConcurrencyPolicy({
      name: ConcurrencyPreset.fail,
      locking: ConcurrencyLocking.pessimistic,
      decide: () => ({ action: ConcurrencyAction.reject })
    })
  },
  /** Retry the configured number of real conflicts, then reject; successful attempts do not decide. */
  optimistic(options?: {
    readonly retries?: number
    readonly backoffMs?: number
  }): IConcurrencyPolicy & { readonly locking: 'optimistic' } {
    assertPolicyOptions(options)
    /** Real conflict sequence counts from one; zero disables strategy retries. */
    const retries = policyNumber(options?.retries, DEFAULT_OPTIMISTIC_RETRIES)
    /** Backoff is captured independently and never reads mutable caller configuration again. */
    const backoffMs = policyNumber(options?.backoffMs, DEFAULT_OPTIMISTIC_BACKOFF_MS)
    return defineConcurrencyPolicy({
      name: ConcurrencyPreset.optimistic,
      locking: ConcurrencyLocking.optimistic,
      decide: (conflict) =>
        conflict.attempt <= retries
          ? { action: ConcurrencyAction.retry, delayMs: backoffMs }
          : { action: ConcurrencyAction.reject }
    })
  }
})

/** All logical retry state belongs to one named runner and the original transaction registration. */
class ConcurrencyRunner<TResult> {
  /** The caller supplies actual preparation and pipeline ports; no second runner is installed. */
  #request: IConcurrencyRequest<TResult>
  /** The backend owns every actual attempt through its original port. */
  #port: IConcurrencyPort<TResult>
  /** Original owner diagnostics stay fixed through retries and cancellation. */
  #backend: IBackendKind
  /** Observation uses the original host stage binding without admission authority. */
  #stages: IConcurrencyStageObserver | undefined
  /** The original option policy is forwarded independently of the effective request policy. */
  #capturedOverride: IConcurrencyPolicy | undefined
  /** One authentic effective policy decides only after real native conflicts. */
  #policy: IConcurrencyPolicy
  /** Authentic nested contexts borrow the existing lock facts and timing budget. */
  #inherited: ReturnType<(typeof concurrencyAttemptBudgets)['get']>
  /** Canonical lock images remain stable while native work and policy callbacks await. */
  #locks: readonly INormalizedLockKey[] | undefined
  /** Each real pipeline replay starts from the original declared lock set. */
  #originalLocks: readonly INormalizedLockKey[] | undefined
  /** Operation fields must remain fixed across preparation and native attempt awaits. */
  #context: ReturnType<typeof snapshotOperationContext>
  /** The original normalized bytes supply one identity list across retries. */
  #identities: readonly string[]
  /** Native option fields travel with the same operation across asynchronous pipeline stages. */
  #extensions: object
  /** The existing reporter owns cleanup and late rejection diagnostics. */
  #report: IUtilsReporter
  /** The sole merged signal and cumulative conflict/wait counters belong to this logical operation. */
  #budget: IConcurrencyBudget
  /** Only a real policy decision switches subsequent acquisition from try to wait. */
  #admission: IConcurrencyAttemptContext['admission']
  /** Policy wait duration remains separate from the overall operation deadline. */
  #logicalTimeoutMs: number | undefined
  /** Original conflict facts survive an awaiting policy without borrowing its mutable argument view. */
  #lastConflict: Pick<IConcurrencyConflict, 'keys' | 'holder'> | undefined
  /** Actual attempt stages share fixed fields and this operation owner’s running signal. */
  #executionContext: (IOperationContext & { readonly conflictPolicy?: IConflictPolicy }) | undefined
  /** Only the current original pipeline segment remains live until its unwind finishes. */
  #execution: IAttemptExecution<TResult> | undefined
  /** The original outer pipeline terminal may enter its logical loop exactly once. */
  #outerInvoked = false
  /** Admit the current supported request before any pipeline or native attempt starts. */
  constructor(request: IConcurrencyRequest<TResult>, port: IConcurrencyPort<TResult>) {
    this.#request = request
    this.#port = port
    /** Admission time counts against the one overall deadline. */
    const startedAt = systemScheduler.now()
    /** Original registration supplies diagnostics and the sole host stage binding. */
    const registration = readTransactionConcurrency(request.store)
    this.#backend = registration.backend
    this.#stages = registration.stages
    if (request.policy !== undefined) assertConcurrencyPolicy(request.policy)
    if (
      typeof request.options !== 'object' ||
      request.options === null ||
      Array.isArray(request.options)
    )
      throw invalidConcurrencyArgument()
    /** Declared lock input spans all later asynchronous attempts and is captured once. */
    const declaredLocks = request.options.lock
    this.#capturedOverride = request.options.concurrency
    if (this.#capturedOverride !== undefined) assertConcurrencyPolicy(this.#capturedOverride)
    /** Exactly one execution form may be declared; backend callbacks are typed, not re-checked. */
    if (request.execute !== undefined && request.executeAttempt !== undefined)
      throw invalidConcurrencyArgument()
    this.#policy = request.policy ?? resolveConcurrencyPolicy(request.store, this.#capturedOverride)
    this.#inherited = concurrencyAttemptBudgets.get(request.options)
    this.#locks = this.#inherited
      ? this.#inherited.locks
      : declaredLocks === undefined
        ? undefined
        : normalizeLockKeys(declaredLocks, this.#backend)
    this.#originalLocks = this.#locks
    this.#context = snapshotOperationContext(request.options)
    if (!request.prepare && !request.execute && !request.executeAttempt) this.#derivePreparedLocks()
    this.#identities =
      this.#locks === this.#inherited?.locks && this.#inherited
        ? this.#inherited.identities
        : snapshotLockIdentities(this.#locks)
    this.#extensions = snapshotConcurrencyExtensions(request.options)
    /** Nested calls preserve the original deadline failure identity. */
    const deadlineFailure =
      this.#inherited?.budget?.deadlineFailure ??
      new StorageContractError(StorageContractErrorCode.aborted, { backend: this.#backend })
    this.#report =
      this.#inherited?.budget?.report ?? ((error) => reportConcurrencyFailure(this.#stages, error))
    this.#budget = this.#inherited?.budget ?? {
      cancellation: createAbortTimeoutSignal({
        signal: this.#context?.signal,
        timeoutMs:
          this.#context?.timeoutMs === undefined
            ? undefined
            : Math.max(0, this.#context.timeoutMs - (systemScheduler.now() - startedAt)),
        timeoutReason: () => deadlineFailure,
        report: this.#report
      }),
      deadlineFailure,
      backend: this.#backend,
      report: this.#report,
      waitedMs: 0,
      logicalWaitedMs: 0,
      conflicts: 0
    }
    this.#admission = ConcurrencyAdmission.try
    this.#executionContext = request.executeAttempt
      ? { ...this.#extensions, ...this.#context, signal: this.#budget.cancellation.signal }
      : undefined
  }
  /** Derive only new fixed-input keys; native/inherited identity facts stay on their original owner. */
  #derivePreparedLocks(captured = this.#context!): void {
    if (!this.#request.lock) return
    /** Only new keys are captured and encoded; inherited normalized entries remain unchanged. */
    let additional: readonly ILockKey[]
    try {
      additional = this.#request.lock(captured)
    } catch (cause) {
      if (IdentifyError.identityOf(cause)) throw cause
      throw invalidConcurrencyArgument(cause)
    }
    /** Stable sorting retains the original entry when an implicit lock duplicates an explicit one. */
    const normalized = normalizeLockKeys(additional, this.#backend)
    if (normalized.length > 0)
      this.#locks = uniqueNormalizedLockKeys([...(this.#locks ?? []), ...normalized])
  }
  /** Create a segment only when the actual original executeAttempt stage is ready to run. */
  #startAttemptExecution(): IAttemptExecution<TResult> {
    return new ConcurrencyAttemptExecution({
      execute: (invoke) => this.#request.executeAttempt!(this.#executionContext!, invoke),
      prepare: () => this.#prepareExecution()
    })
  }
  /** Replays derive from the caller’s original lock set and the same running budget. */
  #prepareExecution(): StorageContractError | undefined {
    const aborted = concurrencyAbort(this.#budget, false)
    if (aborted) return aborted
    this.#locks = this.#originalLocks
    this.#derivePreparedLocks(this.#executionContext!)
    this.#identities =
      this.#locks === this.#inherited?.locks && this.#inherited
        ? this.#inherited.identities
        : snapshotLockIdentities(this.#locks)
    return undefined
  }
  /** Preserve preparation, outer pipeline and cleanup within the one original call budget. */
  async run(): Promise<Awaited<TResult>> {
    try {
      if (this.#request.prepare) {
        /** An already canceled call starts neither its pipeline nor a native attempt. */
        const beforePreparation = concurrencyAbort(this.#budget, false)
        if (beforePreparation) throw beforePreparation
        /**
         * The original fields stay captured; only this owner supplies the running cancellation
         * signal.
         */
        const preparationContext = {
          ...this.#extensions,
          ...this.#context,
          signal: this.#budget.cancellation.signal
        }
        await this.#request.prepare(preparationContext)
        /** Accepted preparation settles before cancellation can release this call's signal owner. */
        const afterPreparation = concurrencyAbort(this.#budget, false)
        if (afterPreparation) throw afterPreparation
        if (!this.#request.execute && !this.#request.executeAttempt)
          this.#derivePreparedLocks(preparationContext)
        this.#identities =
          this.#locks === this.#inherited?.locks && this.#inherited
            ? this.#inherited.identities
            : snapshotLockIdentities(this.#locks)
      }
      if (this.#request.execute) {
        /** Pre-canceled calls start neither an outer pipeline nor native work. */
        const beforeExecution = concurrencyAbort(this.#budget, false)
        if (beforeExecution) throw beforeExecution
        /** After-next and catch stay around actual native settlement under the original call budget. */
        const logicalExecutionContext = {
          ...this.#extensions,
          ...this.#context,
          signal: this.#budget.cancellation.signal
        }
        return (await this.#request.execute(logicalExecutionContext, () =>
          this.#invokeOriginalLoop(logicalExecutionContext)
        )) as Awaited<TResult>
      }
      return await this.#runOriginalLoop()
    } catch (cause) {
      if (!this.#execution) throw cause
      /** Cancellation, native and policy errors also await the original stage's actual unwind. */
      this.#execution.reject(cause)
      const completed = await this.#execution.completed
      if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
      throw completed.cause
    } finally {
      if (!this.#inherited?.budget) this.#budget.cancellation.dispose()
    }
  }
  /** Admit the outer pipeline terminal once before deriving actual fixed-input keys. */
  #invokeOriginalLoop(context: IOperationContext): Promise<Awaited<TResult>> {
    if (this.#outerInvoked) return Promise.reject(invalidConcurrencyArgument())
    this.#outerInvoked = true
    /** Expired before-next work never derives keys or opens a native attempt. */
    const aborted = concurrencyAbort(this.#budget, false)
    if (aborted) return Promise.reject(aborted)
    this.#derivePreparedLocks(context)
    this.#identities =
      this.#locks === this.#inherited?.locks && this.#inherited
        ? this.#inherited.identities
        : snapshotLockIdentities(this.#locks)
    return this.#runOriginalLoop()
  }
  /** The original logical attempt/decision loop is the sole owner of retry admission. */
  async #runOriginalLoop(): Promise<Awaited<TResult>> {
    while (true) {
      if (this.#request.executeAttempt && !this.#execution) {
        /** Cancellation before a fresh stage cannot start another pipeline or native attempt. */
        const beforeExecution = concurrencyAbort(this.#budget, false)
        if (beforeExecution) throw beforeExecution
        this.#execution = this.#startAttemptExecution()
        await this.#execution.ready
        if (!this.#execution.entered) {
          /** A legal stage halt/recovery may complete without ever calling its terminal. */
          const completed = await this.#execution.completed
          this.#execution = undefined
          if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
          throw completed.cause
        }
      }
      /** Cancellation before resource admission starts no native attempt. */
      const aborted = concurrencyAbort(this.#budget, false)
      if (aborted) throw aborted
      /** The original attempt metadata is present only while this actual native call is live. */
      const attemptContext = this.#attemptContext()
      concurrencyAttemptBudgets.set(attemptContext, {
        budget: this.#budget,
        locks: this.#locks,
        identities: this.#identities
      })
      /** No handler means no argument array or event payload is created. */
      const beforeAcquire = readConcurrencyStage(this.#stages, 'beforeLockAcquire')
      if (beforeAcquire)
        observeConcurrencyResult(this.#stages!, 'beforeLockAcquire', [
          this.#policy.name,
          this.#locks?.length ?? 0
        ])
      /**
       * Cleanup completion precedes every policy decision; abort never detaches accepted native
       * work.
       */
      let result: IConcurrencyAttempt<TResult>
      try {
        result = await this.#port.attempt(attemptContext)
      } finally {
        concurrencyAttemptBudgets.delete(attemptContext)
      }
      if (result.status === ConcurrencyAttemptStatus.committed) {
        /** The stage's after-next path observes the actual committed value, then fully settles. */
        const value = await result.value
        if (!this.#execution) return value
        this.#execution.resolve(value)
        const completed = await this.#execution.completed
        this.#execution = undefined
        if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
        throw completed.cause
      }
      if (this.#execution && result.phase === ConcurrencyPhase.commit) {
        /** Absent or uncoded causes need one explicit boundary identity before stage intervention. */
        const failure = IdentifyError.identityOf(result.cause)
          ? result.cause
          : new StorageContractError(StorageContractErrorCode.writeConflict, {
              backend: this.#backend,
              cause: result.cause
            })
        this.#execution.reject(failure)
        const completed = await this.#execution.completed
        this.#execution = undefined
        if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
        if (completed.cause !== failure) throw completed.cause
        /** A policy rejection retains the same coded boundary the stage actually observed. */
        if (failure !== result.cause) result = { ...result, cause: failure }
      }
      /** A backend can report conflict only after finishing rollback and resource cleanup. */
      const afterAttemptAbort = concurrencyAbort(this.#budget, false)
      if (afterAttemptAbort) throw afterAttemptAbort
      this.#budget.conflicts += 1
      this.#lastConflict = {
        keys: result.keys.map((key) => snapshotLockKey(key, this.#backend)),
        holder: result.holder
      }
      /** Conflict observations run after the complete backend attempt has ended. */
      const onConflict = readConcurrencyStage(this.#stages, 'onLockConflict')
      if (onConflict)
        observeConcurrencyResult(this.#stages!, 'onLockConflict', [
          result.phase,
          this.#budget.conflicts,
          result.keys.length,
          result.holder
        ])
      /** Policy work begins only after native rollback/resource cleanup has completed. */
      const decision = await this.#decide(result)
      /** Decision observations cannot veto, delay or rewrite the captured action. */
      const onDecision = readConcurrencyStage(this.#stages, 'onConcurrencyDecision')
      if (onDecision)
        observeConcurrencyResult(this.#stages!, 'onConcurrencyDecision', [
          decision.action,
          this.#budget.conflicts
        ])
      /** A wait decision remains synchronous; only the original retry delay yields here. */
      const retry = this.#applyDecision(decision, result)
      if (retry) await retry
    }
  }
  /** Construct one native attempt using the original budget and already-normalized lock images. */
  #attemptContext(): IConcurrencyAttemptContext {
    /** Captured native fields are forwarded while the original deadline remains owned here. */
    const { timeoutMs: _originalTimeout, ...fields } = this.#context ?? {}
    /**
     * Every real attempt gets detached keys so a previous borrowed view cannot mutate future
     * identity.
     */
    const attemptContext: IConcurrencyAttemptContext = {
      ...this.#extensions,
      ...fields,
      signal: this.#budget.cancellation.signal,
      lock: this.#locks?.map((entry) => snapshotLockKey(entry.key, this.#backend)),
      concurrency: this.#capturedOverride,
      attempt: this.#budget.conflicts + 1,
      admission: this.#admission,
      locking: this.#policy.locking,
      waitTimeoutMs:
        this.#logicalTimeoutMs === undefined
          ? undefined
          : Math.max(0, this.#logicalTimeoutMs - this.#budget.logicalWaitedMs),
      wait: (pending) =>
        waitForConcurrency(
          this.#budget,
          pending,
          ConcurrencyWaitKind.logical,
          this.#logicalTimeoutMs,
          this.#lastConflict?.keys ?? attemptContext.lock ?? [],
          this.#lastConflict?.holder
        ),
      waitPhysical: (pending) =>
        waitForConcurrency(
          this.#budget,
          pending,
          ConcurrencyWaitKind.physical,
          undefined,
          attemptContext.lock ?? [],
          undefined
        )
    }
    return attemptContext
  }
  /** Await the real policy through utils cancellation and validate only its supported result fields. */
  async #decide(
    result: Extract<IConcurrencyAttempt<TResult>, { status: 'conflict' }>
  ): Promise<IConcurrencyDecision> {
    /** Each callback receives independent key components; policy mutation grants no lock authority. */
    const conflict: IConcurrencyConflict = {
      phase: result.phase,
      keys: this.#lastConflict!.keys.map((key) => snapshotLockKey(key, this.#backend)),
      attempt: this.#budget.conflicts,
      waitedMs: this.#budget.waitedMs,
      holder: result.holder,
      signal: this.#budget.cancellation.signal
    }
    /** Policy callbacks run only after real conflicts and outside every active native attempt. */
    try {
      return readConcurrencyDecision(
        await raceWithAbort(() => readConcurrencyPolicy(this.#policy)!(conflict), {
          signal: this.#budget.cancellation.signal,
          report: this.#report
        }),
        result.phase
      )
    } catch (cause) {
      /** Cancellation is distinct from a failed user policy and preserves the first abort reason. */
      const policyAbort = concurrencyAbort(this.#budget, false)
      if (policyAbort) throw policyAbort
      throw new StorageContractError(StorageContractErrorCode.concurrencyPolicyFailed, {
        backend: this.#backend,
        cause
      })
    }
  }
  /** Apply a real wait/reject/retry decision after the original native stage has fully settled. */
  #applyDecision(
    decision: IConcurrencyDecision,
    result: Extract<IConcurrencyAttempt<TResult>, { status: 'conflict' }>
  ): Promise<void> | undefined {
    if (decision.action === ConcurrencyAction.reject) {
      if (result.phase === ConcurrencyPhase.acquire)
        throw concurrencyLockFailure(
          StorageContractErrorCode.lockRejected,
          this.#backend,
          this.#lastConflict!.keys,
          this.#lastConflict!.holder,
          result.cause
        )
      throw new StorageContractError(StorageContractErrorCode.writeConflict, {
        backend: this.#backend,
        cause: result.cause
      })
    }
    if (decision.action === ConcurrencyAction.wait) {
      this.#logicalTimeoutMs = decision.timeoutMs
      if (
        this.#logicalTimeoutMs !== undefined &&
        this.#budget.logicalWaitedMs >= this.#logicalTimeoutMs
      )
        throw concurrencyLockFailure(
          StorageContractErrorCode.lockTimeout,
          this.#backend,
          this.#lastConflict!.keys,
          this.#lastConflict!.holder,
          result.cause
        )
      this.#admission = ConcurrencyAdmission.wait
      /** Waiting statistics refer only to the shared measured admission intervals. */
      const onWait = readConcurrencyStage(this.#stages, 'onLockWait')
      if (onWait)
        observeConcurrencyResult(this.#stages!, 'onLockWait', [
          this.#budget.conflicts,
          this.#budget.waitedMs
        ])
    } else {
      this.#admission = ConcurrencyAdmission.try
      /** Retry observation happens after rollback/cleanup and before the original utils delay. */
      const onRetry = readConcurrencyStage(this.#stages, 'onRetry')
      if (onRetry)
        observeConcurrencyResult(this.#stages!, 'onRetry', [
          this.#budget.conflicts,
          decision.delayMs ?? 0,
          result.phase === ConcurrencyPhase.commit ? 'write-conflict' : undefined
        ])
      return this.#retry(decision.delayMs ?? 0)
    }
    return undefined
  }
  /** The existing utility owns retry delay cancellation and its original first reason. */
  async #retry(delayMs: number): Promise<void> {
    try {
      await sleep(delayMs, { signal: this.#budget.cancellation.signal })
    } catch (cause) {
      throw concurrencyAbort(this.#budget, false) ?? cause
    }
  }
}

/** Execute the original logical concurrency owner without a second queue, budget or retry loop. */
export async function runWithConcurrency<TResult>(
  request: IConcurrencyRequest<TResult>,
  port: IConcurrencyPort<TResult>
): Promise<Awaited<TResult>> {
  return await new ConcurrencyRunner(request, port).run()
}
export {
  snapshotLockKey,
  lockKey,
  snapshotConcurrencyLockHoldings,
  normalizeLockKeys,
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockRange
} from './concurrency-lock-keys.js'
export {
  associateNormalizedLockKeys,
  readConcurrencyLockIdentities
} from './concurrency-attempt.js'
