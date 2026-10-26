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
    const timeoutMs = this.#options.disposeStepTimeoutMs
    /** Normalize a custom thenable once before both lifecycle and the ledger observe it. */
    const runObserved = (): void | PromiseLike<void> => {
      const result = run()
      if (!policy?.cleanupLedger) return result
      const probe = probeThenable(result)
      if (probe.kind === 'failed') throw probe.error
      if (probe.kind === 'not-thenable') return
      const pending = assimilateCapturedThen<void>(probe.thenFn, result)
      policy.cleanupLedger.start(phase, () => pending)
      return pending
    }
    let settled = false
    return {
      // own() validates without retaining the snapshot. At disposal the canonical scope reads
      // the registration's selected mode; custom bypasses the bounded graceful/force chain.
      get custom() {
        return policy?.cleanupMode === PluginHostCleanupMode.unbounded ||
          (timeoutMs === false && policy?.cleanupDeadlineAt === undefined)
          ? runObserved
          : undefined
      },
      graceful: async () => {
        const pending = Promise.resolve().then(async () => {
          await run()
        })
        policy?.cleanupLedger?.start(phase, () => pending)
        try {
          await this.#options.pending.track(pending)
        } finally {
          settled = true
        }
      },
      gracefulTimeoutMs: timeoutMs === false ? undefined : timeoutMs,
      force: () => {
        if (settled) return
        throw new PluginHostError(
          PluginHostErrorCode.disposeStepTimeout,
          ERROR_TEXT.DISPOSE_STEP_TIMEOUT(
            phase,
            timeoutMs === false
              ? Math.max(0, (policy?.cleanupDeadlineAt ?? 0) - this.#options.scheduler.now())
              : timeoutMs
          )
        )
      }
    }
  }

  /** Disposes one ordered function group and optionally preserves exact rejection identities. */
  async disposeGroup(
    disposers: readonly (() => void | PromiseLike<void>)[],
    phase: string,
    preserveErrorIdentity = false,
    policy?: IPluginHostCleanupPolicy
  ): Promise<unknown[]> {
    if (disposers.length === 0) return []
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
    const pending = ledger.pending > 0
    const outcome = ledger.seal()
    /**
     * A timed-out callback can reject before the whole plan seals. Match each logical failure once
     * so that such a late rejection is retained without repeating an already returned error.
     */
    const matcher = new ReturnedErrorMatcher(errors)
    const newlyObserved = outcome.cleanupErrors.filter((entry) => {
      if (matcher.take(entry.error)) return false
      /** Provisional rollback already exposes an aggregate's children as individual failures. */
      if (entry.error instanceof AggregateError) return !matcher.takeAll(entry.error.errors)
      return true
    })
    const additionalErrors = this.#wrapCollected(newlyObserved, undefined, preserveErrorIdentity)
    const physicalCompletion = pending
      ? outcome.physicalCompletion.then((result) => {
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

/**
 * Matches returned errors against late cleanup entries in O(1) per lookup. Each returned error is
 * consumed at most once, in its original order, matching either the entry itself or, for a package
 * wrapper, the wrapper's cause.
 */
class ReturnedErrorMatcher {
  /** Indexes of returned errors, keyed by the value an entry can match: the error or its cause. */
  readonly #byMatch = new Map<unknown, number[]>()
  /** Indexes of returned errors keyed by their own identity, for aggregate-child matching. */
  readonly #byIdentity = new Map<unknown, number[]>()
  /** Whether each returned error has already been matched. */
  readonly #consumed: boolean[]

  /** Indexes the returned errors once. */
  constructor(errors: readonly unknown[]) {
    this.#consumed = Array.from({ length: errors.length }, () => false)
    for (let index = 0; index < errors.length; index += 1) {
      const error = errors[index]
      ReturnedErrorMatcher.#append(this.#byMatch, error, index)
      ReturnedErrorMatcher.#append(this.#byIdentity, error, index)
      if (error instanceof PluginHostError && error.cause !== error)
        ReturnedErrorMatcher.#append(this.#byMatch, error.cause, index)
    }
  }

  /** Adds one index under a key, keeping each list in ascending order. */
  static #append(map: Map<unknown, number[]>, key: unknown, index: number): void {
    const list = map.get(key)
    if (list) list.push(index)
    else map.set(key, [index])
  }

  /** First unconsumed index in a list, or -1. */
  #first(list: readonly number[] | undefined, skip?: ReadonlySet<number>): number {
    if (!list) return -1
    for (const index of list) if (!this.#consumed[index] && !skip?.has(index)) return index
    return -1
  }

  /** Consumes the first returned error that matches this entry directly or as a wrapper cause. */
  take(entry: unknown): boolean {
    const index = this.#first(this.#byMatch.get(entry))
    if (index < 0) return false
    this.#consumed[index] = true
    return true
  }

  /** Consumes one returned error per child only when every child is present by identity. */
  takeAll(children: readonly unknown[]): boolean {
    /** Indexes reserved for earlier children of this same aggregate. */
    const reserved = new Set<number>()
    for (const child of children) {
      const index = this.#first(this.#byIdentity.get(child), reserved)
      if (index < 0) return false
      reserved.add(index)
    }
    for (const index of reserved) this.#consumed[index] = true
    return true
  }
}
