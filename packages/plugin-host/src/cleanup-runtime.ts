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
    const unmatched = [...errors]
    const newlyObserved = outcome.cleanupErrors.filter((entry) => {
      const index = unmatched.findIndex(
        (error) =>
          error === entry.error || (error instanceof PluginHostError && error.cause === entry.error)
      )
      if (index >= 0) {
        unmatched.splice(index, 1)
        return false
      }
      /** Provisional rollback already exposes an aggregate's children as individual failures. */
      if (entry.error instanceof AggregateError) {
        const remaining = [...unmatched]
        for (const error of entry.error.errors) {
          const childIndex = remaining.indexOf(error)
          if (childIndex < 0) return true
          remaining.splice(childIndex, 1)
        }
        unmatched.splice(0, unmatched.length, ...remaining)
        return false
      }
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
