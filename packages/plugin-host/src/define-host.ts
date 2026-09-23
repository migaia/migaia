import { PluginHost } from './host-runtime.js'
import { openComposition, registerManagedHost } from './composition-entry.js'
import { readDefinedPluginDefinition } from './define-plugin.js'
import type { PluginHostError } from './error-text.js'
import { issueHostIdentity, type IPluginHostIdentity } from './host-identity.js'
import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IMergePluginShared,
  IPipelineMode,
  IPluginConstraint,
  IPluginConstraintTuple,
  IPluginHostCore,
  IPluginHostDisposalResult,
  IPluginHostConfigFor,
  IPluginHostDynamicView,
  IPluginEnablement,
  IPluginHostOptions,
  IPluginHostView,
  IPluginRemovalResult,
  ISyncPipelineStage
} from './typing.js'

/**
 * What the host knows when it asks for a domain core: which registration, and which batch.
 *
 * The batch index is not here because the host does not count — it admits. Counting within a batch
 * is the functional entry's own bookkeeping, and putting it in the port would have made every
 * caller of the protected hook responsible for a number none of them track.
 */
export type IHostCoreConstructionRequest = Readonly<{
  readonly pluginName: string
  readonly batch: object
}>

/** One domain-core construction request as the `domainCore` callback receives it. */
export type IHostDomainCoreRequest = Readonly<{
  /** The plugin name this core belongs to. */
  readonly pluginName: string
  /** Zero-based index within the batch, increasing in admission order. */
  readonly batchIndex: number
  /** Batch identity; every request of one `use()`/`useSync()` call shares this object. */
  readonly batch: object
}>

/**
 * `TValue` is deliberately absent: no member of this shape mentions the pipeline value. The SDD's
 * API section declares it as `IDefineHostOptions<TDomainCore, TValue>`, which would be an unused
 * type parameter — `defineHost` still takes both, because the handle it returns does use `TValue`.
 */
export type IDefineHostOptions<TDomainCore extends object> = Readonly<{
  /** Forwarded to the host unchanged; identical in shape to the class constructor's options. */
  readonly host: IPluginHostOptions
  /** Replaces the `protected createPluginDomainCore` override; absent means an empty object. */
  readonly domainCore?: (request: IHostDomainCoreRequest) => TDomainCore
  /** Replaces the `protected translateDisposalError` override. */
  readonly translateDisposalError?: (error: PluginHostError) => Error
  /** Replaces `override dispose` plus `super.dispose()`; `next()` runs exactly once. */
  readonly dispose?: (
    next: () => Promise<IPluginHostDisposalResult>
  ) => Promise<IPluginHostDisposalResult>
  /** `this` receiver for published callable extensions; the handle itself by default. */
  readonly receiver?: object
}>

/**
 * The value a `defineHost` call returns.
 *
 * It carries the host's public surface plus the two members that are `protected` on the class —
 * `useSync` and `runPipeline` — because on a handle "only the owner may call this" is expressed by
 * who holds the object rather than by who extends the class.
 */
