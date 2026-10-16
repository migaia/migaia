import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type { IReleaseDescriptor } from '@migaia/lifecycle'
import type { IAdapter } from '../adapter/typing.js'
import type {
  ITrayHost,
  ITrayHostSource,
  ITrayHostTypeInfo,
  ITrayHostDefinitions,
  ITrayHostReadyPlugins,
  ITrayHostSourceOf,
  ITrayPluginAdmission,
  ITrayPluginConstraint,
  ITrayHostMutationResult
} from '../host/typing.js'

/** Artifact plus its explicit lifecycle release contract. */
export type ILoadedArtifact<TArtifact> = Readonly<{
  readonly value: TArtifact
  readonly release: IReleaseDescriptor
}>

/** Runtime-neutral input context for one loader admission. */
export type ILoaderContext = Readonly<{
  readonly signal: INativeAbortSignal
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
  THost extends ITrayHostSource,
  TPlugin extends ITrayPluginConstraint<THost>,
  TManagedHost extends ITrayHostTypeInfo = ITrayHost<
    THost,
    readonly ITrayPluginConstraint<THost>[],
    readonly ITrayPluginConstraint<THost>[]
  >,
  TMutation extends 'use' | 'replace' = 'use' | 'replace'
> = Readonly<{
  readonly host: TManagedHost &
    Pick<
      ITrayHost<
        ITrayHostSourceOf<NoInfer<TManagedHost>>,
        ITrayHostDefinitions<NoInfer<TManagedHost>>,
        ITrayHostReadyPlugins<NoInfer<TManagedHost>>
      >,
      'use' | 'replace'
    >
  readonly source: TSource
  readonly loader: ILoader<TSource, TArtifact>
  readonly adapter: IAdapter<
    TArtifact,
    NoInfer<THost>,
    TPlugin &
      ITrayPluginAdmission<
        NoInfer<THost>,
        readonly [TPlugin],
        ITrayHostReadyPlugins<NoInfer<TManagedHost>>
      >[0]
  >
  readonly mutation: TMutation
  readonly signal?: IAbortSignal
  readonly timeoutMs: number | false
  readonly report?: (error: unknown) => void
}>

/** Result shape returned by the managed mutation after custody transfer. */
export type ILoadIntoHostResult<
  THost extends ITrayHostTypeInfo = ITrayHostTypeInfo,
  TPlugin extends ITrayPluginConstraint<ITrayHostSourceOf<THost>> = ITrayPluginConstraint<
    ITrayHostSourceOf<THost>
  >,
  TMutation extends 'use' | 'replace' = 'use' | 'replace'
> = ITrayHostMutationResult<
  ITrayHostSourceOf<THost>,
  ITrayHostDefinitions<THost>,
  ITrayHostReadyPlugins<THost>,
  TPlugin,
  TMutation
>
