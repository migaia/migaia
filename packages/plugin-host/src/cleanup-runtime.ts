/** Owns ordered cleanup collection and lifecycle release policy, without mutation planning. */
import type { IRegistration } from './registry.js'
import {
  createLifecycleScope,
  type ICleanupResult,
  type ISyncStartedDisposalLedger,
  type IPendingTracker,
  type IReleaseDescriptor
} from '@migaia/lifecycle'
import { probeThenable, assimilateCapturedThen } from '@migaia/utils/function'
import type { IScheduler } from '@migaia/utils/scheduler'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { PluginHostCleanupMode } from './state-constants.js'

/** Visits an existing ordered group in reverse without copying its growable storage. */
export function* reverseItems<T>(items: readonly T[]): IterableIterator<T> {
  for (let index = items.length - 1; index >= 0; index -= 1) yield items[index]!
}

/** Collects synchronous detach failures without skipping later exact stage entries. */
export function detachRegistrationStages<TDomainCore extends object, TValue>(
  registration: IRegistration<TDomainCore, TValue>,
  errors: unknown[]
): void {
  for (const detach of reverseItems(registration.pipelineDisposers)) {
    try {
      detach()
    } catch (error) {
      errors.push(error)
    }
  }
  registration.pipelineDisposers = []
  registration.stageEntries.clear()
}

/** Appends ordered cleanup leaves without copying an accumulating error array. */
export function appendCleanupErrors(target: unknown[], errors: readonly unknown[]): void {
  for (const error of errors) target.push(error)
}

/** One identity bucket owns an ordered intrusive list, so matching never rescans consumed entries. */
type IReturnedErrorBucket = {
  first: IReturnedErrorEntry | undefined
  last: IReturnedErrorEntry | undefined
}

/** An error appears in at most three identity buckets and unlinks from each in constant time. */
type IReturnedErrorEntry = {
  readonly index: number
  readonly bucket: IReturnedErrorBucket
  previous: IReturnedErrorEntry | undefined
  next: IReturnedErrorEntry | undefined
}

/** Registration-owned cleanup choice, read only when lifecycle admits a release descriptor. */
type IPluginHostCleanupPolicy = Readonly<{
  readonly cleanupMode?: PluginHostCleanupMode
  readonly cleanupDeadlineAt?: number
  readonly cleanupLedger?: ISyncStartedDisposalLedger
}>

/** Stable kinds for structured nodes emitted by PluginHost disposal producers. */
export const PluginHostDisposalNodeKind = Object.freeze({
  /** Semantic error node created by the Host cleanup producer. */
  hostError: 'host-error',
  /** Aggregate node retaining several original cleanup failures in order. */
  aggregate: 'aggregate',
  /** Phase wrapper whose cause preserves a disposer failure. */
  disposerWrapper: 'disposer-wrapper'
} as const)

/** Kinds proven by readPluginHostDisposalProvenance, not by structural property matching. */
export type IPluginHostDisposalNodeKind =
  (typeof PluginHostDisposalNodeKind)[keyof typeof PluginHostDisposalNodeKind]

/** Frozen provenance detail stored only in the private producer registry. */
export type IPluginHostDisposalProvenance = Readonly<{
  /** Producer-certified node category; copying fields does not copy that authority. */
  readonly kind: IPluginHostDisposalNodeKind
  /** Cleanup phase when this producer node wraps a phase-specific failure; otherwise omitted. */
  readonly phase?: string
}>

type IPluginHostCleanupRuntimeOptions = Readonly<{
  readonly scheduler: IScheduler
  readonly pending: IPendingTracker
  readonly disposeStepTimeoutMs: number | false
  readonly reportLateError: (error: unknown) => void
  readonly wrapDisposalError: (error: unknown, phase: string) => unknown
}>

/** Owns disposer policy independently from Host mutation, publication, and resource ownership. */
export class PluginHostCleanupRuntime {
  /** Immutable scheduler, tracker, and timeout policy installed by the owning Host. */
  readonly #options: IPluginHostCleanupRuntimeOptions