export type IHostHandle<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[]
> = Readonly<{
  readonly identity: IPluginHostIdentity
  readonly plugin: IPluginEnablement<
    IHostHandle<TDomainCore, TValue, TInstalled>,
    TInstalled,
    TDomainCore,
    TValue
  >
  readonly pipelineMode: IPipelineMode
  readonly revision: number
  readonly config: IPluginHostConfigFor<TInstalled>
  useSync<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IPluginConstraintTuple<
        TDomainCore & IPluginHostCore<TValue, IMergePluginShared<TInstalled>>,
        TPlugins
      >
  ): IPluginHostView<
    IHostHandle<TDomainCore, TValue, [...TInstalled, ...TPlugins]>,
    [...TInstalled, ...TPlugins],
    TDomainCore,
    TValue
  >
  use<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IPluginConstraintTuple<
        TDomainCore & IPluginHostCore<TValue, IMergePluginShared<TInstalled>>,
        TPlugins
      >
  ): Promise<
    IPluginHostView<
      IHostHandle<TDomainCore, TValue, [...TInstalled, ...TPlugins]>,
      [...TInstalled, ...TPlugins],
      TDomainCore,
      TValue
    >
  >
  unUse(
    name: string
  ): Promise<
    IPluginRemovalResult<IPluginHostDynamicView<IHostHandle<TDomainCore, TValue, TInstalled>>>
  >
  getShared<T = unknown>(key: PropertyKey): T | undefined
  getCurrentView(): IPluginHostDynamicView<IHostHandle<TDomainCore, TValue, TInstalled>>
  usePipeline(stage: ISyncPipelineStage<TValue>): IHostHandle<TDomainCore, TValue, TInstalled>
  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): IHostHandle<TDomainCore, TValue, TInstalled>
  useGeneratorPipeline(
    stage: IGeneratorPipelineStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled>
  useAsyncGeneratorPipeline(
    stage: IAsyncGeneratorPipelineStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled>
  /** Replaces the `protected runPipeline`; only the handle's holder can reach it. */
  runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void>
  dispose(): Promise<IPluginHostDisposalResult>
}>

/**
 * A host as a value instead of a base class.
 *
 * The four `protected` hooks a subclass used to override become four optional callbacks, and what
 * came back is a frozen handle rather than an instance — so a consumer holds a host without also
 * inheriting its whole surface, and the two protected members that only a host's owner may call
 * (`useSync`, `runPipeline`) are on the handle instead of on everything that extends the class.
 *
 * The handle is registered as a managed host, so `isManagedHost` and `openComposition` accept it on
 * the same terms as a class instance: a composing package branches on what a value _is_, not on
 * which of the two entries produced it.
 */
export function defineHost<TDomainCore extends object = Record<string, never>, TValue = never>(
  options: IDefineHostOptions<TDomainCore>
): IHostHandle<TDomainCore, TValue, readonly []> {
  /** Per-batch admission counters, keyed by the batch token the core runtime supplies. */
  const batchCounters = new WeakMap<object, number>()
  class Runtime extends PluginHost<TDomainCore, TValue> {
    protected override createPluginDomainCore(request?: IHostCoreConstructionRequest): TDomainCore {
      if (!options.domainCore) return {} as TDomainCore
      const batch = request?.batch ?? Runtime
      const batchIndex = batchCounters.get(batch) ?? 0
      batchCounters.set(batch, batchIndex + 1)
      return options.domainCore({
        pluginName: request?.pluginName ?? '',
        batchIndex,
        batch
      })
    }
    protected override translateDisposalError(error: PluginHostError): Error {
      return options.translateDisposalError ? options.translateDisposalError(error) : error
    }
    /** `useSync` and `runPipeline` are protected on the class; the handle is their only caller. */
    useSyncPublic(plugins: readonly IPluginConstraint<any>[]) {
      return this.useSync(plugins)
    }
    runPipelinePublic(value: TValue, done: (value: TValue) => void) {
      return this.runPipeline(value, done)
    }
  }
  const runtime = new Runtime(options.host, readDefinedPluginDefinition)
  /** Memoized disposal chain, so the middleware and the runtime each run exactly once. */
  let disposal: Promise<IPluginHostDisposalResult> | undefined
  const handleSurface = {
    get revision() {
      return runtime.revision
    },
    get pipelineMode() {
      return runtime.pipelineMode
    },
    get config() {
      return runtime.config
    },
    get plugin() {
      return runtime.plugin
    },
    useSync: (...plugins: readonly IPluginConstraint<any>[]) => runtime.useSyncPublic(plugins),
    use: (...plugins: readonly IPluginConstraint<any>[]) =>
      runtime.use(...(plugins as [IPluginConstraint<any>])),
    unUse: (name: string) => runtime.unUse(name),
    getShared: <T = unknown>(key: PropertyKey) => runtime.getShared<T>(key),
    getCurrentView: () => runtime.getCurrentView(),
    usePipeline: (stage: ISyncPipelineStage<TValue>) => {
      runtime.usePipeline(stage)
      return handle
    },
    useAsyncPipeline: (stage: IAsyncPipelineStage<TValue>) => {
      runtime.useAsyncPipeline(stage)
      return handle
    },
    useGeneratorPipeline: (stage: IGeneratorPipelineStage<TValue>) => {
      runtime.useGeneratorPipeline(stage)
      return handle
    },
    useAsyncGeneratorPipeline: (stage: IAsyncGeneratorPipelineStage<TValue>) => {
      runtime.useAsyncGeneratorPipeline(stage)
      return handle
    },
    runPipeline: (value: TValue, done: (value: TValue) => void) =>
      runtime.runPipelinePublic(value, done),
    dispose: (): Promise<IPluginHostDisposalResult> =>
      (disposal ??= options.dispose ? options.dispose(() => runtime.dispose()) : runtime.dispose())
  }
  const identity = issueHostIdentity(handleSurface, options.host.identity?.name)
  Object.defineProperty(handleSurface, 'identity', {
    value: identity,
    enumerable: true,
    configurable: false,
    writable: false
  })
  const handle = Object.freeze(handleSurface)
  registerManagedHost(handle, openComposition(runtime))
  if (options.receiver) registerManagedHost(options.receiver, openComposition(runtime))
  return handle as unknown as IHostHandle<TDomainCore, TValue, readonly []>
}
