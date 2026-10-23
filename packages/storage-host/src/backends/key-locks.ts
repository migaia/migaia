import { asyncDisposeKey } from '@migaia/plugin-host'
import { createAbortController, createQuiescenceTracker } from '@migaia/lifecycle'
import {
  StorageContractError,
  StorageContractErrorCode,
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockHoldings,
  snapshotStorageKey,
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
import type { IAbortSignal } from '@migaia/utils/promise'
import { createConcurrencyLimiter, deferred, raceWithAbort } from '@migaia/utils/promise'
import { readAbortReason, subscribeToAbort, throwIfAborted } from '../core/operation.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'

/** The physical backend owns this port; creating it grants no transaction or retry authority. */
export type IBackendKeyLockPort = IStorageResource & {
  attempt<R>(
    ctx: IConcurrencyAttemptContext,
    holder: IConcurrencyHolder,
    native: IConcurrencyPort<R>,
    stages?: IConcurrencyStageObserver,
    admissionSignal?: IAbortSignal,
    ranges?: readonly {
      readonly channel: ILockKey['channel']
      readonly lower: string
      readonly upper: string
    }[],
    additionalIdentities?: () => readonly string[]
  ): Promise<IConcurrencyAttempt<R>>
  /** Probe canonical identities directly; ranges scan only this original active lock table. */
  probe(
    identities: readonly string[],
    ranges?: readonly {
      readonly channel: ILockKey['channel']
      readonly lower: string
      readonly upper: string
    }[],
    current?: IConcurrencyAttemptContext
  ): ILockHolding | undefined
  /** Final conflict admission and this synchronous native mutation share one uninterrupted turn. */
  attemptWrite<R>(
    ctx: IConcurrencyAttemptContext,
    holder: IConcurrencyHolder,
    write: () => R,
    stages?: IConcurrencyStageObserver,
    admissionSignal?: IAbortSignal,
    ranges?: readonly {
      readonly channel: ILockKey['channel']
      readonly lower: string
      readonly upper: string
    }[],
    admit?: (commit: () => IConcurrencyAttempt<R>) => Promise<IConcurrencyAttempt<R>>,
    additionalIdentities?: () => readonly string[]
  ): Promise<IConcurrencyAttempt<R>>
  inspectLocks(): readonly ILockHolding[]
}

/** All entries acquired atomically by one attempt share one original release signal. */
type IKeyLease = IStorageResource & {
  /** Exact authentic attempt identity excludes only its own held rows during native range checks. */
  readonly context: IConcurrencyAttemptContext
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
  const entries = {
    text: new Map<string, IKeyEntry>(),
    bytes: new Map<string, IKeyEntry>(),
    record: new Map<string, IKeyEntry>(),
    vector: new Map<string, IKeyEntry>(),
    rdf: new Map<string, IKeyEntry>()
  }
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

  /** Fixed finite channel buckets retain each physical entry once without interpreting its bytes. */
  const readEntry = (identity: string): IKeyEntry | undefined =>
    entries.text.get(identity) ??
    entries.bytes.get(identity) ??
    entries.record.get(identity) ??
    entries.vector.get(identity) ??
    entries.rdf.get(identity)

  /** Canonical input order determines the first actual conflicting holder. */
  const conflict = (
    identities: readonly string[],
    ranges: readonly {
      readonly channel: ILockKey['channel']
      readonly lower: string
      readonly upper: string
    }[] = [],
    current?: IConcurrencyAttemptContext
  ): IKeyEntry | undefined => {
    for (const identity of identities) {
      /** Lookup never re-encodes or sorts the logical key. */
      const held = readEntry(identity)
      if (held !== undefined && held.lease.context !== current) return held
    }
    /** At most the affected physical channels are inspected; no range index or range lock exists. */
    for (const range of ranges)
      for (const [identity, held] of entries[range.channel])
        if (held.lease.context !== current && range.lower <= identity && identity < range.upper)
          return held
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
      for (const identity of identities) {
        /** The canonical identity locates at most one entry across the fixed channel buckets. */
        const held = readEntry(identity)
        if (held?.lease === lease) entries[held.key.channel].delete(identity)
      }
      released.resolve()
      observe(stages, 'onLockReleased', ctx.attempt, identities.length)
      return (disposal = Promise.resolve())
    }
    /** The lease owns only entries bearing its exact identity, never a replacement's entries. */
    const lease: IKeyLease = {
      context: ctx,
      released: released.promise,
      dispose,
      [asyncDisposeKey]: () =>
        (symbolic ??= dispose().catch((error) => reportCleanupError(report, error)))
    }
    for (const [index, identity] of identities.entries()) {
      /** Authentic context keys and identities were paired by the same original normalization. */
      const key = ctx.lock![index]!
      entries[key.channel].set(identity, { key, holder: capturedHolder, lease })
    }
    observe(stages, 'onLockAcquired', ctx.attempt, identities.length)
    return lease
  }

  /** The single FIFO covers acquisition only; native work retains its real independent lifetime. */
  const waitForKeys = async (
    ctx: IConcurrencyAttemptContext,
    identities: readonly string[],
    holder: IConcurrencyHolder,
    stages: IConcurrencyStageObserver | undefined,
    admissionSignal: IAbortSignal | undefined,
    ranges: readonly {
      readonly channel: ILockKey['channel']
      readonly lower: string
      readonly upper: string
    }[],
    additionalIdentities?: () => readonly string[]
  ): Promise<IKeyLease | undefined> => {
    /** This bridge cancels only queued admission when the original ctx.wait budget ends. */
    const admission = createAbortController()
    /** Member closure cancels only this not-yet-native admission on the existing bridge. */
    const unsubscribe = subscribeToAbort(
      admissionSignal,
      () =>
        admission.abort(
          new StorageContractError(StorageContractErrorCode.aborted, {
            cause: readAbortReason(admissionSignal)
          })
        ),
      report
    )
    /** One actual queued acquisition remains observed until cancellation cleanup has ended. */
    const pending = limiter
      .run(
        async () => {
          try {
            while (true) {
              throwIfAborted(admission.signal)
              assertOpen()
              /** Each wake-up rechecks the same canonical table before any native operation starts. */
              const additional = additionalIdentities?.() ?? []
              const held = conflict(identities, ranges) ?? conflict(additional)
              if (held === undefined)
                return ctx.locking === 'pessimistic' && identities.length > 0
                  ? acquire(ctx, identities, holder, stages)
                  : undefined
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
      .catch((error: unknown) => {
        /** An external budget cancellation retains the exact acknowledgement expected by utils. */
        if (admission.signal.aborted && ctx.signal?.aborted) throw readAbortReason(ctx.signal)
        throw error
      })
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
        await late?.dispose()
      } catch (secondary) {
        if (
          secondary !== reason &&
          secondary !== primary &&
          !walkErrorCauses(secondary).includes(primary)
        )
          reportCleanupError(report, secondary)
      }
      throw primary
    } finally {
      unsubscribe()
    }
  }

  /** The backend's complete native attempt remains inside the acquired resource interval. */
  const runAttempt = async <R>(
    ctx: IConcurrencyAttemptContext,
    holder: IConcurrencyHolder,
    native: IConcurrencyPort<R> | undefined,
    stages?: IConcurrencyStageObserver,
    admissionSignal?: IAbortSignal,
    write?: () => R,
    ranges: readonly {
      readonly channel: ILockKey['channel']
      readonly lower: string
      readonly upper: string
    }[] = [],
    admit?: (commit: () => IConcurrencyAttempt<R>) => Promise<IConcurrencyAttempt<R>>,
    protectHeld = write !== undefined,
    additionalIdentities?: () => readonly string[]
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
      throwIfAborted(admissionSignal)
      if (
        (ctx.locking === 'pessimistic' || protectHeld) &&
        (identities.length !== 0 || ranges.length !== 0 || additionalIdentities !== undefined)
      ) {
        /** Empty tables admit immediately without scheduling through the limiter. */
        const additional = additionalIdentities?.() ?? []
        const held = conflict(identities, ranges) ?? conflict(additional)
        if (held === undefined) {
          if (ctx.locking === 'pessimistic' && identities.length > 0)
            lease = acquire(ctx, identities, holder, stages)
        } else if (ctx.admission === 'try')
          return {
            status: 'conflict',
            phase: 'acquire',
            keys: protectHeld ? [held.key] : (ctx.lock ?? []),
            holder: held.holder
          }
        else
          lease = await waitForKeys(
            ctx,
            identities,
            holder,
            stages,
            admissionSignal,
            ranges,
            additionalIdentities
          )
      }
      /** A member may close after acquisition but before the native terminal is entered. */
      throwIfAborted(admissionSignal)
      if (write !== undefined) {
        if (admit !== undefined && typeof admit !== 'function')
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        /** A physical gate can enter this same original native terminal at most once. */
        let invoked = false
        /** The backend's existing physical admission invokes this final synchronous commit turn. */
        const commit = (): IConcurrencyAttempt<R> => {
          if (invoked) throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          invoked = true
          /** Waiting, acquisition observation or physical admission may expose a new holder. */
          const additional = additionalIdentities?.() ?? []
          const held =
            conflict(identities, ranges, lease?.context) ?? conflict(additional, [], lease?.context)
          if (held !== undefined)
            return { status: 'conflict', phase: 'acquire', keys: [held.key], holder: held.holder }
          /** Both original operation cancellation and member closure are live after physical waits. */
          throwIfAborted(ctx.signal)
          throwIfAborted(admissionSignal)
          /** No await separates the final checks from native data/revision mutation. */
          return { status: 'committed', value: write() }
        }
        return admit === undefined ? commit() : await admit(commit)
      }
      if (protectHeld) {
        /** Async root writes use the same admission table before entering their actual native port. */
        const additional = additionalIdentities?.() ?? []
        const held =
          conflict(identities, ranges, lease?.context) ?? conflict(additional, [], lease?.context)
        if (held !== undefined)
          return { status: 'conflict', phase: 'acquire', keys: [held.key], holder: held.holder }
        throwIfAborted(ctx.signal)
      }
      return await native!.attempt(ctx)
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
    attempt: (ctx, holder, native, stages, admissionSignal, ranges, additionalIdentities) =>
      runAttempt(
        ctx,
        holder,
        native,
        stages,
        admissionSignal,
        undefined,
        ranges,
        undefined,
        ranges !== undefined || additionalIdentities !== undefined,
        additionalIdentities
      ),
    attemptWrite: (
      ctx,
      holder,
      write,
      stages,
      admissionSignal,
      ranges,
      admit,
      additionalIdentities
    ) =>
      runAttempt(
        ctx,
        holder,
        undefined,
        stages,
        admissionSignal,
        write,
        ranges,
        admit,
        true,
        additionalIdentities
      ),
    probe: (identities, ranges, current) => {
      assertOpen()
      /** Only the original live attempt can identify its own lease; key lists grant no exemption. */
      if (current !== undefined) readConcurrencyLockIdentities(current)
      /** Only the first actual holder is copied; point probing never sorts or scans other keys. */
      const held = conflict(identities, ranges, current)
      if (held === undefined) return undefined
      /** New finite identities detach through the original contract snapshot owner. */
      if (held.key.channel === 'vector' || held.key.channel === 'rdf')
        return snapshotConcurrencyLockHoldings([
          { key: held.key, holder: held.holder, expired: false }
        ])[0]
      return Object.freeze({
        key:
          held.key.channel === 'bytes'
            ? held.key
            : Object.freeze({
                channel: held.key.channel,
                key: snapshotStorageKey(held.key.key, undefined)
              }),
        holder: held.holder,
        expired: false
      })
    },
    inspectLocks: () => {
      assertOpen()
      return snapshotConcurrencyLockHoldings(
        Object.values(entries)
          .flatMap((channel) => [...channel.values()])
          .map((entry) => ({
            key: entry.key,
            holder: entry.holder,
            expired: false
          }))
      )
    },
    dispose,
    [asyncDisposeKey]: () =>
      (symbolic ??= dispose().catch((error) => reportCleanupError(report, error)))
  }
}
