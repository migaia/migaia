import {
  createLifecycleScope,
  type ILifecycleScheduler,
  type IPendingTracker,
  type IReleaseDescriptor
} from '@migaia/lifecycle'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'

/** Stable kinds for structured nodes emitted by PluginHost disposal producers. */
export const PluginHostDisposalNodeKind = Object.freeze({
  hostError: 'host-error',
  aggregate: 'aggregate',
  disposerWrapper: 'disposer-wrapper'
} as const)

export type IPluginHostDisposalNodeKind =
  (typeof PluginHostDisposalNodeKind)[keyof typeof PluginHostDisposalNodeKind]

/** Frozen provenance detail stored only in the private producer registry. */
export type IPluginHostDisposalProvenance = Readonly<{
  readonly kind: IPluginHostDisposalNodeKind
  readonly phase?: string
}>

export type IPluginHostCleanupRuntimeOptions = Readonly<{
  readonly scheduler: ILifecycleScheduler
  readonly pending: IPendingTracker
  readonly disposeStepTimeoutMs: number | false
  readonly markAbandoned: () => void
  readonly wrapDisposalError: (error: unknown, phase: string) => unknown
}>

/** Owns bounded disposer execution independently from Host mutation and publication state. */
export class PluginHostCleanupRuntime {
  /** Immutable scheduler, tracker, and timeout policy installed by the owning Host. */
  readonly #options: IPluginHostCleanupRuntimeOptions

  constructor(options: IPluginHostCleanupRuntimeOptions) {
    this.#options = options
  }

  /** Builds one lifecycle release descriptor with the Host's timeout and abandonment policy. */
  createStepDescriptor(
    phase: string,
    run: () => void | PromiseLike<void>,
    observer?: IPendingTracker
  ): IReleaseDescriptor {
    const timeoutMs = this.#options.disposeStepTimeoutMs
    if (timeoutMs === false)
      return {
        graceful: () => {
          const result = run()
          if (result && typeof (result as PromiseLike<void>).then === 'function')
            void observer?.track(Promise.resolve(result))
          return result
        },
        force: () => {}
      }
    let settled = false
    return {
      graceful: async () => {
        const pending = Promise.resolve().then(async () => {
          await run()
        })
        void observer?.track(pending)
        try {
          await this.#options.pending.track(pending)
        } finally {
          settled = true
        }
      },
      gracefulTimeoutMs: timeoutMs,
      force: () => {
        if (settled) return
        this.#options.markAbandoned()
        throw new PluginHostError(
          PluginHostErrorCode.disposeStepTimeout,
          ERROR_TEXT.DISPOSE_STEP_TIMEOUT(phase, timeoutMs)
        )
      }
    }
  }

  /** Disposes one ordered function group and optionally preserves exact rejection identities. */
  async disposeGroup(
    disposers: readonly (() => void | PromiseLike<void>)[],
    phase: string,
    preserveErrorIdentity = false,
    observer?: IPendingTracker
  ): Promise<unknown[]> {
    if (disposers.length === 0) return []
    const scope = createLifecycleScope({
      errorPolicy: 'collect',
      scheduler: this.#options.scheduler
    })
    for (const dispose of disposers)
      scope.own(dispose, this.createStepDescriptor(phase, dispose, observer))
    return this.#wrapCollected(await scope.dispose(), phase, preserveErrorIdentity)
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
    collected: readonly { readonly error: unknown }[],
    phase: string,
    preserveErrorIdentity: boolean
  ): unknown[] {
    return collected.map((entry) => {
      if (preserveErrorIdentity) return entry.error
      return this.#options.wrapDisposalError(entry.error, phase)
    })
  }
}
