/**
 * Owns the public PluginHost class boundary and protected subclass hooks; internal owners assemble,
 * mutate and publish through explicit ports.
 */

import { PluginHostError } from './error-text.ts'
import { type IPluginHostIdentity } from './host-identity-types.ts'
import { type ITrustedDefinitionReader } from './admission-runtime.ts'

import type { IHostCoreConstructionRequest } from './define-host.ts'

import type { IPluginHostDisposalProvenance } from './cleanup-runtime.ts'
import { HostReflection } from './host-constants.ts'
import { asyncDisposeKey } from './symbols.ts'

import type { IPipelineDefinitions, IPipelineOwner } from './pipeline-spec.ts'

import {
  MiddlewarePipelineMode,
  type IAsyncGeneratorMiddlewareStage,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IMiddlewarePipelineMode,
  type ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'

import type { pluginHostCoreTypes, IPluginHostCore } from './plugin-core-types.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type { IPluginConstraintTuple, IUniquePluginNames } from './plugin-inference-types.ts'
import type {
  IPluginHostConfigFor,
  IPluginHandle,
  IPluginHandleTuple,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan,
  IPluginRemoval,
  IPluginEnablement
} from './plugin-handle-types.ts'
import type { IPluginHostOptions } from './host-options-types.ts'

import { createHostRuntimeContext, type IPluginHostRuntimeContext } from './host-runtime-context.ts'
import { PluginHostMutationRuntime } from './host-mutation-runtime.ts'
import type { PluginHostRuntimePorts } from './host-runtime-ports.ts'
/** Type-only invariant marker that preserves constructor-installed tuples through subclasses. */
declare const installedPluginsBrand: unique symbol

export {
  PluginHostDisposalNodeKind,
  type IPluginHostDisposalNodeKind,
  type IPluginHostDisposalProvenance
} from './cleanup-runtime.ts'
/** Module-instance authority for Host-generated disposal nodes; duplicate instances fail closed. */
const pluginHostDisposalProvenance = new WeakMap<object, IPluginHostDisposalProvenance>()

/**
 * Reads frozen producer provenance for a disposal node issued by this package instance. Unknown
 * values return undefined without inspecting properties; matching public fields cannot forge it.
 * Translators can use this distinction without changing the node's original error identity.
 */
export const readPluginHostDisposalProvenance = (
  value: unknown
): IPluginHostDisposalProvenance | undefined => {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return pluginHostDisposalProvenance.get(value)
}

/** Registers one Host-created node under this module instance's private authority. */
const registerPluginHostDisposalNode = <T extends object>(
  node: T,
  provenance: IPluginHostDisposalProvenance
): T => {
  pluginHostDisposalProvenance.set(node, Object.freeze({ ...provenance }))
  return node
}

/** Extracts the invariant constructor-installed tuple from a concrete PluginHost subclass. */
export type IPluginHostInstalledPlugins<THost extends PluginHost<any, any, any>> =
  THost[typeof installedPluginsBrand]

/**
 * Runtime-neutral owner of plugin registration, configuration, pipeline leases and resource
 * cleanup. Async mutations share a FIFO queue; synchronous owner installation is a separate
 * explicit path. Handles address names, while captured callable views retain exact-generation
 * revocation guards.
 */
class PluginHostConstructor<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  TPipelines extends IPipelineDefinitions = Record<never, never>
> {
  /** Type-only core axes let composition owners retain the exact plugin-facing capabilities. */
  declare readonly [pluginHostCoreTypes]: Readonly<{
    readonly core: TDomainCore
    readonly value: TValue
    readonly pipelines: TPipelines
  }>
  /** Immutable process-local identity used by Host errors and diagnostics. */
  readonly identity: IPluginHostIdentity
  /** Type-only baseline tuple marker; no runtime property is emitted. */
  declare readonly [installedPluginsBrand]: TInstalled
  /** Internal coordination is absent from the public Host surface. */
  readonly #context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>
  /** Structural mutation orchestration has one owner behind the original methods. */
  readonly #mutations: PluginHostMutationRuntime<TDomainCore, TValue, TInstalled, TPipelines>
  /** Narrow Host admission capability used by protected pipeline entries. */
  readonly #contextPort: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>
  /** Readonly enablement facade over this Host's canonical registrations. */
  readonly plugin: IPluginEnablement<this, TInstalled, TDomainCore, TValue>
  /**
   * Creates an empty Host. Mutation and pipeline-drain budgets each default to 5000 ms; numeric
   * budgets must be finite and nonnegative and false waits without a deadline. Pipeline mode
   * defaults to sync, diagnostics to no-op, queue diagnostics to 1000 ms and disposal steps to 5000
   * ms. Invalid options fail admission; the scheduler defaults to systemScheduler and secure Host
   * identity requires host cryptographic randomness.
   */
  constructor(
    options: IPluginHostOptions<TPipelines> = {},
    trustedDefinitionReader?: ITrustedDefinitionReader
  ) {
    /** Protected override capability is lent once and keeps the concrete Host receiver. */
    const { context, port } = createHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>(
      {
        host: this,
        createDomainCore: (request) => this.createPluginDomainCore(request),
        registerDisposalNode: registerPluginHostDisposalNode
      },
      options,
      trustedDefinitionReader
    )
    this.#contextPort = port
    this.#context = context
    this.#mutations = new PluginHostMutationRuntime(context, port)
    this.identity = context.identity
    this.plugin = context.plugin as IPluginEnablement<this, TInstalled, TDomainCore, TValue>
  }

  /** Current runner mode; closing or disposed Hosts reject access with their lifecycle code. */
  get pipelineMode(): IMiddlewarePipelineMode {
    this.#contextPort.assertActive()
    return this.#context.pipelines.default.mode
  }

  /** Current committed Host mutation receipt; it changes only at publication boundaries. */
  get revision(): number {
    return this.#context.state.revision
  }

  /** Frozen handles receive only this read port for the same committed shared publication. */
  protected readRuntimeSharedExtension(key: PropertyKey): object | undefined {
    return this.#context.state.readSharedExtension(key)
  }

  /**
   * Builds one registration's domain core. The request names the registration it is for; the class
   * entry may ignore it, and the functional entry needs it to tell one batch member from another.
   */
  protected createPluginDomainCore(_request?: IHostCoreConstructionRequest): TDomainCore {
    return {} as TDomainCore
  }

  /**
   * Retained protected translation hook, returning the supplied error unchanged by default. The
   * current structured cleanup-result path does not invoke it; overriding it does not translate
   * each cleanupErrors entry or replace the Host's disposal completion protocol.
   */
  protected translateDisposalError(error: PluginHostError): Error {
    return error
  }

  /** Typed owner authority exposes execution only to the Host's own handle or subclass. */
  protected pipeline<TName extends keyof TPipelines & string>(
    name: TName
  ): IPipelineOwner<TPipelines[TName]>
  protected pipeline(
    name: string,
    request: import('./define-host.ts').IHostCoreConstructionRequest
  ): IPipelineOwner<import('./pipeline-spec.ts').IPipelineSpec<unknown>>
  protected pipeline(
    name: string,
    request?: import('./define-host.ts').IHostCoreConstructionRequest
  ): any {
    return this.#context.pipelines.owner(name, request)
  }

  /** Default selected-mode execution retains its established public signature. */
  protected runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void> {
    return this.#context.pipelines.default.runVoid(value, done)
  }

  /** Default synchronous execution uses original sync forms from the same canonical lane. */
  protected runPipelineSync<TResult>(
    value: TValue,
    done: (value: TValue) => TResult
  ): TResult | undefined {
    return this.#context.pipelines.default.runSync(value, done)
  }

  /** Default asynchronous execution shares snapshots and preserves empty terminal Promise identity. */
  protected runPipelineAsync<TResult>(
    value: TValue,
    done: (value: TValue) => Promise<TResult>
  ): Promise<TResult | undefined> {
    return this.#context.pipelines.default.runAsync(value, done)
  }

  /**
   * Adds a Host-owned sync stage and advances revision, returning this same Host. Registration
   * during execution throws PIPELINE_EXECUTING; incompatible lifting throws
   * PIPELINE_MODE_MISMATCH.
   */
  usePipeline(stage: ISyncMiddlewareStage<TValue>): this {
    this.#contextPort.assertActive()
    this.#context.pipelines.default.register(stage, undefined, MiddlewarePipelineMode.sync)
    this.#context.state.commit()
    return this
  }

  /** Adds a Host-owned async stage under the same liveness, execution and mode-lifting guards. */
  useAsyncPipeline(stage: IAsyncMiddlewareStage<TValue>): this {
    this.#contextPort.assertActive()
    this.#context.pipelines.default.register(stage, undefined, MiddlewarePipelineMode.async)
    this.#context.state.commit()
    return this
  }

  /**
   * Adds a Host-owned generator stage; its return/yield values follow the canonical runner
   * protocol.
   */
  useGeneratorPipeline(stage: IGeneratorMiddlewareStage<TValue>): this {
    this.#contextPort.assertActive()
    this.#context.pipelines.default.register(stage, undefined, MiddlewarePipelineMode.generator)
    this.#context.state.commit()
    return this
  }

  /** Adds a Host-owned async-generator stage; new runs see it only after registration commits. */
  useAsyncGeneratorPipeline(stage: IAsyncGeneratorMiddlewareStage<TValue>): this {
    this.#contextPort.assertActive()
    this.#context.pipelines.default.register(
      stage,
      undefined,
      MiddlewarePipelineMode.asyncGenerator
    )
    this.#context.state.commit()
    return this
  }

  /**
   * Captures input definitions now, then queues atomic installation and returns frozen handles in
   * input order. Dependencies determine execution order; eager consumers activate needed lazy
   * providers. Preflight failure runs no install hooks. Later construction failure rolls back this
   * batch in reverse order, retaining the primary cause under PLUGIN_INSTALL_FAILED and rollback
   * details; previously committed registrations remain installed.
   */
  use<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IUniquePluginNames<TPlugins> &
      IPluginConstraintTuple<TDomainCore & IPluginHostCore<TValue>, TPlugins, TInstalled>
  ): Promise<IPluginHandleTuple<TPlugins>> {
    return this.#mutations.use<TPlugins>(plugins)
  }

  /**
   * Activates a lazy registration and required lazy providers, sharing one pending Promise per
   * name. Missing, disabled or suspended targets fail explicitly. Failed attempts clean up and may
   * be retried; success returns a name-addressed handle. Do not await this activation from itself.
   */
  activate(name: string): Promise<IPluginHandle<IPluginConstraint<any>>> {
    return this.#mutations.activate(name)
  }

  /**
   * Installs a same-name replacement before revoking the previous generation. Candidate failure
   * leaves the old provider live; after publication, dependent rebind/restart failures do not roll
   * the new provider back. Old captured callable extensions reject, while name-addressed handles
   * resolve the successor. Names that differ reject with REPLACE_NAME_MISMATCH before enqueue.
   */
  replace<TPlugin extends IPluginConstraint<any>>(
    name: string,
    next: TPlugin
  ): Promise<IPluginHandle<TPlugin>> {
    return this.#mutations.replace(name, next)
  }

  /** Installs constructor-time plugins synchronously or throws before the host escapes. */
  protected useSync<TViewPlugins extends readonly IPluginConstraint<any>[]>(
    plugins: readonly IPluginConstraint<any>[]
  ): IPluginHandleTuple<TViewPlugins> {
    return this.#mutations.useSync<TViewPlugins>(plugins)
  }

  /** Stable config facade; each read/update still checks current Host and registration state. */
  get config(): IPluginHostConfigFor<TInstalled> {
    return this.#context.configRuntime.getFacade()
  }

  /** Plans dependency-safe removal without revoking registrations or changing revision. */
  unUse(
    name: string,
    options: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun: true }>
  ): Promise<IPluginDependencyPlan>
  /**
   * Removes according to default reject, cascade or suspend policy; returns actual affected
   * changes.
   */
  unUse(
    name: string,
    options?: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun?: false }>
  ): Promise<IPluginRemoval>
  unUse(
    name: string,
    options: IPluginDependencyMutationOptions = {}
  ): Promise<IPluginRemoval | IPluginDependencyPlan> {
    return this.#mutations.unUse(name, options)
  }

  /**
   * Closes admission immediately, signals running stages and returns the same Promise on every
   * call. Default runtime cleanup returns logicalTerminal/cleanupErrors; incomplete physical work
   * is exposed through physicalCompletion rather than treated as forcibly stopped. Cleanup failure
   * does not reopen the Host. Functional defineHost middleware can separately reject its chain.
   */
  dispose(): Promise<import('./plugin-lifecycle-types.ts').IPluginHostDisposalResult> {
    return this.#context.hostDisposalRuntime.dispose()
  }
}

/** Set up the optional native disposal method only when the public constructor is retained. */
function initializePluginHost(): typeof PluginHostConstructor {
  /** Keep constructor reflection stable for consumers and diagnostic tooling. */
  const name = HostReflection.constructorName
  Object.defineProperty(PluginHostConstructor, HostReflection.name, {
    configurable: true,
    value: name
  })
  if (asyncDisposeKey !== undefined)
    Object.defineProperty(PluginHostConstructor.prototype, asyncDisposeKey, {
      configurable: true,
      value(this: PluginHost<object, unknown>) {
        return this.dispose()
      }
    })
  return PluginHostConstructor
}

/** Public constructor keeps its generic axes while unused applications can discard setup. */
export const PluginHost = /* @__PURE__ */ initializePluginHost()
/** Instance type preserves the implementation's exact lifecycle and private-state identity. */
export type PluginHost<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  TPipelines extends IPipelineDefinitions = Record<never, never>
> = PluginHostConstructor<TDomainCore, TValue, TInstalled, TPipelines>
