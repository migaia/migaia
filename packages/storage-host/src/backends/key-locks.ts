import { createAbortController, createQuiescenceTracker } from '@migaia/lifecycle'
import {
  StorageContractError,
  StorageContractErrorCode,
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockHoldings,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext,
  type IConcurrencyHolder,
  type IConcurrencyPort,
  type IConcurrencyStageObserver,
  type ILockHolding,
  type ILockKey,
  type IStorageResource
} from '@migaia/storage-contract'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { walkErrorCauses } from '@migaia/utils/error'
import { createConcurrencyLimiter, deferred, raceWithAbort } from '@migaia/utils/promise'
import { readAbortReason, throwIfAborted } from '../core/operation.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'

/** The physical backend owns this port; creating it grants no transaction or retry authority. */
export type IBackendKeyLockPort = IStorageResource & {
  attempt<R>(
    ctx: IConcurrencyAttemptContext,
    holder: IConcurrencyHolder,
    native: IConcurrencyPort<R>,
    stages?: IConcurrencyStageObserver
  ): Promise<IConcurrencyAttempt<R>>
  inspectLocks(): readonly ILockHolding[]
}

/** All entries acquired atomically by one attempt share one original release signal. */
type IKeyLease = IStorageResource & {
  readonly released: Promise<void>
}
/** One canonical identity owns its detached logical key and actual holder until native termination. */
type IKeyEntry = {
  readonly key: ILockKey
  readonly holder: IConcurrencyHolder
  readonly lease: IKeyLease
}

