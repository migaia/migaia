import { asyncDisposeKey } from '@migaia/plugin-host'
import { createAbortController, createQuiescenceTracker } from '@migaia/lifecycle'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext,
  type IConcurrencyHolder,
  type IConcurrencyPort,
  type IConcurrencyStageObserver,
  type ILockHolding,
  type ILockKey,
  type IStorageResource
} from '@migaia/storage-contract'
import {
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockHoldings
} from '../authoring/concurrency.ts'
import { snapshotStorageKey } from '../authoring/key.ts'
import { walkErrorCauses } from '@migaia/utils/error'
import type { IAbortSignal } from '@migaia/utils/promise'
import { createConcurrencyLimiter, deferred, raceWithAbort } from '@migaia/utils/promise'
import { readAbortReason, subscribeToAbort, throwIfAborted } from '../core/operation.ts'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.ts'

/** The physical backend owns this port; creating it grants no transaction or retry authority. */
export type IBackendKeyLockPort = IStorageResource & {
  /**
   * Hold backend-private metadata by canonical point identity without entering business clear
   * ranges.
   */
  attemptMetadata<R>(
    ctx: IConcurrencyAttemptContext,
    holder: IConcurrencyHolder,
    native: IConcurrencyPort<R>,
    stages?: IConcurrencyStageObserver,
    admissionSignal?: IAbortSignal
  ): Promise<IConcurrencyAttempt<R>>
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
  /** Business channel clears cannot touch private metadata, while exact point conflicts still apply. */
  readonly rangeVisible: boolean
}

/** Construct only through the backend core's original installation window. */

/** One physical lock provider owns only its canonical table, limiter and original lifecycle. */
type IBackendKeyLockContext = {
  /** This is the sole logical lock table, shared by the physical backend's existing closure. */
  entries: Record<ILockKey['channel'], Map<string, IKeyEntry>>

  /** Only contended waiting admissions enter the existing utility FIFO. */
  limiter: ReturnType<typeof createConcurrencyLimiter>

  /** The original lifecycle tracker seals and drains complete attempts, including native cleanup. */
  lifetime: ReturnType<typeof createQuiescenceTracker<object>>

  /** A single private key groups this provider's resource lifetime without another state machine. */
  owner: object

  /** Both resource entries cache their own original Promise. */
  disposal: Promise<void> | undefined

  /** Symbol cleanup reports the primary failure rather than rejecting a second time. */
  symbolic: Promise<void> | undefined

  /** The canonical final diagnostic adapter is independent of the first sharing registration. */
  report: ReturnType<typeof createStorageOperationReporter>
}
/** Create one physical lock table backed by the canonical limiter and lifecycle tracker. */
export function createBackendKeyLockPort(): IBackendKeyLockPort {
  /** Initialize native facts in original construction order before publishing any port. */
  const lockState = {} as IBackendKeyLockContext

  /** This is the sole logical lock table, shared by the physical backend's existing closure. */
  lockState.entries = {
    text: new Map<string, IKeyEntry>(),
    bytes: new Map<string, IKeyEntry>(),
    record: new Map<string, IKeyEntry>(),
    vector: new Map<string, IKeyEntry>(),
    rdf: new Map<string, IKeyEntry>()
  }

  /** Only contended waiting admissions enter the existing utility FIFO. */
  lockState.limiter = createConcurrencyLimiter({ concurrency: 1 })

  /** The original lifecycle tracker seals and drains complete attempts, including native cleanup. */
  lockState.lifetime = createQuiescenceTracker<object>()

  /** A single private key groups this provider's resource lifetime without another state machine. */
  lockState.owner = {}

  /** The canonical final diagnostic adapter is independent of the first sharing registration. */
  lockState.report = createStorageOperationReporter()
  return createKeyLockMethods(lockState)
}

/** Resource closure rejects new admissions without changing any accepted native attempt. */
function assertOpen(lockState: IBackendKeyLockContext): void {
  if (lockState.lifetime.isSealed(lockState.owner))
    throw new StorageContractError(StorageContractErrorCode.disposed)
}

/** Observe the real resource boundary without granting the callback control of the attempt. */
function observe(
  lockState: IBackendKeyLockContext,
  stages: IConcurrencyStageObserver | undefined,
  name: 'onLockAcquired' | 'onLockReleased',
  attempt: number,
  keyCount: number
): void {
  if (stages === undefined) return
  try {
    /** Select before allocating arguments so absent observers retain the zero-handler path. */
    if (stages[name] === undefined) return
    /** The original observer remains the callback receiver and owns any rejected thenable. */
    void Promise.resolve(stages[name]!(attempt, keyCount)).catch((error) =>
      reportCleanupError((failure) => stages.report(failure), error)
    )
  } catch (error) {
    reportCleanupError((failure) => stages.report(failure), error)
  }
}

