import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type { IReleaseDescriptor } from '@migaia/lifecycle'
import type { IAdapter } from '../adapter/typing.ts'
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
} from '../host/typing.ts'

/** Artifact plus its explicit lifecycle release contract. */
export type ILoadedArtifact<TArtifact> = Readonly<{
  /** Acquired external value passed unchanged to the adapter. */
  readonly value: TArtifact
  /** Explicit lifecycle descriptor; force is required, and custody transfers only on commit. */
  readonly release: IReleaseDescriptor
}>

/** Runtime-neutral input context for one loader admission. */
export type ILoaderContext = Readonly<{
  /** Cooperative admission signal, later aborted when its generation-owned scope ends. */
  readonly signal: INativeAbortSignal
  /** Scheduler-clock deadline, or undefined for timeoutMs: false. */
  readonly deadlineAt: number | undefined
  /** Reports secondary diagnostics without replacing the primary transaction result. */
  readonly report: (error: unknown) => void
}>

/** One-shot source-to-artifact loader contract. */
export type ILoader<TSource, TArtifact> = Readonly<{
  /** Acquires a complete value/release pair; partial acquisition before return remains loader-owned. */
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
  /** Existing managed facade receiving the converted plugin; no second Host is constructed. */
  readonly host: TManagedHost &
    Pick<
      ITrayHost<
        ITrayHostSourceOf<NoInfer<TManagedHost>>,
        ITrayHostDefinitions<NoInfer<TManagedHost>>,
        ITrayHostReadyPlugins<NoInfer<TManagedHost>>
      >,
      'use' | 'replace'
    >
  /** Loader-specific input forwarded unchanged to the captured load method. */
  readonly source: TSource
  /** Acquires the artifact before conversion and managed mutation. */
  readonly loader: ILoader<TSource, TArtifact>
  /** Converts the acquired artifact into one compatible plugin definition. */
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
  /** Required operation: use adds a definition, replace replaces the same-name generation. */
  readonly mutation: TMutation
  /** Optional caller cancellation while admission is pending; detached when this transaction ends. */
  readonly signal?: IAbortSignal
  /**
   * Required finite nonnegative admission timeout, or false for no timer; cancellation is
   * cooperative.
   */
  readonly timeoutMs: number | false
  /** Optional secondary diagnostic observer; its own throws do not replace the transaction result. */
  readonly report?: (error: unknown) => void
}>

/**
 * Managed mutation observation, retaining its typed view and cleanup fields. committed, rather than
 * ok or readiness, determines whether the definition generation owns artifact cleanup.
 */
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
