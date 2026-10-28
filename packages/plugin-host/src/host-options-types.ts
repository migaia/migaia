/**
 * Defines Host construction budgets and diagnostic/error detail contracts. It performs no admission
 * or error construction.
 */
import type { IPluginHostErrorCode } from './error-code.js'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IPipelineDefinitions } from './pipeline-spec.js'
import type { IMiddlewarePipelineMode } from '@migaia/middleware-pipeline'

/**
 * Structured install-failure detail. Synchronous installation publishes an immutable snapshot; its
 * completion resolves to the final immutable rollback detail without mutating the published error,
 * so a translator can await cleanup deterministically.
 */
export type IPluginInstallFailureDetail = {
  /** Plugin whose construction or publication failed, even when earlier batch members roll back. */
  readonly failedName: string
  /** Original secondary rollback failures in release order; they do not replace the primary cause. */
  readonly rollbackErrors: readonly unknown[]
  /** Present on synchronous failure snapshots when rollback must finish asynchronously. */
  readonly completion?: Promise<IPluginInstallFailureDetail>
}

/**
 * Host diagnostic outlet. `message` stays the human-readable line; `error`, when present, is the
 * exact contained error object so reporters can walk its `cause`/`errors` chain instead of parsing
 * text. Reporter failures are contained by the Host and never replace the reported primary.
 */
export type IPluginHostDiagnostic = (
  message: string,
  code?: IPluginHostErrorCode,
  error?: unknown
) => void

/** Selects the Host runner once at construction; each registered stage must be liftable to it. */
export type IPipelineConfig = {
  /** Defaults to sync; accepts sync, async, generator or async-generator. */
  mode?: IMiddlewarePipelineMode
}

/** Host execution, scheduling and diagnostics admitted once by the canonical runtime constructor. */
export type IPluginHostOptions<TPipelines extends IPipelineDefinitions = Record<never, never>> = {
  /** Optional human-readable Host identity label; uniqueness is supplied by the runtime id. */
  readonly identity?: Readonly<{
    /** Defaults to DEFAULT; a supplied label must be a nonempty string and need not be unique. */
    readonly name?: string
  }>
  /** Operation and pipeline drain budgets; each defaults to 5000 ms, `false` waits unbounded. */
  readonly execution?: {
    /**
     * Maximum time for one admitted install, update, or removal hook. Defaults to 5000 ms; `false`
     * waits without a deadline. Numeric values must be finite and nonnegative.
     */
    readonly mutationTimeoutMs?: number | false
    /**
     * Maximum time to drain active pipeline leases before logical removal continues. Defaults to
     * 5000 ms; `false` waits until zero. Numeric values must be finite and nonnegative.
     */
    readonly pipelineDrainTimeoutMs?: number | false
  }
  /** Optional runner configuration; omission selects mode sync. */
  pipeline?: IPipelineConfig
  /** Optional immutable named declarations; absence creates no additional execution resources. */
  readonly pipelines?: TPipelines
  /** Defaults to a no-op; contains cleanup, late rejection and queue-wait observations. */
  diagnostic?: IPluginHostDiagnostic
  /**
   * Terminal sink for failures of `diagnostic` itself (it threw or rejected). Receives the exact
   * failure object; when absent, or when it throws too, the failure goes to the runtime's
   * `globalThis.reportError` if one exists. Never affects Host control flow.
   */
  onDiagnosticFailure?: (error: unknown) => void
  /**
   * Clock and scheduling source shared by the queue watchdog and disposal timeouts. Defaults to
   * systemScheduler from the shared scheduler package.
   */
  scheduler?: IScheduler
  /**
   * Admission wait limit. `undefined` reports without rejecting; `false` disables timers, reports,
   * and rejection; a number rejects and removes timed-out work.
   */
  queueAdmissionTimeoutMs?: number | false
  /**
   * Diagnostic wait threshold when `queueAdmissionTimeoutMs` is omitted. `false` disables its
   * timer. Defaults to 1000 milliseconds; an explicit admission timeout takes precedence.
   */
  queueAdmissionDiagnosticMs?: number | false
  /**
   * Maximum wait for one disposal step. `false` waits indefinitely without triggering forced
   * release. Defaults to 5000 milliseconds and never forcibly interrupts running JavaScript.
   */
  disposeStepTimeoutMs?: number | false
}