/** Fixed finite channel buckets retain each physical entry once without interpreting its bytes. */
function readEntry(lockState: IBackendKeyLockContext, identity: string): IKeyEntry | undefined {
  return (
    lockState.entries.text.get(identity) ??
    lockState.entries.bytes.get(identity) ??
    lockState.entries.record.get(identity) ??
    lockState.entries.vector.get(identity) ??
    lockState.entries.rdf.get(identity)
  )
}

/** Canonical input order determines the first actual conflicting holder. */
function conflict(
  lockState: IBackendKeyLockContext,
  identities: readonly string[],
  ranges: readonly {
    readonly channel: ILockKey['channel']
    readonly lower: string
    readonly upper: string
  }[] = [],
  current?: IConcurrencyAttemptContext
): IKeyEntry | undefined {
  for (const identity of identities) {
    /** Lookup never re-encodes or sorts the logical key. */
    const held = readEntry(lockState, identity)
    if (held !== undefined && held.lease.context !== current) return held
  }
  /** At most the affected physical channels are inspected; no range index or range lock exists. */
  for (const range of ranges)
    for (const [identity, held] of lockState.entries[range.channel])
      if (
        held.rangeVisible &&
        held.lease.context !== current &&
        range.lower <= identity &&
        identity < range.upper
      )
        return held
  return undefined
}

/** Check and acquire all entries in the same synchronous turn; no partial acquisition escapes. */
function acquire(
  lockState: IBackendKeyLockContext,
  ctx: IConcurrencyAttemptContext,
  identities: readonly string[],
  holder: IConcurrencyHolder,
  stages: IConcurrencyStageObserver | undefined,
  rangeVisible = true
): IKeyLease {
  /** Primitive holder facts remain stable while native work retains this lease across awaits. */
  const capturedHolder = { ...holder }
  /** This one named owner releases only rows still bearing its original identity. */
  const lease = new BackendKeyLease(lockState, ctx, identities, stages)
  for (const [index, identity] of identities.entries()) {
    /** Authentic context keys and identities were paired by the same original normalization. */
    const key = ctx.lock![index]!
    lockState.entries[key.channel].set(identity, {
      key,
      holder: capturedHolder,
      lease,
      rangeVisible
    })
  }
  observe(lockState, stages, 'onLockAcquired', ctx.attempt, identities.length)
  return lease
}

/** One all-or-nothing lease owns its original release signal and cached cleanup promises. */
class BackendKeyLease implements IKeyLease {
  /** Only this authentic attempt is exempted from its own point/range conflicts. */
  readonly context: IConcurrencyAttemptContext
  /** Waiting acquisitions observe actual row release through this original promise. */
  readonly released: Promise<void>
  /** Original physical table and diagnostics remain the sole provider state. */
  readonly #lockState: IBackendKeyLockContext
  /** Canonical identities were paired with authentic keys by the original contract owner. */
  readonly #identities: readonly string[]
  /** Original stage observer receives actual acquisition/release facts. */
  readonly #stages: IConcurrencyStageObserver | undefined
  /** This native completion wakes acquisitions after every owned row has left the table. */
  readonly #release: ReturnType<typeof deferred<void>>
  /** Explicit cleanup returns its original primary completion. */
  #disposal: Promise<void> | undefined
  /** Symbol cleanup reports failure through a separately cached successful projection. */
  #symbolic: Promise<void> | undefined

  /** Retain actual lease facts without acquiring a second resource lifetime. */
  constructor(
    lockState: IBackendKeyLockContext,
    ctx: IConcurrencyAttemptContext,
    identities: readonly string[],
    stages: IConcurrencyStageObserver | undefined
  ) {
    this.#lockState = lockState
    this.context = ctx
    this.#identities = identities
    this.#stages = stages
    this.#release = deferred<void>()
    this.released = this.#release.promise
  }

