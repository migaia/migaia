import {
  boundedWait,
  type IAbortController,
  type ILifecycleScheduler,
  type IPendingTracker,
  type IQuiescenceTracker,
  type ITerminalController
} from '@migaia/lifecycle'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { IPluginHostDisposalResult, IPluginHostErrorCode } from './typing.js'

export type IPluginHostDisposalRuntimePort<TRegistration> = Readonly<{
  readonly terminal: ITerminalController
  readonly executionController: IAbortController
  readonly pipelineLeases: IQuiescenceTracker<object>
  readonly pending: IPendingTracker
  readonly pipelineKey: object
  readonly scheduler: ILifecycleScheduler
  readonly pipelineDrainTimeoutMs: number | false
  readonly enqueueTerminal: <T>(task: () => Promise<T>) => Promise<T>
  readonly registrationsInReverse: () => readonly TRegistration[]
  readonly disposeRegistration: (registration: TRegistration) => Promise<unknown[]>
  readonly clearPipelineState: () => void
  readonly resetCleanupAbandoned: () => void
  readonly isCleanupAbandoned: () => boolean
  readonly commitRevision: () => void
  readonly diagnostic: (message: string, code?: IPluginHostErrorCode) => void
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

  /** Starts logical terminal transition once and returns its stable physical result promise. */
  dispose(): Promise<IPluginHostDisposalResult> {
    if (this.#promise) return this.#promise
    this.#port.terminal.close()
    this.#port.resetCleanupAbandoned()
    this.#port.pipelineLeases.seal(this.#port.pipelineKey)
    try {
      this.#port.executionController.abort(
        new PluginHostError(PluginHostErrorCode.hostDisposing, ERROR_TEXT.HOST_DISPOSING)
      )
    } catch {
      try {
        this.#port.diagnostic(ERROR_TEXT.HOST_DISPOSING, PluginHostErrorCode.hostDisposing)
      } catch {
        // Diagnostics cannot alter terminal authority.
      }
    }
    this.#promise = this.#port.enqueueTerminal(async () => {
      const errors: unknown[] = []
      const drained =
        this.#port.pipelineDrainTimeoutMs === false
          ? await this.#port.pipelineLeases.whenZero(this.#port.pipelineKey).then(() => true)
          : await boundedWait(
              this.#port.pipelineLeases.whenZero(this.#port.pipelineKey),
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
      for (const registration of this.#port.registrationsInReverse())
        errors.push(...(await this.#port.disposeRegistration(registration)))
      this.#port.clearPipelineState()
      this.#port.terminal.forceTerminal()
      this.#port.commitRevision()
      for (const error of errors) {
        try {
          this.#port.diagnostic(
            error instanceof Error ? error.message : String(error),
            PluginHostErrorCode.cleanupIncomplete
          )
        } catch {
          // Diagnostics are report-only and cannot change terminal state.
        }
      }
      const cleanupComplete =
        drained && this.#port.pending.size === 0 && !this.#port.isCleanupAbandoned()
      const physicalCompletion = cleanupComplete
        ? undefined
        : Promise.all([
            this.#port.pending.drain(),
            this.#port.pipelineLeases.whenZero(this.#port.pipelineKey)
          ])
            .then(() => Object.freeze({ cleanupErrors: Object.freeze([]) }))
            .catch((error: unknown) => Object.freeze({ cleanupErrors: Object.freeze([error]) }))
      return Object.freeze({
        logicalTerminal: true,
        cleanupComplete,
        cleanupErrors: Object.freeze([...errors]),
        ...(physicalCompletion ? { physicalCompletion } : {})
      })
    })
    return this.#promise
  }
}