  constructor(options: IPluginHostCleanupRuntimeOptions) {
    this.#options = options
  }

  /** Builds one lifecycle descriptor with bounded waiting and actual settlement observation. */
  createStepDescriptor(
    phase: string,
    run: () => void | PromiseLike<void>,
    policy?: IPluginHostCleanupPolicy
  ): IReleaseDescriptor {
    return new PluginHostReleaseStep(this.#options, phase, run, policy)
  }

  /** Disposes one ordered function group and optionally preserves exact rejection identities. */
  async disposeGroup(
    disposers: readonly (() => void | PromiseLike<void>)[],
    phase: string,
    preserveErrorIdentity = false,
    policy?: IPluginHostCleanupPolicy
  ): Promise<unknown[]> {
    if (disposers.length === 0) return []
    /** Lifecycle remains the sole owner of sequential resource release and bounded waiting. */
    const scope = createLifecycleScope({
      errorPolicy: 'collect',
      scheduler: this.#options.scheduler,
      deadlineAt: policy?.cleanupDeadlineAt
    })
    for (const dispose of disposers)
      scope.own(dispose, this.createStepDescriptor(phase, dispose, policy))
    return this.#wrapCollected(await scope.dispose(), phase, preserveErrorIdentity)
  }

  /** Seals actual work observation; the continuation contains only errors after this snapshot. */
  complete(
    errors: readonly unknown[],
    ledger: ISyncStartedDisposalLedger,
    preserveErrorIdentity: boolean
  ): ICleanupResult {
    /** Capture whether actual cleanup work still outlives this logical completion. */
    const pending = ledger.pending > 0
    /** Sealing freezes current ledger observations while retaining physical completion when needed. */
    const outcome = ledger.seal()
    /**
     * A timed-out callback can reject before the whole plan seals. Match each logical failure once
     * so that such a late rejection is retained without repeating an already returned error.
     */
    const matcher = new ReturnedErrorMatcher(errors)
    /** Already-returned error identities are consumed once before additional leaves are published. */
    const newlyObserved = outcome.cleanupErrors.filter((entry) => {
      if (matcher.take(entry.error)) return false
      /** Provisional rollback already exposes an aggregate's children as individual failures. */
      if (entry.error instanceof AggregateError) return !matcher.takeAll(entry.error.errors)
      return true
    })
    /** Only unmatched physical observations are appended to the logical cleanup result. */
    const additionalErrors = this.#wrapCollected(newlyObserved, undefined, preserveErrorIdentity)
    /** Late work keeps the existing completion channel and reports newly observed cleanup failures. */
    const physicalCompletion = pending
      ? outcome.physicalCompletion.then((result) => {
          /** Every actual late failure receives the original wrapping and diagnostic policy. */
          const lateErrors = this.#wrapCollected(
            result.cleanupErrors,
            undefined,
            preserveErrorIdentity
          )
          for (const error of lateErrors) this.#options.reportLateError(error)
          return Object.freeze({ cleanupErrors: Object.freeze(lateErrors) })
        })
      : undefined
    return Object.freeze({
      cleanupErrors: Object.freeze([...errors, ...additionalErrors]),
      ...(physicalCompletion ? { physicalCompletion } : {})
    })
  }

  /** Disposes an existing registration scope using the same error identity policy. */
  async disposeScope(
    scope: import('@migaia/lifecycle').ILifecycleScope | undefined,
    phase: string,
    preserveErrorIdentity = false
  ): Promise<unknown[]> {
    if (!scope) return []
    return this.#wrapCollected(await scope.dispose(), phase, preserveErrorIdentity)
  }

  /** Adds stable phase context without breaking the original cause chain. */
  #wrapCollected(
    collected: readonly { readonly error: unknown; readonly source?: string }[],
    phase: string | undefined,
    preserveErrorIdentity: boolean
  ): unknown[] {
    return collected.map((entry) => {
      if (preserveErrorIdentity) return entry.error
      return this.#options.wrapDisposalError(entry.error, phase ?? entry.source!)
    })
  }
}

