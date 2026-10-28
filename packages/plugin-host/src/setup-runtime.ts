/**
 * Owns one setup attempt, its resource admission and abort subscriptions; publication stays in
 * install.
 */
import { observeAbortSubscription } from '@migaia/lifecycle/abort'
import { resolveDisposer } from './disposal.ts'
import { reportDiagnostic } from './diagnostic-report.ts'
import { PluginHostErrorCode } from './error-code.ts'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.ts'
import { invokeCaptured } from './invocation.ts'
import type { IInstallBatchContext } from './install-runtime.ts'
import type { PluginHostOperationRuntime } from './operation-runtime.ts'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { createAbortController, type IAbortController } from '@migaia/lifecycle/abort'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRegistration } from './registry.ts'
import type { IPluginHostCore } from './plugin-core-types.ts'
import type { IPluginHostDiagnostic } from './host-options-types.ts'
import type { IPluginResource, IPluginSetupContext } from './plugin-lifecycle-types.ts'

/** Host authority needed by setup; the registration remains owned by its install transaction. */
export type IPluginSetupPort<TDomainCore extends object, TValue> = Readonly<{
  /** Marks only the synchronous setup invocation, leaving async continuations unmarked. */
  readonly invokeHook: <T>(invoke: () => T) => T
  readonly createCore: (
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>
  ) => IPluginHostCore<TValue>
  readonly executionSignal: INativeAbortSignal
  readonly scheduler: IScheduler
  readonly setSetupPending: (registration: IRegistration<any, any> | undefined) => void
  readonly diagnostic: IPluginHostDiagnostic
  /** Setup shares the installation's generation owner instead of copying unbound methods. */
  readonly operations: Pick<PluginHostOperationRuntime, 'await' | 'assertCurrent'>
}>

/** Exact attempt lifetime retained by contexts that may outlive the registration. */
export type IPluginSetupAttempt = {
  open: boolean
  readonly controller: IAbortController
}

/** Closes setup resource admission before rollback or after installation commits. */
export function closeSetupAttempt(registration: IRegistration<any, any>): void {
  if (registration.setupAttempt) registration.setupAttempt.open = false
}

/** Runs the exact setup race with explicit ownership of every subscription and pending rejection. */
export class PluginHostSetupAttempt<TDomainCore extends object, TValue> {
  /** Registration whose operation and provisional scope admit this attempt's resources. */
  readonly #registration: IRegistration<TDomainCore, TValue>
  /** Host authority shared with the installation that owns this attempt. */
  readonly #port: IPluginSetupPort<TDomainCore, TValue>
  /** Candidate lookup context remains fixed for the lifetime of this attempt. */
  readonly #batch: IInstallBatchContext<TDomainCore, TValue>
  /** Narrow attempt lifetime is also retained by contexts used after setup settles. */
  #attempt!: IPluginSetupAttempt
  /** Original rejection identifies setup failure separately from timeout and disposal. */
  #ownRejection: { readonly error: unknown } | undefined
  /** Attempt abort listener exists only while setup is pending. */
  #attemptSubscription: ReturnType<typeof observeAbortSubscription> | undefined
  /** Core is constructed under run's asynchronous boundary, before setup is invoked. */
  #core!: IPluginHostCore<TValue>

  /** Captures setup authority; run retains the original rejection boundary for construction errors. */
  constructor(
    registration: IRegistration<TDomainCore, TValue>,
    port: IPluginSetupPort<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>
  ) {
    this.#registration = registration
    this.#port = port
    this.#batch = batch
  }

