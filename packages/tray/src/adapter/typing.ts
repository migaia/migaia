import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { ITrayHostSource, ITrayPluginConstraint } from '../host/typing.js'

/** Runtime-neutral context supplied during one pure artifact conversion. */
export type IAdapterContext = Readonly<{
  /** Cooperative transaction cancellation; the adapter must observe it to stop its own work. */
  readonly signal: INativeAbortSignal
  /** Scheduler-clock deadline, or undefined when the transaction uses timeoutMs: false. */
  readonly deadlineAt: number | undefined
}>

/** One-shot conversion contract from an external artifact to a canonical plugin. */
export type IAdapter<
  TArtifact,
  THost extends ITrayHostSource,
  TPlugin extends ITrayPluginConstraint<THost>
> = Readonly<{
  /** Converts one artifact without taking its cleanup ownership; loadIntoHost validates the plugin. */
  readonly adapt: (artifact: TArtifact, context: IAdapterContext) => TPlugin | PromiseLike<TPlugin>
}>
