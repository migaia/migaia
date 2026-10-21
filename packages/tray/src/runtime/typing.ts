import type { TrayShutdownMode } from '../state-constants.js'
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type { IExtractPluginExt, IPluginConstraint } from '@migaia/plugin-host'
import type {
  ITrayHostSource,
  ITrayPluginAdmission,
  ITrayPluginConstraint
} from '../host/typing.js'

/** Resolves exact extension types for literal ready plugin names and stays unknown when widened. */
export type IRuntimeExtensionsFor<
  TReady extends readonly IPluginConstraint<any>[],
  TName extends string
> = string extends TName
  ? Readonly<Record<PropertyKey, unknown>>
  : [Extract<TReady[number], { readonly name: TName }>] extends [never]
    ? Readonly<Record<PropertyKey, unknown>>
    : IExtractPluginExt<Extract<TReady[number], { readonly name: TName }>>

/** Context exposed to one callback with an exact plugin-generation extension snapshot. */
export type IRuntimeRunContext<
  TExtensions = Readonly<Record<PropertyKey, unknown>>,
  THost extends ITrayHostSource = ITrayHostSource,
  TReady extends readonly IPluginConstraint<any>[] = readonly IPluginConstraint<any>[]
> = Readonly<{
  /** Monotonic identifier within this Runtime, including synchronous callback failures. */
  readonly runId: number
  /** Target plugin name used to acquire this exact ready generation. */
  readonly plugin: string
  /** This registration's extension snapshot, without unrelated Host extensions. */
  readonly extensions: TExtensions
  /** Cooperative caller, deadline or Runtime shutdown notification; settlement still owns the lease. */
  readonly signal: INativeAbortSignal
  /** Scheduler-clock deadline, or undefined when timeoutMs is false. */
  readonly deadlineAt: number | undefined
  /** Deferred mutations bound to this run's exact generation rather than a later same-name plugin. */
  readonly self: IRuntimeSelfMutation<THost, TReady>
}>

/** Non-thenable receipt for a mutation scheduled after its originating callback settles. */
export type IRuntimeSelfMutationTicket<TResult = unknown> = Readonly<{
  /**
   * Read after awaiting run(): resolves with canonical Host mutation completion. Reading inside the
   * callback returns a rejected Promise with RUNTIME_CONTRACT_INVALID instead of deadlocking a
   * lease.
   */
  readonly completion: Promise<TResult>
}>

/** Runtime-neutral self-mutation capability bound to the current callback generation. */
export type IRuntimeSelfMutation<
  THost extends ITrayHostSource = ITrayHostSource,
  TReady extends readonly IPluginConstraint<any>[] = readonly IPluginConstraint<any>[]
> = Readonly<{
  /** Schedules removal of the callback's exact plugin generation after settlement. */
  readonly unUse: () => IRuntimeSelfMutationTicket
  /** Schedules replacement of the callback's exact plugin generation after settlement. */
  replace<const TPlugin extends ITrayPluginConstraint<THost>>(
    plugin: TPlugin & ITrayPluginAdmission<THost, readonly [TPlugin], TReady>[0]
  ): IRuntimeSelfMutationTicket
}>

/** Caller cancellation and callback admission deadline. */
export type IRuntimeRunOptions = Readonly<{
  /** Optional caller signal; cancellation aborts the context signal without forcing rejection. */
  readonly signal?: IAbortSignal
  /** Required finite nonnegative deadline delay, or false to disable its timer; no implicit default. */
  readonly timeoutMs: number | false
}>

/** Runtime mode only: strict waits for callback settlement, bounded returns without waiting. */
export type IRuntimeShutdownOptions = Readonly<{
  /**
   * Strict-drain waits for real callback settlement; bounded returns a physical-completion
   * snapshot.
   */
  readonly mode: TrayShutdownMode
}>

/** Physical runtime disposal observation. */
export type IRuntimeDisposalResult = Readonly<{
  /** Admission has ended even if cooperative callbacks are still running. */
  readonly state: 'terminal'
  /** Whether all active callbacks had settled when this result was produced. */
  readonly cleanupComplete: boolean
}>

/** Public Runtime lifecycle and exact-generation execution surface. */
export type IRuntime<
  TReady extends readonly IPluginConstraint<any>[] = readonly IPluginConstraint<any>[],
  THost extends ITrayHostSource = ITrayHostSource
> = Readonly<{
  /** Active accepts runs, closing rejects new runs, and terminal ends Runtime observation. */
  readonly state: 'active' | 'closing' | 'terminal'
  /** Admitted callbacks whose exact-generation leases have not yet been released. */
  readonly activeRuns: number
  /**
   * Acquires one ready plugin generation and returns the callback's settled value. Callback
   * failures use RUNTIME_EXECUTION_FAILED unless already classified; cancellation alone does not
   * settle it.
   */
  run<TName extends string, TResult>(
    name: TName,
    options: IRuntimeRunOptions,
    execute: (
      context: IRuntimeRunContext<IRuntimeExtensionsFor<TReady, TName>, THost, TReady>
    ) => TResult | PromiseLike<TResult>
  ): Promise<TResult>
  /**
   * Aborts active signals and shares one shutdown Promise; never disposes the borrowed managed
   * Host.
   */
  dispose(): Promise<IRuntimeDisposalResult>
  /** Awaits dispose() and discards its observation result. */
  readonly [Symbol.asyncDispose]: () => Promise<void>
}>
