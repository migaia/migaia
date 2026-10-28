import type { IPipelineDefinitions, IPipelineOwner } from './pipeline-spec.js'
import { identifyPluginHostCallbackFailure } from './error-text.js'
import { deferred } from '@migaia/utils/promise'
import { PluginHost } from './host-runtime.js'
import { aliasManagedHost } from './composition.js'
import { readDefinedPluginDefinition } from './define-plugin.js'
import type { PluginHostError } from './error-text.js'
import { issueHostIdentity } from './host-identity.js'
import { type IPluginHostIdentity } from './host-identity-types.js'
import type {
  IAsyncGeneratorMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  IMiddlewarePipelineMode,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'
import type { IPluginConstraint, IPluginHostRuntimeExtensions } from './plugin-definition-types.js'
import type { IPluginConstraintTuple } from './plugin-inference-types.js'
import type { IPluginHostCore, IPluginHostCoreTypeInfo } from './plugin-core-types.js'
import type {
  IPluginHandle,
  IPluginHandleTuple,
  IPluginRemoval,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan,
  IPluginHostConfigFor,
  IPluginEnablement
} from './plugin-handle-types.js'
import type { IPluginHostDisposalResult } from './plugin-lifecycle-types.js'
import type { IPluginHostOptions } from './host-options-types.js'

/** Each qualified name retains its own original payload rather than a union of sibling specs. */
type IQualifiedPipelines<TPlugin> = TPlugin extends { readonly name: infer TName extends string }
  ? {
      readonly [K in keyof import('./plugin-definition-types.js').IPluginDeclaredPipelines<TPlugin> &
        string as `${TName}.${K}`]: import('./plugin-definition-types.js').IPluginDeclaredPipelines<TPlugin>[K]
    }
  : Record<never, never>

/** Installed definitions carry their actual qualified declarations without a second type table. */
type IInstalledPipelines<TInstalled extends readonly IPluginConstraint<any>[]> = [
  TInstalled[number]
] extends [never]
  ? Record<never, never>
  : (
        TInstalled[number] extends infer TPlugin
          ? TPlugin extends unknown
            ? (value: IQualifiedPipelines<TPlugin>) => void
            : never
          : never
      ) extends (value: infer TVisible extends IPipelineDefinitions) => void
    ? TVisible
    : Record<never, never>

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

/** Native surface composition borrows only the original install and removal transaction entries. */
type IHostSurfaceOperations<
  TDomainCore extends object,
  TValue,
  TPipelines extends IPipelineDefinitions
> = Pick<
  IHostHandle<TDomainCore, TValue, readonly [], Record<never, never>, TPipelines>,
  'use' | 'unUse'
>

/** Only function-form composition may replace these two public methods before the handle freezes. */
type IHostSurfaceFactory<
  TDomainCore extends object,
  TValue,
  TPublicSurface extends object,
  TPipelines extends IPipelineDefinitions
> = (native: IHostSurfaceOperations<TDomainCore, TValue, TPipelines>) => TPublicSurface & {
  readonly [K in Exclude<
    keyof IHostHandle<Record<string, never>, never, readonly []>,
    'use' | 'unUse'
  >]?: never
}

/** Construction options retain their original type axes; the final axis types borrowed mutations. */
export type IDefineHostOptions<
  TDomainCore extends object,
  TPublicSurface extends object = Record<never, never>,
  TPipelines extends IPipelineDefinitions = Record<never, never>,
  TValue = never
> = Readonly<{
  /**
   * Forwarded to the host unchanged; identical in shape to the class constructor's options.
   * Omission uses every Host default.
   */
  readonly host?: IPluginHostOptions
  /** Named payload declarations inferred independently of the default pipeline value. */
  readonly pipelines?: TPipelines
  /**
   * Domain-owned public descriptors installed before the single canonical handle is frozen.
   * Object-form canonical keys stay reserved. A factory borrows native use/unUse and may replace
   * only those two methods; domain methods and fluent host entries still share one identity.
   */
  readonly surface?:
    | (TPublicSurface & {
        readonly [K in keyof IHostHandle<Record<string, never>, never, readonly []>]?: never
      })
    | IHostSurfaceFactory<TDomainCore, TValue, TPublicSurface, TPipelines>
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
  TPublicSurface extends object = Record<never, never>,
  TPipelines extends IPipelineDefinitions = Record<never, never>
> = Omit<
  Readonly<{
    /** Immutable issuing Host label/id, shared with its canonical runtime. */
    readonly identity: IPluginHostIdentity
    /** Reversible availability controls; disabling retains resources rather than unloading. */
    readonly plugin: IPluginEnablement<
      IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface, TPipelines>,
      TInstalled,
      TDomainCore,
      TValue
    >
    /** Runner selected at construction; access fails while closing or disposed. */
    readonly pipelineMode: IMiddlewarePipelineMode
    /** Owner authority for one declared name, including mode-appropriate execution. */
    pipeline<TName extends keyof (TPipelines & IInstalledPipelines<TInstalled>) & string>(
      name: TName
    ): IPipelineOwner<(TPipelines & IInstalledPipelines<TInstalled>)[TName]>
    /** Construction owners can execute their genuine candidate through the same lookup entry. */
    pipeline(
      name: string,
      request: IHostCoreConstructionRequest
    ): IPipelineOwner<import('./pipeline-spec.js').IPipelineSpec<unknown>>
    /** Current committed publication revision, not a count of attempted operations. */
    readonly revision: number
    /** Stable name/path config reader and queued transactional updater. */
    readonly config: IPluginHostConfigFor<TInstalled>
    /** Synchronous owner path; eager setup/async install is rejected and partial work rolls back. */
    useSync<const TPlugins extends readonly IPluginConstraint<any>[]>(
      ...plugins: TPlugins &
        IPluginConstraintTuple<
          TDomainCore &
            IPluginHostCore<
              TValue,
              Record<PropertyKey, unknown>,
              import('./plugin-lifecycle-types.js').IPluginConfig,
              TPipelines
            >,
          TPlugins,
          TInstalled
        >
    ): IPluginHandleTuple<TPlugins>
    /**
     * Queues one install batch and returns input-ordered name handles only after atomic
     * publication.
     */
    use<const TPlugins extends readonly IPluginConstraint<any>[]>(
      ...plugins: TPlugins &
        IPluginConstraintTuple<
          TDomainCore &
            IPluginHostCore<
              TValue,
              Record<PropertyKey, unknown>,
              import('./plugin-lifecycle-types.js').IPluginConfig,
              TPipelines
            >,
          TPlugins,
          TInstalled
        >
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
    ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface, TPipelines>
    /** Adds an unowned async stage, subject to canonical mode lifting and execution guards. */
    useAsyncPipeline(
      stage: IAsyncMiddlewareStage<TValue>
    ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface, TPipelines>
    /** Adds an unowned generator stage using the middleware generator-return protocol. */
    useGeneratorPipeline(
      stage: IGeneratorMiddlewareStage<TValue>
    ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface, TPipelines>
    /** Adds an unowned async-generator stage; the Host still owns execution cancellation/leases. */
    useAsyncGeneratorPipeline(
      stage: IAsyncGeneratorMiddlewareStage<TValue>
    ): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface, TPipelines>
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
    IPluginHostCoreTypeInfo<TDomainCore, TValue, TPipelines>,
  Extract<keyof TPublicSurface, 'use' | 'unUse'>
> &
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
 * Options are optional. Host.execution budgets default to 5000 ms each; a caller may pass finite
 * nonnegative numbers or false for unbounded waiting. domainCore and surface are optional; their
 * defaults add no domain members. Invalid input is rejected before a usable handle escapes. Custom
 * disposal middleware failures retain their native identity or cause under CALLBACK_FAILED, rather
 * than becoming cleanup rows.
 */
export function defineHost<
  TDomainCore extends object = Record<string, never>,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  TPublicSurface extends object = Record<never, never>,
  const TPipelines extends IPipelineDefinitions = Record<never, never>
>(
  options: IDefineHostOptions<TDomainCore, TPublicSurface, TPipelines, TValue> = {}
): IHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface, TPipelines> {
  /** Snapshot descriptors before acquiring a runtime; do not evaluate domain accessors. */
  let surfaceDescriptors: PropertyDescriptorMap | undefined
  /** Composition runs once after native entries exist, without exposing the mutable handle target. */
  let surfaceFactory:
    | IHostSurfaceFactory<TDomainCore, TValue, TPublicSurface, TPipelines>
    | undefined
  try {
    /** Capture the option once even when the caller supplies a getter. */
    const publicSurface = options.surface
    if (typeof publicSurface === 'function') surfaceFactory = publicSurface
    else
      surfaceDescriptors =
        publicSurface === undefined ? undefined : Object.getOwnPropertyDescriptors(publicSurface)
  } catch (error) {
    throw identifyPluginHostCallbackFailure(error)
  }
  const runtime = new DefinedHostRuntime<TDomainCore, TValue, TInstalled, TPipelines>(options)
  /** The fluent pipeline entries return the public proxy, which exists only after the surface. */
  const reference: IHandleReference = { handle: undefined }
  const handleSurface = createHandleSurface(runtime, options, reference)
  if (surfaceFactory) {
    try {
      /** These original callables keep all transaction, rollback and removal ownership native. */
      const native = Object.freeze({
        use: handleSurface.use,
        unUse: handleSurface.unUse
      }) as IHostSurfaceOperations<TDomainCore, TValue, TPipelines>
      surfaceDescriptors = Object.getOwnPropertyDescriptors(surfaceFactory(native))
    } catch (error) {
      throw identifyPluginHostCallbackFailure(error)
    }
  }
  if (surfaceDescriptors) {
    for (const key of Reflect.ownKeys(surfaceDescriptors)) {
      // Host methods and the issued identity remain canonical even at a plain-JS boundary.
      if (
        key !== 'identity' &&
        (!Object.hasOwn(handleSurface, key) ||
          (surfaceFactory && (key === 'use' || key === 'unUse')))
      )
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
  reference.handle = handle
  /** Identity and managed-host provenance belong to the exact public proxy rather than its target. */
  const identity = issueHostIdentity(handle, options.host?.identity?.name, runtime)
  Object.defineProperty(handleSurface, 'identity', {
    value: identity,
    enumerable: true,
    configurable: false,
    writable: false
  })
  Object.freeze(handleSurface)
  aliasManagedHost(handle, runtime)
  return handle as unknown as IHostHandle<
    TDomainCore,
    TValue,
    TInstalled,
    TPublicSurface,
    TPipelines
  >
}

/** Holds the public proxy once it exists, so fluent entries can return it. */
type IHandleReference = { handle: object | undefined }

/**
 * Runtime behind one functional Host. It replaces the four protected class hooks with the options'
 * callbacks and exposes the protected owner entries only to the handle created alongside it.
 */
class DefinedHostRuntime<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
> extends PluginHost<TDomainCore, TValue, TInstalled, TPipelines> {
  /** Functional entry options; read on each hook call, as the original per-call class did. */
  readonly #options: IDefineHostOptions<TDomainCore, any, TPipelines>
  /** Per-batch admission counters, keyed by the batch token the core runtime supplies. */
  readonly #batchCounters = new WeakMap<object, number>()
  /** Batch identity used when a construction request carries none; stable for this Host. */
  readonly #defaultBatch: object = Object.freeze({})

  /** Creates the runtime with the trusted functional-definition reader. */
  constructor(options: IDefineHostOptions<TDomainCore, any, TPipelines>) {
    super({ ...options.host, pipelines: options.pipelines }, readDefinedPluginDefinition)
    this.#options = options
  }

  /** Builds a domain core through the options' callback, numbering requests within a batch. */
  protected override createPluginDomainCore(request?: IHostCoreConstructionRequest): TDomainCore {
    const domainCore = this.#options.domainCore
    if (!domainCore) return {} as TDomainCore
    const batch = request?.batch ?? this.#defaultBatch
    const batchIndex = this.#batchCounters.get(batch) ?? 0
    this.#batchCounters.set(batch, batchIndex + 1)
    return domainCore({ pluginName: request?.pluginName ?? '', batchIndex, batch })
  }

  /** Uses the options' translator when supplied. */
  protected override translateDisposalError(error: PluginHostError): Error {
    const translate = this.#options.translateDisposalError
    return translate ? translate(error) : error
  }

  /** `useSync` and `runPipeline` are protected on the class; the handle is their only caller. */
  useSyncPublic(plugins: readonly IPluginConstraint<any>[]) {
    return this.useSync(plugins)
  }

  /** Forwards the default selected-mode entry for the owner handle. */
  runPipelinePublic(value: TValue, done: (value: TValue) => void) {
    return this.runPipeline(value, done)
  }

  /** Exposes only the existing protected owner authority on the functional handle. */
  pipelinePublic(name: string, request?: IHostCoreConstructionRequest): any {
    return request ? this.pipeline(name, request) : this.pipeline(name as keyof TPipelines & string)
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

/**
 * Owns the functional Host's memoized disposal: the optional middleware and the runtime cleanup
 * each run exactly once, and every caller receives the same Promise.
 */
class DefinedHostDisposal {
  /** Runtime that performs canonical cleanup. */
  readonly #runtime: { dispose(): Promise<IPluginHostDisposalResult> }
  /** Optional disposal middleware from the options. */
  readonly #middleware: IDefineHostOptions<object>['dispose']
  /** Shared completion, published before middleware can call dispose again. */
  #disposal: Promise<IPluginHostDisposalResult> | undefined

  /** Captures the runtime and the optional middleware. */
  constructor(
    runtime: { dispose(): Promise<IPluginHostDisposalResult> },
    middleware: IDefineHostOptions<object>['dispose']
  ) {
    this.#runtime = runtime
    this.#middleware = middleware
  }

  /** Starts disposal once; middleware failures keep their identity under CALLBACK_FAILED. */
  readonly dispose = (): Promise<IPluginHostDisposalResult> => {
    if (this.#disposal) return this.#disposal
    /** Publish before user middleware can synchronously call this same public method again. */
    const completion = deferred<IPluginHostDisposalResult>()
    this.#disposal = completion.promise
    try {
      /** One existing runtime owns cleanup; the facade only adopts its selected middleware result. */
      const result = this.#middleware
        ? this.#middleware(() => this.#runtime.dispose())
        : this.#runtime.dispose()
      void Promise.resolve(result).then(completion.resolve, (error: unknown) =>
        completion.reject(identifyPluginHostCallbackFailure(error))
      )
    } catch (error) {
      completion.reject(identifyPluginHostCallbackFailure(error))
    }
    return this.#disposal
  }
}

/**
 * Builds the mutable handle surface: Host getters plus forwarding entries. The caller adds domain
 * descriptors and the identity, then freezes it behind the public proxy.
 */
function createHandleSurface<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
>(
  runtime: DefinedHostRuntime<TDomainCore, TValue, TInstalled, TPipelines>,
  options: IDefineHostOptions<TDomainCore, any, TPipelines>,
  reference: IHandleReference
): Record<PropertyKey, unknown> {
  /** Routes each literal dry-run form to the matching class overload. */
  const unUse = (
    name: string,
    mutationOptions?: IPluginDependencyMutationOptions
  ): Promise<IPluginRemoval | IPluginDependencyPlan> =>
    mutationOptions?.dryRun === true
      ? runtime.unUse(name, { ...mutationOptions, dryRun: true })
      : runtime.unUse(name, { ...mutationOptions, dryRun: false })
  return {
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
      return reference.handle
    },
    useAsyncPipeline: (stage: IAsyncMiddlewareStage<TValue>) => {
      runtime.useAsyncPipeline(stage)
      return reference.handle
    },
    useGeneratorPipeline: (stage: IGeneratorMiddlewareStage<TValue>) => {
      runtime.useGeneratorPipeline(stage)
      return reference.handle
    },
    useAsyncGeneratorPipeline: (stage: IAsyncGeneratorMiddlewareStage<TValue>) => {
      runtime.useAsyncGeneratorPipeline(stage)
      return reference.handle
    },
    pipeline: (name: string, request?: IHostCoreConstructionRequest) =>
      runtime.pipelinePublic(name, request),
    runPipeline: (value: TValue, done: (value: TValue) => void) =>
      runtime.runPipelinePublic(value, done),
    runPipelineSync: <TResult>(value: TValue, done: (value: TValue) => TResult) =>
      runtime.runPipelineSyncPublic(value, done),
    runPipelineAsync: <TResult>(value: TValue, done: (value: TValue) => Promise<TResult>) =>
      runtime.runPipelineAsyncPublic(value, done),
    dispose: new DefinedHostDisposal(runtime, options.dispose).dispose
  }
}