/** Owns one lifecycle release descriptor's timeout, settlement and actual-work observation. */
class PluginHostReleaseStep {
  /** Scheduler, pending tracker and timeout policy remain owned by the Host cleanup runtime. */
  readonly #options: IPluginHostCleanupRuntimeOptions
  /** Stable cleanup phase identifies ledger work and timeout diagnostics. */
  readonly #phase: string
  /** Captured disposer is invoked without substituting its return value. */
  readonly #run: () => void | PromiseLike<void>
  /** Registration policy remains live because disposal mode is selected after scope admission. */
  readonly #policy: IPluginHostCleanupPolicy | undefined
  /** Force reports timeout only while the original graceful callback is still pending. */
  #settled = false

  /** Captures one descriptor's state instead of sharing constructor-local closures. */
  constructor(
    options: IPluginHostCleanupRuntimeOptions,
    phase: string,
    run: () => void | PromiseLike<void>,
    policy?: IPluginHostCleanupPolicy
  ) {
    this.#options = options
    this.#phase = phase
    this.#run = run
    this.#policy = policy
  }

  /** Unbounded cleanup bypasses the bounded graceful/force chain at disposal-time admission. */
  get custom(): (() => void | PromiseLike<void>) | undefined {
    return this.#policy?.cleanupMode === PluginHostCleanupMode.unbounded ||
      (this.#options.disposeStepTimeoutMs === false &&
        this.#policy?.cleanupDeadlineAt === undefined)
      ? this.#runObserved
      : undefined
  }

  /** Fixed configured timeout is unchanged; an absolute cleanup deadline is supplied by scope. */
  get gracefulTimeoutMs(): number | undefined {
    return this.#options.disposeStepTimeoutMs === false
      ? undefined
      : this.#options.disposeStepTimeoutMs
  }

  /** Captured disposer callbacks retain their original undefined receiver. */
  #invoke(): void | PromiseLike<void> {
    /** Property lookup is separated from invocation so no cleanup-step receiver is introduced. */
    const run = this.#run
    return run()
  }

  /** Receiverless lifecycle callback normalizes a custom thenable once before dual observation. */
  readonly #runObserved = (): void | PromiseLike<void> => this.#observeRun()

  /** Observes one custom disposer result through the existing ledger without adding an await. */
  #observeRun(): void | PromiseLike<void> {
    /** Original callback value is inspected only when actual-work tracking is required. */
    const result = this.#invoke()
    if (!this.#policy?.cleanupLedger) return result
    /** A captured then is shared by lifecycle and ledger instead of being read twice. */
    const probe = probeThenable(result)
    if (probe.kind === 'failed') throw probe.error
    if (probe.kind === 'not-thenable') return
    /** Both owners observe the same assimilated Promise. */
    const pending = assimilateCapturedThen<void>(probe.thenFn, result)
    this.#policy.cleanupLedger.start(this.#phase, () => pending)
    return pending
  }

  /** Receiverless lifecycle callback preserves the original derived Promise and settlement mark. */
  readonly graceful = (): Promise<void> => this.#runGraceful()

  /** Tracks the derived disposer Promise and marks its actual settlement under graceful cleanup. */
  async #runGraceful(): Promise<void> {
    /** One derived Promise adopts any thenable returned by the disposer. */
    const pending: Promise<void> = Promise.resolve().then(() => this.#invoke())
    this.#policy?.cleanupLedger?.start(this.#phase, () => pending)
    try {
      await this.#options.pending.track(pending)
    } finally {
      this.#settled = true
    }
  }

