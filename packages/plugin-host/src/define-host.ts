import { identifyPluginHostCallbackFailure } from './error-text.js'
import { deferred } from '@migaia/utils/promise'
import { PluginHost } from './host-runtime.js'
import { aliasManagedHost } from './composition.js'
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
  /** Registration for which the Host is creating its domain core. */
  readonly pluginName: string
  /** Opaque admission-batch identity, shared by requests from that batch. */
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
  /**
   * Retained option corresponding to the protected class hook. The default structured cleanup
   * result path does not invoke it; it is not a callback for translating each cleanupErrors entry.
   */
  readonly translateDisposalError?: (error: PluginHostError) => Error
  /**
   * Optional disposal middleware, invoked once inside the shared disposal Promise. Call next() to
   * include canonical runtime cleanup; its result is shared and cleanup is not repeated. Middleware
   * may reject, unlike ordinary collected cleanup failures in the default disposal result.
   */
  readonly dispose?: (
    next: () => Promise<IPluginHostDisposalResult>
  ) => Promise<IPluginHostDisposalResult>
}>

/**
 * The value a `defineHost` call returns.
 *
 * It carries the host's public surface plus the owner-only class entries: `useSync`, `runPipeline`,
 * `runPipelineSync` and `runPipelineAsync`. Handle possession expresses execution authority instead
 * of subclass access.
 */
export type IHostHandle<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPublicSurface extends object = Record<never, never>
> = Readonly<{
  /** Immutable issuing Host label/id, shared with its canonical runtime. */
  readonly identity: IPluginHostIdentity
  /** Reversible availability controls; disabling retains resources rather than unloading. */
  readonly plugin: IPluginEnablement<
    IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>,
    TInstalled,
    TDomainCore,
    TValue
  >
  /** Runner selected at construction; access fails while closing or disposed. */
  readonly pipelineMode: IMiddlewarePipelineMode
  /** Current committed publication revision, not a count of attempted operations. */
  readonly revision: number
  /** Stable name/path config reader and queued transactional updater. */
  readonly config: IPluginHostConfigFor<TInstalled>
  /** Synchronous owner path; eager setup/async install is rejected and partial work rolls back. */
  useSync<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IPluginConstraintTuple<TDomainCore & IPluginHostCore<TValue>, TPlugins, TInstalled>
  ): IPluginHandleTuple<TPlugins>
  /** Queues one install batch and returns input-ordered name handles only after atomic publication. */
  use<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IPluginConstraintTuple<TDomainCore & IPluginHostCore<TValue>, TPlugins, TInstalled>
  ): Promise<IPluginHandleTuple<TPlugins>>
  /** Observes a dependency-aware removal plan without cleanup or revision change. */
  unUse(
    name: string,
    options: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun: true }>
  ): Promise<IPluginDependencyPlan>
  /**
   * Removes or suspends according to policy; cleanup failures return ok:false with affected
   * changes.
   */
  unUse(
    name: string,
    options?: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun?: false }>
  ): Promise<IPluginRemoval>
  /** Starts a lazy registration and needed providers; same-name pending callers share one Promise. */
  activate(name: string): Promise<IPluginHandle<IPluginConstraint<any>>>
  /**
   * Installs a same-name candidate before withdrawing the old generation; failure preserves the
   * old.
   */
  replace<TPlugin extends IPluginConstraint<any>>(
    name: string,
    next: TPlugin
  ): Promise<IPluginHandle<TPlugin>>
  /** Adds an unowned sync stage and returns this same handle; incompatible runner modes fail. */
  usePipeline(
    stage: ISyncMiddlewareStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
  /** Adds an unowned async stage, subject to canonical mode lifting and execution guards. */
  useAsyncPipeline(
    stage: IAsyncMiddlewareStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
  /** Adds an unowned generator stage using the middleware generator-return protocol. */
  useGeneratorPipeline(
    stage: IGeneratorMiddlewareStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
  /** Adds an unowned async-generator stage; the Host still owns execution cancellation/leases. */
  useAsyncGeneratorPipeline(
    stage: IAsyncGeneratorMiddlewareStage<TValue>
  ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
  /**
   * Runs the current stage snapshot; done receives the final delivered value if traversal reaches
   * it.
   */
  runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void>
  /** Runs synchronous stages, rejecting before effects if any visible async stage exists. */
  runPipelineSync<TResult>(value: TValue, done: (value: TValue) => TResult): TResult | undefined
  /** Waits for async execution; an empty lane returns the exact terminal Promise. */
  runPipelineAsync<TResult>(
    value: TValue,
    done: (value: TValue) => Promise<TResult>
  ): Promise<TResult | undefined>
  /** Shared singleflight completion; defaults to structured cleanup, custom middleware may reject. */
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
 * inheriting its whole surface. Protected installation and execution entries are available on the
 * owner handle instead of becoming public methods on every class instance.
 *
 * The handle is registered as a managed host, so `isManagedHost` and `openComposition` accept it on
 * the same terms as a class instance: a composing package branches on what a value _is_, not on
 * which of the two entries produced it.
 *
 * Host.execution must explicitly select finite nonnegative mutation/drain budgets or false for
 * unbounded waiting. domainCore and surface are optional; their defaults add no domain members.
 * Invalid input is rejected before a usable handle escapes. Custom disposal middleware failures
 * retain their native identity or cause under CALLBACK_FAILED, rather than becoming cleanup rows.
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
    /** Owner handle forwards the sync entry without another execution owner. */
    runPipelineSyncPublic<TResult>(value: TValue, done: (value: TValue) => TResult) {
      return this.runPipelineSync(value, done)
    }
    /** Owner handle preserves the empty-lane terminal Promise identity. */
    runPipelineAsyncPublic<TResult>(value: TValue, done: (value: TValue) => Promise<TResult>) {
      return this.runPipelineAsync(value, done)
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
    runPipelineSync: <TResult>(value: TValue, done: (value: TValue) => TResult) =>
      runtime.runPipelineSyncPublic(value, done),
    runPipelineAsync: <TResult>(value: TValue, done: (value: TValue) => Promise<TResult>) =>
      runtime.runPipelineAsyncPublic(value, done),
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
  aliasManagedHost(handle, runtime)
  return handle as unknown as IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface>
}
