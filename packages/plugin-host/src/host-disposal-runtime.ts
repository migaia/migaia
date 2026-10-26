import { deferred } from '@migaia/utils/promise'
import type { PluginHostState } from './host-state.js'
import { reportDiagnostic } from './diagnostic-report.js'
import {
  boundedWait,
  mergeCleanupResults,
  type ICleanupResult,
  type IAbortController,
  type IPendingTracker,
  type IQuiescenceTracker,
  type ITerminalController
} from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { IPluginHostDiagnostic, IPluginHostDisposalResult } from './typing.js'

type IPluginHostDisposalRuntimePort<TRegistration> = Readonly<{
  readonly terminal: ITerminalController
  readonly executionController: IAbortController
  readonly pipelineLeases: IQuiescenceTracker<object>
  readonly pending: IPendingTracker
  readonly pipelineKeys: () => readonly object[]
  readonly scheduler: IScheduler
  readonly pipelineDrainTimeoutMs: number | false
  readonly enqueueTerminal: <T>(task: () => Promise<T>) => Promise<T>
  readonly registrationsInReverse: () => readonly TRegistration[]
  readonly clearPipelineState: () => void
  readonly diagnostic: IPluginHostDiagnostic
  /** Terminal coordination advances the same revision owner as all other mutations. */
  readonly state: Pick<PluginHostState<object, unknown>, 'commit'>
  /** Opaque registrations need only the existing removal owner's two cleanup operations. */
  readonly removal: Readonly<{
    runBeforeRelease(registration: TRegistration): Promise<ICleanupResult> | undefined
    disposeRegistration(registration: TRegistration): Promise<ICleanupResult>
  }>
}>

/** Owns the Host's unique terminal promise and global physical-cleanup orchestration. */
export class PluginHostDisposalRuntime<TRegistration> {
  /** Exact Host lifecycle authorities required by the terminal transaction. */
  readonly #port: IPluginHostDisposalRuntimePort<TRegistration>
  /** Stable identity returned by every repeated dispose call. */
  #promise: Promise<IPluginHostDisposalResult> | undefined

  constructor(port: IPluginHostDisposalRuntimePort<TRegistration>) {
    this.#port = port
  }

  /** Default-only hosts retain the original drain Promise and its revocation microtask ordering. */
  #whenPipelineZero(): Promise<unknown> {
    /** Construction fixes the key set before any execution or disposal can begin. */
    const keys = this.#port.pipelineKeys()
    return keys.length === 1
      ? this.#port.pipelineLeases.whenZero(keys[0]!)
      : Promise.all(keys.map((key) => this.#port.pipelineLeases.whenZero(key)))
  }

  /** Starts logical terminal transition once and returns its stable physical result promise. */
  dispose(): Promise<IPluginHostDisposalResult> {
    if (this.#promise) return this.#promise
    /** Publish before terminal/abort notifications can reenter the same runtime. */
    const completion = deferred<IPluginHostDisposalResult>()
    this.#promise = completion.promise
    try {
      this.#port.terminal.close()
      for (const key of this.#port.pipelineKeys()) this.#port.pipelineLeases.seal(key)
      // A native abort never throws: listener failures go to the host's own error reporting.
      this.#port.executionController.abort(
        new PluginHostError(PluginHostErrorCode.hostDisposing, ERROR_TEXT.HOST_DISPOSING)
      )
      /** The existing terminal queue still owns every physical cleanup step. */
      const pending = this.#port.enqueueTerminal(async () => {
        const errors: unknown[] = []
        /** Only continuations belong to physical completion; current errors are already returned. */
        const physical: Promise<ICleanupResult>[] = []
        const drained =
          this.#port.pipelineDrainTimeoutMs === false
            ? await this.#whenPipelineZero().then(() => true)
            : await boundedWait(
                this.#whenPipelineZero(),
                this.#port.scheduler.now() + this.#port.pipelineDrainTimeoutMs,
                { scheduler: this.#port.scheduler }
              )
        if (!drained)
          errors.push(
            new PluginHostError(
              PluginHostErrorCode.pipelineDrainTimeout,
              ERROR_TEXT.PIPELINE_DRAIN_TIMEOUT(this.#port.pipelineDrainTimeoutMs as number)
            )
          )
        for (const registration of this.#port.registrationsInReverse()) {
          const beforeRelease = this.#port.removal.runBeforeRelease(registration)
          if (beforeRelease) {
            const result = await beforeRelease
            errors.push(...result.cleanupErrors)
            if (result.physicalCompletion) physical.push(result.physicalCompletion)
          }
          const result = await this.#port.removal.disposeRegistration(registration)
          errors.push(...result.cleanupErrors)
          if (result.physicalCompletion) physical.push(result.physicalCompletion)
        }
        this.#port.clearPipelineState()
        this.#port.terminal.forceTerminal()
        this.#port.state.commit()
        for (const error of errors) {
          reportDiagnostic(
            this.#port.diagnostic,
            error instanceof Error ? error.message : String(error),
            PluginHostErrorCode.cleanupIncomplete,
            error
          )
        }
        const cleanupComplete = drained && this.#port.pending.size === 0 && physical.length === 0
        const physicalCompletion = cleanupComplete
          ? undefined
          : mergeCleanupResults([
              ...physical,
              Promise.all([this.#port.pending.drain(), this.#whenPipelineZero()]).then(() => ({
                cleanupErrors: []
              }))
            ])
        return Object.freeze({
          logicalTerminal: true,
          cleanupComplete,
          cleanupErrors: Object.freeze([...errors]),
          ...(physicalCompletion ? { physicalCompletion } : {})
        })
      })
      void pending.then(completion.resolve, completion.reject)
    } catch (error) {
      completion.reject(error)
    }
    return this.#promise
  }
}