  /** Remove only rows bearing this exact lease before waking original waiters. */
  readonly dispose = (): Promise<void> => {
    if (this.#disposal !== undefined) return this.#disposal
    for (const identity of this.#identities) {
      /** Replacement leases retain their own row even when this older lease closes. */
      const held = readEntry(this.#lockState, identity)
      if (held?.lease === this) this.#lockState.entries[held.key.channel].delete(identity)
    }
    this.#release.resolve()
    observe(
      this.#lockState,
      this.#stages,
      'onLockReleased',
      this.context.attempt,
      this.#identities.length
    )
    return (this.#disposal = Promise.resolve())
  }

  /** Language disposal observes the same release without repeating table mutations. */
  readonly [asyncDisposeKey] = (): Promise<void> =>
    (this.#symbolic ??= this.dispose().catch((error) =>
      reportCleanupError(this.#lockState.report, error)
    ))
}

/** The single FIFO covers acquisition only; native work retains its real independent lifetime. */
async function waitForKeys(
  lockState: IBackendKeyLockContext,
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
  additionalIdentities?: () => readonly string[],
  rangeVisible = true
): Promise<IKeyLease | undefined> {
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
    lockState.report
  )
  /** One actual queued acquisition remains observed until cancellation cleanup has ended. */
  const pending = lockState.limiter
    .run(
      async () => {
        try {
          while (true) {
            throwIfAborted(admission.signal)
            assertOpen(lockState)
            /** Each wake-up rechecks the same canonical table before any native operation starts. */
            const additional = additionalIdentities?.() ?? []
            const held = conflict(lockState, identities, ranges) ?? conflict(lockState, additional)
            if (held === undefined)
              return ctx.locking === 'pessimistic' && identities.length > 0
                ? acquire(lockState, ctx, identities, holder, stages, rangeVisible)
                : undefined
            await raceWithAbort(() => held.lease.released, {
              signal: admission.signal,
              cleanupPolicy: 'report',
              report: lockState.report
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
        reportCleanupError(lockState.report, secondary)
    }
    throw primary
  } finally {
    unsubscribe()
  }
}

/** The backend's complete native attempt remains inside the acquired resource interval. */
async function runAttempt<R>(
  lockState: IBackendKeyLockContext,
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
  additionalIdentities?: () => readonly string[],
  rangeVisible = true
): Promise<IConcurrencyAttempt<R>> {
  assertOpen(lockState)
  /** Only an authentic active original context can supply canonical identities. */
  const identities = readConcurrencyLockIdentities(ctx)
  /** Accepted attempts drain through the original lifecycle tracker, including optimistic work. */
  const finish = lockState.lifetime.retain(lockState.owner)
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
      const held = conflict(lockState, identities, ranges) ?? conflict(lockState, additional)
      if (held === undefined) {
        if (ctx.locking === 'pessimistic' && identities.length > 0)
          lease = acquire(lockState, ctx, identities, holder, stages, rangeVisible)
      } else if (ctx.admission === 'try')
        return {
          status: 'conflict',
          phase: 'acquire',
          keys: protectHeld ? [held.key] : (ctx.lock ?? []),
          holder: held.holder
        }
      else
        lease = await waitForKeys(
          lockState,
          ctx,
          identities,
          holder,
          stages,
          admissionSignal,
          ranges,
          additionalIdentities,
          rangeVisible
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
          conflict(lockState, identities, ranges, lease?.context) ??
          conflict(lockState, additional, [], lease?.context)
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
        conflict(lockState, identities, ranges, lease?.context) ??
        conflict(lockState, additional, [], lease?.context)
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
function dispose(lockState: IBackendKeyLockContext): Promise<void> {
  if (lockState.disposal !== undefined) return lockState.disposal
  lockState.lifetime.seal(lockState.owner)
  /** Closing the original FIFO rejects queued work but never detaches running native work. */
  const reason = new StorageContractError(StorageContractErrorCode.disposed)
  lockState.limiter.close(reason)
  lockState.disposal = Promise.all([
    lockState.limiter.dispose(reason),
    lockState.lifetime.whenZero(lockState.owner)
  ]).then(() => undefined)
  return lockState.disposal
}
/** Publish lock-provider ports over the original physical state. */
function createKeyLockMethods(lockState: IBackendKeyLockContext): IBackendKeyLockPort {
  return {
    attemptMetadata: (ctx, holder, native, stages, admissionSignal) =>
      runAttempt(
        lockState,
        ctx,
        holder,
        native,
        stages,
        admissionSignal,
        undefined,
        [],
        undefined,
        false,
        undefined,
        false
      ),
    attempt: (ctx, holder, native, stages, admissionSignal, ranges, additionalIdentities) =>
      runAttempt(
        lockState,
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
        lockState,
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
      assertOpen(lockState)
      /** Only the original live attempt can identify its own lease; key lists grant no exemption. */
      if (current !== undefined) readConcurrencyLockIdentities(current)
      /** Only the first actual holder is copied; point probing never sorts or scans other keys. */
      const held = conflict(lockState, identities, ranges, current)
      if (held === undefined) return undefined
      /** New finite identities detach through the original contract snapshot owner. */
      if (held.key.channel === 'vector' || held.key.channel === 'rdf')
        return snapshotConcurrencyLockHoldings([
          { key: held.key, holder: held.holder, expired: false }
        ])[0]
      return {
        key:
          held.key.channel === 'bytes'
            ? held.key
            : {
                channel: held.key.channel,
                key: snapshotStorageKey(held.key.key, undefined)
              },
        holder: held.holder,
        expired: false
      }
    },
    inspectLocks: () => {
      assertOpen(lockState)
      return snapshotConcurrencyLockHoldings(
        Object.values(lockState.entries)
          .flatMap((channel) => [...channel.values()])
          .map((entry) => ({
            key: entry.key,
            holder: entry.holder,
            expired: false
          }))
      )
    },
    dispose: () => dispose(lockState),
    [asyncDisposeKey]: () =>
      (lockState.symbolic ??= dispose(lockState).catch((error) =>
        reportCleanupError(lockState.report, error)
      ))
  }
}
