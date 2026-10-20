import { identifyPluginHostCallbackFailure } from './error-text.js'
import { deferred } from '@migaia/utils/promise'
import { PluginHost } from './host-runtime.js'
import { openComposition, registerManagedHost } from './composition.js'
import { readDefinedPluginDefinition } from './define-plugin.js'
import type { PluginHostError } from './error-text.js'
import { issueHostIdentity, type IPluginHostIdentity } from './host-identity.js'
import type {
  IAsyncGeneratorMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  IMiddlewarePipelineMode,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'
import type {
  IPluginConstraint,
  IPluginConstraintTuple,
  IPluginHostCore,
  IPluginHostCoreTypeInfo,
  IPluginHandle,
  IPluginHandleTuple,
  IPluginRemoval,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan,
  IPluginHostDisposalResult,
  IPluginHostConfigFor,
  IPluginEnablement,
  IPluginHostOptions,
  IPluginHostRuntimeExtensions
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
 * `TValue` is deliberately absent: no member of this shape mentions the pipeline value. The design
 * declares it as `IDefineHostOptions<TDomainCore, TValue>`, which would be an unused type parameter
 * — `defineHost` still takes both, because the handle it returns does use `TValue`.
 */
export type IDefineHostOptions<
  TDomainCore extends object,
  TPublicSurface extends object = Record<never, never>
> = Readonly<{
  /** Forwarded to the host unchanged; identical in shape to the class constructor's options. */
  readonly host: IPluginHostOptions
  /**
   * Domain-owned public descriptors installed before the single canonical handle is frozen.
   * Canonical host keys are reserved; domain methods and fluent host entries share one identity.
   */
  readonly surface?: TPublicSurface & {
    readonly [K in keyof IHostHandle<Record<string, never>, never, readonly []>]?: never
  }
  /** Replaces the `protected createPluginDomainCore` override; absent means an empty object. */
  readonly domainCore?: (request: IHostDomainCoreRequest) => TDomainCore
  /** Replaces the `protected translateDisposalError` override. */
  readonly translateDisposalError?: (error: PluginHostError) => Error
  /** Replaces `override dispose` plus `super.dispose()`; `next()` runs exactly once. */
  readonly dispose?: (
    next: () => Promise<IPluginHostDisposalResult>
  ) => Promise<IPluginHostDisposalResult>
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
  TInstalled extends readonly IPluginConstraint<any>[],
  TPublicSurface extends object = Record<never, never>
> = Readonly<{
  readonly identity: IPluginHostIdentity
  readonly plugin: IPluginEnablement<
    IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>,
    TInstalled,
    TDomainCore,
    TValue
  >
  readonly pipelineMode: IMiddlewarePipelineMode
  readonly revision: number
  readonly config: IPluginHostConfigFor<TInstalled>
  useSync<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IPluginConstraintTuple<TDomainCore & IPluginHostCore<TValue>, TPlugins, TInstalled>
  ): IPluginHandleTuple<TPlugins>
  use<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IPluginConstraintTuple<TDomainCore & IPluginHostCore<TValue>, TPlugins, TInstalled>
  ): Promise<IPluginHandleTuple<TPlugins>>
  unUse(
    name: string,
    options: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun: true }>
  ): Promise<IPluginDependencyPlan>
  unUse(
    name: string,
    options?: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun?: false }>
  ): Promise<IPluginRemoval>
  activate(name: string): Promise<IPluginHandle<IPluginConstraint<any>>>
  replace<TPlugin extends IPluginConstraint<any>>(
    name: string,
    next: TPlugin
  ): Promise<IPluginHandle<TPlugin>>
  usePipeline(
    stage: ISyncMiddlewareStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
  useAsyncPipeline(
    stage: IAsyncMiddlewareStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
  useGeneratorPipeline(
    stage: IGeneratorMiddlewareStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
  useAsyncGeneratorPipeline(
    stage: IAsyncGeneratorMiddlewareStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
  /** Replaces the `protected runPipeline`; only the handle's holder can reach it. */
  runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void>
  dispose(): Promise<IPluginHostDisposalResult>
}> &
  IPluginHostRuntimeExtensions<TInstalled> &
  IPluginHostCoreTypeInfo<TDomainCore, TValue> &
  Readonly<TPublicSurface>

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
export function defineHost<
  TDomainCore extends object = Record<string, never>,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  TPublicSurface extends object = Record<never, never>
>(
  options: IDefineHostOptions<TDomainCore, TPublicSurface>
): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface> {
  /** Snapshot descriptors before acquiring a runtime; do not evaluate domain accessors. */
  let surfaceDescriptors: PropertyDescriptorMap | undefined
  try {
    /** Capture the option once even when the caller supplies a getter. */
    const publicSurface = options.surface
    surfaceDescriptors =
      publicSurface === undefined ? undefined : Object.getOwnPropertyDescriptors(publicSurface)
  } catch (error) {
    throw identifyPluginHostCallbackFailure(error)
  }
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
    /** Only the package-owned frozen surface receives this committed-publication read capability. */
    readRuntimeSharedExtensionPublic(key: PropertyKey): object | undefined {
      return this.readRuntimeSharedExtension(key)
    }
  }
  const runtime = new Runtime(options.host, readDefinedPluginDefinition)
  /** Routes each literal dry-run form to the matching class overload. */
  function unUse(
    name: string,
    mutationOptions: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun: true }>
  ): Promise<IPluginDependencyPlan>
  function unUse(
    name: string,
    mutationOptions?: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun?: false }>
  ): Promise<IPluginRemoval>
  function unUse(
    name: string,
    mutationOptions?: IPluginDependencyMutationOptions
  ): Promise<IPluginRemoval | IPluginDependencyPlan> {
    return mutationOptions?.dryRun === true
      ? runtime.unUse(name, { ...mutationOptions, dryRun: true })
      : runtime.unUse(name, { ...mutationOptions, dryRun: false })
  }
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
    unUse,
    activate: (name: string) => runtime.activate(name),
    replace: (name: string, next: IPluginConstraint<any>) => runtime.replace(name, next),
    usePipeline: (stage: ISyncMiddlewareStage<TValue>) => {
      runtime.usePipeline(stage)
      return handle
    },
    useAsyncPipeline: (stage: IAsyncMiddlewareStage<TValue>) => {
      runtime.useAsyncPipeline(stage)
      return handle
    },
    useGeneratorPipeline: (stage: IGeneratorMiddlewareStage<TValue>) => {
      runtime.useGeneratorPipeline(stage)
      return handle
    },
    useAsyncGeneratorPipeline: (stage: IAsyncGeneratorMiddlewareStage<TValue>) => {
      runtime.useAsyncGeneratorPipeline(stage)
      return handle
    },
    runPipeline: (value: TValue, done: (value: TValue) => void) =>
      runtime.runPipelinePublic(value, done),
    dispose: (): Promise<IPluginHostDisposalResult> => {
      if (disposal) return disposal
      /** Publish before user middleware can synchronously call this same public method again. */
      const completion = deferred<IPluginHostDisposalResult>()
      disposal = completion.promise
      try {
        /** One existing runtime owns cleanup; the facade only adopts its selected middleware result. */
        const result = options.dispose
          ? options.dispose(() => runtime.dispose())
          : runtime.dispose()
        void Promise.resolve(result).then(completion.resolve, (error: unknown) =>
          completion.reject(identifyPluginHostCallbackFailure(error))
        )
      } catch (error) {
        completion.reject(identifyPluginHostCallbackFailure(error))
      }
      return disposal
    }
  }
  if (surfaceDescriptors) {
    for (const key of Reflect.ownKeys(surfaceDescriptors)) {
      // Host methods and the issued identity remain canonical even at a plain-JS boundary.
      if (key !== 'identity' && !Object.hasOwn(handleSurface, key))
        Object.defineProperty(handleSurface, key, surfaceDescriptors[key])
    }
  }
  /** Shared outlets are read through original state while the existing public protocol stays frozen. */
  const handle = new Proxy(handleSurface, {
    get: (target, key, receiver) =>
      Reflect.has(target, key)
        ? Reflect.get(target, key, receiver)
        : runtime.readRuntimeSharedExtensionPublic(key)
  })
  /** Identity and managed-host provenance belong to the exact public proxy rather than its target. */
  const identity = issueHostIdentity(handle, options.host.identity?.name, runtime)
  Object.defineProperty(handleSurface, 'identity', {
    value: identity,
    enumerable: true,
    configurable: false,
    writable: false
  })
  Object.freeze(handleSurface)
  registerManagedHost(handle, openComposition(runtime))
  return handle as unknown as IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
}
