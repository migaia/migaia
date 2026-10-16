import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { ITrayHostSource, ITrayPluginConstraint } from '../host/typing.js'

/** Runtime-neutral context supplied during one pure artifact conversion. */
export type IAdapterContext = Readonly<{
  readonly signal: INativeAbortSignal
  readonly deadlineAt: number | undefined
}>

/** One-shot conversion contract from an external artifact to a canonical plugin. */
export type IAdapter<
  TArtifact,
  THost extends ITrayHostSource,
  TPlugin extends ITrayPluginConstraint<THost>
> = Readonly<{
  readonly adapt: (artifact: TArtifact, context: IAdapterContext) => TPlugin | PromiseLike<TPlugin>
}>