  /** Receiverless force callback retains the same native coded timeout while work is pending. */
  readonly force = (): void => {
    if (this.#settled) return
    throw new PluginHostError(
      PluginHostErrorCode.disposeStepTimeout,
      ERROR_TEXT.DISPOSE_STEP_TIMEOUT(
        this.#phase,
        this.#options.disposeStepTimeoutMs === false
          ? Math.max(0, (this.#policy?.cleanupDeadlineAt ?? 0) - this.#options.scheduler.now())
          : this.#options.disposeStepTimeoutMs
      )
    )
  }
}

/**
 * Matches returned cleanup entries in O(1) per identity lookup. Each original error owns at most
 * three intrusive-list entries, removed together after a match; aggregate children reserve list
 * entries without mutation until every child has matched.
 */
class ReturnedErrorMatcher {
  /** Direct and wrapper-cause matches share one ordered bucket per matching identity. */
  readonly #byMatch = new Map<unknown, IReturnedErrorBucket>()
  /** Aggregate children match only exact returned identities, never a wrapper's cause. */
  readonly #byIdentity = new Map<unknown, IReturnedErrorBucket>()
  /** Each returned error owns at most three list memberships, released together on consumption. */
  readonly #memberships: IReturnedErrorEntry[][]

  /** Builds all identity indexes once, preserving original error order within every bucket. */
  constructor(errors: readonly unknown[]) {
    this.#memberships = Array.from({ length: errors.length }, () => [])
    for (let index = 0; index < errors.length; index += 1) {
      /** Original identity and an optional package wrapper cause are the only direct match keys. */
      const error = errors[index]
      this.#append(this.#byMatch, error, index)
      this.#append(this.#byIdentity, error, index)
      if (error instanceof PluginHostError && error.cause !== error)
        this.#append(this.#byMatch, error.cause, index)
    }
  }

  /** Appends one membership without scanning or copying a growable bucket. */
  #append(map: Map<unknown, IReturnedErrorBucket>, key: unknown, index: number): void {
    /** Existing bucket retains all still-unmatched errors for this identity. */
    let bucket = map.get(key)
    if (!bucket) {
      bucket = { first: undefined, last: undefined }
      map.set(key, bucket)
    }
    /** Previous and next links make removal constant-time from every identity index. */
    const entry: IReturnedErrorEntry = { index, bucket, previous: bucket.last, next: undefined }
    if (bucket.last) bucket.last.next = entry
    else bucket.first = entry
    bucket.last = entry
    this.#memberships[index]!.push(entry)
  }

  /** Removes all membership links for one consumed error; the per-error bound is three entries. */
  #consume(index: number): void {
    // The constructor inserts one direct key, one identity key and at most one cause key.
    for (const entry of this.#memberships[index]!) {
      if (entry.previous) entry.previous.next = entry.next
      else entry.bucket.first = entry.next
      if (entry.next) entry.next.previous = entry.previous
      else entry.bucket.last = entry.previous
    }
    this.#memberships[index] = []
  }

  /** Consumes the first returned error matching an entry directly or through its wrapper cause. */
  take(value: unknown): boolean {
    /** Only a live bucket head can match, so repeated identities never rescan consumed prefixes. */
    const entry = this.#byMatch.get(value)?.first
    if (!entry) return false
    this.#consume(entry.index)
    return true
  }

  /** Consumes one exact returned error per child only after all children have matched. */
  takeAll(children: readonly unknown[]): boolean {
    /** Tentative heads preserve atomic matching when a later aggregate child is absent. */
    const positions = new Map<IReturnedErrorBucket, IReturnedErrorEntry | undefined>()
    /** Each child reserves one distinct returned-error index in its own identity bucket. */
    const reserved: number[] = []
    for (const child of children) {
      /** Identity lookup remains constant-time for duplicate children as well as distinct values. */
      const bucket = this.#byIdentity.get(child)
      if (!bucket) return false
      /** A stored undefined marks exhaustion and must not fall back to the bucket's real head. */
      const entry = positions.has(bucket) ? positions.get(bucket) : bucket.first
      if (!entry) return false
      positions.set(bucket, entry.next)
      reserved.push(entry.index)
    }
    for (const index of reserved) this.#consume(index)
    return true
  }
}
