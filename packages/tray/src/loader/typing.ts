import type { IAbortSignal, IReleaseDescriptor } from '@migaia/lifecycle'
import type { IAdapter } from '../adapter/typing.js'
import type { ITrayHost, ITrayPluginConstraint, ITrayPluginMutationResult } from '../host/typing.js'
import type { PluginHost } from '@migaia/plugin-host'

/** Artifact plus its explicit lifecycle release contract. */
export type ILoadedArtifact<TArtifact> = Readonly<{
  readonly value: TArtifact
  readonly release: IReleaseDescriptor
}>

/** Runtime-neutral input context for one loader admission. */
export type ILoaderContext = Readonly<{
  readonly signal: IAbortSignal
  readonly deadlineAt: number | undefined
  readonly report: (error: unknown) => void
}>

/** One-shot source-to-artifact loader contract. */
export type ILoader<TSource, TArtifact> = Readonly<{
  readonly load: (
    source: TSource,
    context: ILoaderContext
  ) => ILoadedArtifact<TArtifact> | PromiseLike<ILoadedArtifact<TArtifact>>
}>

/** Atomic Loader to Adapter to managed Host transaction options. */
export type ILoadIntoHostOptions<
  TSource,
  TArtifact,
  THost extends PluginHost<any, any, any>,
  TPlugin extends ITrayPluginConstraint<THost>
> = Readonly<{
  readonly host: ITrayHost<
    THost,
    readonly ITrayPluginConstraint<THost>[],
    readonly ITrayPluginConstraint<THost>[]
  >
  readonly source: TSource
  readonly loader: ILoader<TSource, TArtifact>
  readonly adapter: IAdapter<TArtifact, THost, TPlugin>
  readonly mutation: 'use' | 'replace'
  readonly signal?: IAbortSignal
  readonly timeoutMs: number | false
  readonly report?: (error: unknown) => void
}>

/** Result shape returned by the managed mutation after custody transfer. */
export type ILoadIntoHostResult = ITrayPluginMutationResult<unknown, unknown, unknown>