/** Construct only through the backend core's original installation window. */
export function createBackendKeyLockPort(): IBackendKeyLockPort {
  /** This is the sole logical lock table, shared by the physical backend's existing closure. */
  const entries = new Map<string, IKeyEntry>()
  /** Only contended waiting admissions enter the existing utility FIFO. */
  const limiter = createConcurrencyLimiter({ concurrency: 1 })
  /** The original lifecycle tracker seals and drains complete attempts, including native cleanup. */
  const lifetime = createQuiescenceTracker<object>()
  /** A single private key groups this provider's resource lifetime without another state machine. */
  const owner = Object.freeze({})
  /** Both resource entries cache their own original Promise. */
  let disposal: Promise<void> | undefined
  /** Symbol cleanup reports the primary failure rather than rejecting a second time. */
  let symbolic: Promise<void> | undefined
  /** The canonical final diagnostic adapter is independent of the first sharing registration. */
  const report = createStorageOperationReporter()

  /** Resource closure rejects new admissions without changing any accepted native attempt. */
  const assertOpen = (): void => {
    if (lifetime.isSealed(owner)) throw new StorageContractError(StorageContractErrorCode.disposed)
  }

  /** Observe the real resource boundary without granting the callback control of the attempt. */
  const observe = (
    stages: IConcurrencyStageObserver | undefined,
    name: 'onLockAcquired' | 'onLockReleased',
    attempt: number,
    keyCount: number
  ): void => {
    if (stages === undefined) return
    try {
      /** Select before allocating arguments so absent observers retain the zero-handler path. */
      const handler = stages[name]
      if (handler === undefined) return
      /** The original observer remains the callback receiver and owns any rejected thenable. */
      const result = Reflect.apply(handler, stages, [attempt, keyCount])
      observeThenableRejection(result, inspectThenable(result), (error) =>
        reportCleanupError((failure) => stages.report(failure), error)
      )
    } catch (error) {
      reportCleanupError((failure) => stages.report(failure), error)
    }
  }

  /** Canonical input order determines the first actual conflicting holder. */
  const conflict = (identities: readonly string[]): IKeyEntry | undefined => {
    for (const identity of identities) {
      /** Lookup never re-encodes or sorts the logical key. */
      const held = entries.get(identity)
      if (held !== undefined) return held
    }
    return undefined
  }

  /** Check and acquire all entries in the same synchronous turn; no partial acquisition escapes. */
  const acquire = (
    ctx: IConcurrencyAttemptContext,
    identities: readonly string[],
    holder: IConcurrencyHolder,
    stages: IConcurrencyStageObserver | undefined
  ): IKeyLease => {
    /** Each waiting admission observes this exact signal only after all entries are released. */
    const released = deferred<void>()
    /** Preserve primitive holder metadata independently from caller-owned objects. */
    const capturedHolder = Object.freeze({ ...holder })
    /** Original resource entries each cache their own cleanup Promise. */
    let disposal: Promise<void> | undefined
    /** Symbol cleanup derives from the same primary release, with no second table mutation. */
    let symbolic: Promise<void> | undefined
    /** One synchronous release removes only entries still bearing this exact lease. */
    const dispose = (): Promise<void> => {
      if (disposal !== undefined) return disposal
      for (const identity of identities)
        if (entries.get(identity)?.lease === lease) entries.delete(identity)
      released.resolve()
      observe(stages, 'onLockReleased', ctx.attempt, identities.length)
      return (disposal = Promise.resolve())
    }
    /** The lease owns only entries bearing its exact identity, never a replacement's entries. */
    const lease: IKeyLease = {
      released: released.promise,
      dispose,
      [Symbol.asyncDispose]: () =>
        (symbolic ??= dispose().catch((error) => reportCleanupError(report, error)))
    }
    for (const [index, identity] of identities.entries())
      entries.set(identity, { key: ctx.lock![index]!, holder: capturedHolder, lease })
    observe(stages, 'onLockAcquired', ctx.attempt, identities.length)
    return lease
  }

  /** The single FIFO covers acquisition only; native work retains its real independent lifetime. */
  const waitForKeys = async (
    ctx: IConcurrencyAttemptContext,
    identities: readonly string[],
    holder: IConcurrencyHolder,
    stages: IConcurrencyStageObserver | undefined
  ): Promise<IKeyLease> => {
    /** This bridge cancels only queued admission when the original ctx.wait budget ends. */
    const admission = createAbortController()
    /** One actual queued acquisition remains observed until cancellation cleanup has ended. */
    const pending = limiter.run(
      async () => {
        try {
          while (true) {
            throwIfAborted(admission.signal)
            assertOpen()
            /** Each wake-up rechecks the same canonical table before any native operation starts. */
            const held = conflict(identities)
            if (held === undefined) return acquire(ctx, identities, holder, stages)
            await raceWithAbort(() => held.lease.released, {
              signal: admission.signal,
              cleanupPolicy: 'report',
              report
            })
          }
        } catch (error) {
          /** A late cancellation acknowledges the exact reason owned by the original wait. */
          if (admission.signal.aborted) throw readAbortReason(admission.signal)
          throw error
        }
      },
      { signal: admission.signal }
    )
    try {
      return await ctx.wait(pending)
    } catch (primary) {
      /** Preserve the wait owner's raw reason so utils does not report its cancellation twice. */
      const reason = ctx.signal?.aborted
        ? readAbortReason(ctx.signal)
        : primary instanceof StorageContractError &&
            primary.code === StorageContractErrorCode.lockTimeout
          ? primary.cause
          : primary
      admission.abort(reason)
      try {
        /** A lease that won just before the budget must be released before returning the failure. */
        const late = await pending
        await late.dispose()
      } catch (secondary) {
        if (
          secondary !== reason &&
          secondary !== primary &&
          !walkErrorCauses(secondary).includes(primary)
        )
          reportCleanupError(report, secondary)
      }
      throw primary
    }
  }

  /** The backend's complete native attempt remains inside the acquired resource interval. */
  const attempt = async <R>(
    ctx: IConcurrencyAttemptContext,
    holder: IConcurrencyHolder,
    native: IConcurrencyPort<R>,
    stages?: IConcurrencyStageObserver
  ): Promise<IConcurrencyAttempt<R>> => {
    assertOpen()
    /** Only an authentic active original context can supply canonical identities. */
    const identities = readConcurrencyLockIdentities(ctx)
    /** Accepted attempts drain through the original lifecycle tracker, including optimistic work. */
    const finish = lifetime.retain(owner)
    /** At most one all-or-nothing lease is owned by this attempt. */
    let lease: IKeyLease | undefined
    try {
      throwIfAborted(ctx.signal)
      if (ctx.locking === 'pessimistic' && identities.length !== 0) {
        /** Empty tables admit immediately without scheduling through the limiter. */
        const held = conflict(identities)
        if (held === undefined) lease = acquire(ctx, identities, holder, stages)
        else if (ctx.admission === 'try')
          return {
            status: 'conflict',
            phase: 'acquire',
            keys: ctx.lock ?? [],
            holder: held.holder
          }
        else lease = await waitForKeys(ctx, identities, holder, stages)
      }
      return await native.attempt(ctx)
    } finally {
      await lease?.dispose()
      finish()
    }
  }

  /** The physical owner alone closes this shared provider after its last reference is released. */
  const dispose = (): Promise<void> => {
    if (disposal !== undefined) return disposal
    lifetime.seal(owner)
    /** Closing the original FIFO rejects queued work but never detaches running native work. */
    const reason = new StorageContractError(StorageContractErrorCode.disposed)
    limiter.close(reason)
    disposal = Promise.all([limiter.dispose(reason), lifetime.whenZero(owner)]).then(
      () => undefined
    )
    return disposal
  }

  return {
    attempt,
    inspectLocks: () => {
      assertOpen()
      return snapshotConcurrencyLockHoldings(
        [...entries.values()].map((entry) => ({
          key: entry.key,
          holder: entry.holder,
          expired: false
        }))
      )
    },
    dispose,
    [Symbol.asyncDispose]: () =>
      (symbolic ??= dispose().catch((error) => reportCleanupError(report, error)))
  }
}
