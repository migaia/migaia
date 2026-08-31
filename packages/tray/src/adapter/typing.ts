import type { IAbortSignal } from '@migaia/lifecycle'
import type { ITrayPluginConstraint } from '../host/typing.js'
import type { PluginHost } from '@migaia/plugin-host'

/** Runtime-neutral context supplied during one pure artifact conversion. */
export type IAdapterContext = Readonly<{
  readonly signal: IAbortSignal
  readonly deadlineAt: number | undefined
}>

/** One-shot conversion contract from an external artifact to a canonical plugin. */
export type IAdapter<
  TArtifact,
  THost extends PluginHost<any, any, any>,
  TPlugin extends ITrayPluginConstraint<THost>
> = Readonly<{
  readonly adapt: (artifact: TArtifact, context: IAdapterContext) => TPlugin | PromiseLike<TPlugin>
}>