  /** Reports invalid observation without replacing the original setup or abort failure. */
  #reportObservationFailure(error: unknown): void {
    reportDiagnostic(
      this.#port.diagnostic,
      ERROR_TEXT.INVALID_OPTION,
      PluginHostErrorCode.invalidOption,
      error
    )
  }

  /** A retained setup context releases late resources immediately, then rejects admission. */
  #onDispose(resource: IPluginResource): void {
    if (this.#attempt.open && this.#registration.provisional) return this.#core.onDispose(resource)
    this.#releaseLateResource(resource)
    throw new PluginHostError(
      PluginHostErrorCode.resourceOutsideInstall,
      ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
    )
  }

  /** Reports both synchronous and asynchronous failures from releasing a late resource. */
  #reportLateRelease(error: unknown): void {
    reportDiagnostic(
      this.#port.diagnostic,
      ERROR_TEXT.SETUP_LATE_RELEASE_FAILED(this.#registration.name),
      PluginHostErrorCode.pluginDisposeFailed,
      error
    )
  }

  /** Releases a resource rejected by setup admission without altering the original failure. */
  #releaseLateResource(resource: IPluginResource): void {
    /** Disposer is admitted once, preserving its receiver and native validation failure. */
    let disposer: ReturnType<typeof resolveDisposer>
    try {
      disposer = resolveDisposer(resource)
    } catch (cause) {
      throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
    }
    if (!disposer) throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_RESOURCE_DISPOSER)
    try {
      void Promise.resolve(disposer()).catch((error) => this.#reportLateRelease(error))
    } catch (error) {
      this.#reportLateRelease(error)
    }
  }

  /** Builds the same frozen own-property context used by synchronous and asynchronous setup hooks. */
  #createContext(): IPluginSetupContext {
    /** Context accessors remain own properties over the exact core created for this attempt. */
    const core = this.#core
    /** Shared operation view exposes the exact attempt signal and registration deadline. */
    const operation = Object.freeze({
      signal: this.#attempt.controller.signal,
      deadlineAt: this.#registration.operationDeadlineAt,
      now: () => this.#port.scheduler.now()
    })
    return Object.freeze({
      config: this.#core.config,
      operation,
      get lifecycle() {
        return core.lifecycle
      },
      onDispose: (resource: IPluginResource) => this.#onDispose(resource)
    })
  }

  /** Captures one aborted attempt without retaining the Promise resolver after subscription removal. */
  #subscribeAttemptAbort(reject: (reason: unknown) => void): void {
    this.#attemptSubscription = observeAbortSubscription(
      this.#attempt.controller.signal,
      (reason) => reject(reason),
      (error) => this.#reportObservationFailure(error)
    )
  }

  /** Reports only rejections arriving after timeout or disposal has already won this attempt. */
  #reportLateSettlement(pending: Promise<unknown>, primary: unknown): void {
    void pending.then(undefined, (error: unknown) => {
      if (error === primary || error === this.#attempt.controller.signal.reason) return
      reportDiagnostic(
        this.#port.diagnostic,
        ERROR_TEXT.SETUP_LATE_REJECTION(this.#registration.name),
        PluginHostErrorCode.pluginInstallFailed,
        error
      )
    })
  }

  /** Runs setup with unchanged await/race positions; finally removes both abort subscriptions. */
  async run(): Promise<unknown> {
    this.#core = this.#port.createCore(this.#registration, this.#batch)
    this.#attempt = { open: true, controller: createAbortController() }
    this.#registration.setupAttempt = this.#attempt
    /** Setup observes the same frozen context throughout this attempt. */
    const context = this.#createContext()
    /** Host abort is forwarded only until setup settles or abandons the attempt. */
    const disposeSubscription = observeAbortSubscription(
      this.#port.executionSignal,
      (reason) => this.#attempt.controller.abort(reason),
      (error) => this.#reportObservationFailure(error)
    )
    this.#port.setSetupPending(this.#registration)
    try {
      /** Original setup value is assimilated at the existing Promise boundary. */
      const pending = Promise.resolve(
        this.#port.invokeHook(() =>
          invokeCaptured(this.#registration.plugin.setup!, this.#registration.plugin.owner, [
            context
          ])
        )
      )
      /** Only setup's own rejection may bypass timeout/disposal handling. */
      const tracked = pending.then(undefined, (error: unknown) => {
        this.#ownRejection = { error }
        throw error
      })
      /** The attempt abort path is removed in finally, whether the race succeeds or fails. */
      const abandoned = new Promise<never>((_resolve, reject) =>
        this.#subscribeAttemptAbort(reject)
      )
      /** Output remains unmodified until operation-generation admission succeeds. */
      let output: unknown
      try {
        output = await this.#port.operations.await(
          Promise.race([tracked, abandoned]),
          this.#registration
        )
      } catch (error) {
        if (this.#ownRejection && this.#ownRejection.error === error) throw error
        /** Existing semantic codes distinguish abandonment from setup's own failure. */
        const code = error instanceof PluginHostError ? error.code : undefined
        if (code === PluginHostErrorCode.mutationExecutionTimeout)
          this.#attempt.controller.abort(error)
        if (
          code === PluginHostErrorCode.mutationExecutionTimeout ||
          code === PluginHostErrorCode.hostDisposing
        )
          this.#reportLateSettlement(pending, error)
        throw error
      }
      this.#port.operations.assertCurrent(this.#registration)
      return output
    } finally {
      this.#port.setSetupPending(undefined)
      this.#attemptSubscription?.unsubscribe()
      disposeSubscription.unsubscribe()
    }
  }
}
