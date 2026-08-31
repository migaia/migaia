import type { IAbortSignal } from '@migaia/lifecycle'
import type { IExtractPluginExt, IPluginConstraint } from '@migaia/plugin-host'

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
export type IRuntimeRunContext<TExtensions = Readonly<Record<PropertyKey, unknown>>> = Readonly<{
  readonly runId: number
  readonly plugin: string
  readonly extensions: TExtensions
  readonly signal: IAbortSignal
  readonly deadlineAt: number | undefined
  readonly self: IRuntimeSelfMutation
}>

/** Deferred exact-generation mutation result exposed by a Runtime callback. */
export type IRuntimeSelfMutationTicket<TResult = unknown> = Readonly<{
  /** Resolves only after callback settlement and canonical Host mutation completion. */
  readonly completion: Promise<TResult>
}>

/** Runtime-neutral self-mutation capability bound to the current callback generation. */
export type IRuntimeSelfMutation = Readonly<{
  /** Schedules removal of the callback's exact plugin generation after settlement. */
  readonly unUse: () => IRuntimeSelfMutationTicket
  /** Schedules replacement of the callback's exact plugin generation after settlement. */
  readonly replace: (plugin: IPluginConstraint<any>) => IRuntimeSelfMutationTicket
}>

/** Caller cancellation and callback admission deadline. */
export type IRuntimeRunOptions = Readonly<{
  readonly signal?: IAbortSignal
  readonly timeoutMs: number | false
}>

/** Runtime shutdown policy. */
export type IRuntimeShutdownOptions = Readonly<{
  readonly mode: 'bounded' | 'strict-drain'
  readonly quiescenceMs?: number
}>

/** Physical runtime disposal observation. */
export type IRuntimeDisposalResult = Readonly<{
  readonly state: 'terminal'
  readonly cleanupComplete: boolean
}>

/** Public Runtime lifecycle and exact-generation execution surface. */
export type IRuntime<
  TReady extends readonly IPluginConstraint<any>[] = readonly IPluginConstraint<any>[]
> = Readonly<{
  readonly state: 'active' | 'closing' | 'terminal'
  readonly activeRuns: number
  run<TName extends string, TResult>(
    name: TName,
    options: IRuntimeRunOptions,
    execute: (
      context: IRuntimeRunContext<IRuntimeExtensionsFor<TReady, TName>>
    ) => TResult | PromiseLike<TResult>
  ): Promise<TResult>
  dispose(): Promise<IRuntimeDisposalResult>
  readonly [Symbol.asyncDispose]: () => Promise<void>
}>
