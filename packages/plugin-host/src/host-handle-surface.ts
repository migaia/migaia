/**
 * Owns functional Host callables and descriptor materialization; keeps the public handle a plain
 * frozen surface behind its original proxy.
 */
import type { IPipelineDefinitions } from './pipeline-spec.ts'

import type {
  IAsyncGeneratorMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type {
  IPluginRemoval,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan
} from './plugin-handle-types.ts'

import type { IDefineHostOptions, IHostCoreConstructionRequest } from './define-host.ts'
import { HostSurfaceKey, HostReflection, hostAccessorName } from './host-constants.ts'
import { DefinedHostRuntime, DefinedHostDisposal } from './defined-host-runtime.ts'

/** The original proxy identity becomes available only after its plain surface exists. */
export type IHandleReference = { handle: object | undefined }

/** Owns bound callables; getters and method descriptors are materialized as original own properties. */
export class DefinedHostSurface<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
> {
  /** Canonical runtime retaining all installation and pipeline ownership. */
  readonly #runtime: DefinedHostRuntime<TDomainCore, TValue, TInstalled, TPipelines>
  /** Fluent return target is the exact public proxy. */
  readonly #reference: IHandleReference
  /** Disposal middleware and canonical cleanup share the original singleflight owner. */
  readonly #disposal: DefinedHostDisposal
  /** Captures explicit owners without constructing a closure-based component. */
  constructor(
    runtime: DefinedHostRuntime<TDomainCore, TValue, TInstalled, TPipelines>,
    options: IDefineHostOptions<TDomainCore, any, TPipelines>,
    reference: IHandleReference
  ) {
    this.#runtime = runtime
    this.#reference = reference
    this.#disposal = new DefinedHostDisposal(runtime, options.dispose)
  }
  /** Revision reads retain the original runtime property access. */
  readonly #readRevision = () => this.#runtime.revision
  /** Pipeline mode admission stays with the canonical Host. */
  readonly #readPipelineMode = () => this.#runtime.pipelineMode
  /** Config reads keep the stable config facade. */
  readonly #readConfig = () => this.#runtime.config
  /** Availability reads keep the same frozen facade. */
  readonly #readPlugin = () => this.#runtime.plugin
  /** Construction-time installation retains the original protected owner entry. */
  readonly useSync = (...plugins: readonly IPluginConstraint<any>[]) =>
    this.#runtime.useSyncPublic(plugins)
  /** Async installation returns the exact original transaction Promise. */
  readonly use = (...plugins: readonly IPluginConstraint<any>[]) =>
    this.#runtime.use(...(plugins as [IPluginConstraint<any>]))
  /** Literal dry-run forms select the same original removal overload. */
  readonly unUse = (
    name: string,
    mutationOptions?: IPluginDependencyMutationOptions
  ): Promise<IPluginRemoval | IPluginDependencyPlan> =>
    mutationOptions?.dryRun === true
      ? this.#runtime.unUse(name, { ...mutationOptions, dryRun: true })
      : this.#runtime.unUse(name, { ...mutationOptions, dryRun: false })
  /** Lazy activation preserves canonical coalescing and Promise identity. */
  readonly activate = (name: string) => this.#runtime.activate(name)
  /** Replacement remains name-addressed through the native transaction. */
  readonly replace = (name: string, next: IPluginConstraint<any>) =>
    this.#runtime.replace(name, next)
  /** Adds a sync stage and returns the exact public handle. */
  readonly usePipeline = (stage: ISyncMiddlewareStage<TValue>) => {
    this.#runtime.usePipeline(stage)
    return this.#reference.handle
  }
  /** Adds an async stage and returns the exact public handle. */
  readonly useAsyncPipeline = (stage: IAsyncMiddlewareStage<TValue>) => {
    this.#runtime.useAsyncPipeline(stage)
    return this.#reference.handle
  }
  /** Adds a generator stage and returns the exact public handle. */
  readonly useGeneratorPipeline = (stage: IGeneratorMiddlewareStage<TValue>) => {
    this.#runtime.useGeneratorPipeline(stage)
    return this.#reference.handle
  }
  /** Adds an async-generator stage and returns the exact public handle. */
  readonly useAsyncGeneratorPipeline = (stage: IAsyncGeneratorMiddlewareStage<TValue>) => {
    this.#runtime.useAsyncGeneratorPipeline(stage)
    return this.#reference.handle
  }
  /** Execution authority remains with the original owner entry. */
  readonly pipeline = (name: string, request?: IHostCoreConstructionRequest) =>
    this.#runtime.pipelinePublic(name, request)
  /** Selected-mode execution retains its return identity. */
  readonly runPipeline = (value: TValue, done: (value: TValue) => void) =>
    this.#runtime.runPipelinePublic(value, done)
  /** Synchronous traversal retains its original terminal value. */
  readonly runPipelineSync = <TResult>(value: TValue, done: (value: TValue) => TResult) =>
    this.#runtime.runPipelineSyncPublic(value, done)
  /** Empty asynchronous traversal retains the terminal Promise. */
  readonly runPipelineAsync = <TResult>(value: TValue, done: (value: TValue) => Promise<TResult>) =>
    this.#runtime.runPipelineAsyncPublic(value, done)
  /** Materializes only original public own properties, in their original enumeration order. */
  createSurface(): Record<PropertyKey, unknown> {
    /** Plain prototype and descriptor flags match the original object literal before freezing. */
    const surface: Record<PropertyKey, unknown> = {}
    // Four fixed getter entries preserve the original accessor reflection names.
    Object.defineProperty(this.#readRevision, HostReflection.name, {
      configurable: true,
      value: hostAccessorName(HostSurfaceKey.revision)
    })
    Object.defineProperty(this.#readPipelineMode, HostReflection.name, {
      configurable: true,
      value: hostAccessorName(HostSurfaceKey.pipelineMode)
    })
    Object.defineProperty(this.#readConfig, HostReflection.name, {
      configurable: true,
      value: hostAccessorName(HostSurfaceKey.config)
    })
    Object.defineProperty(this.#readPlugin, HostReflection.name, {
      configurable: true,
      value: hostAccessorName(HostSurfaceKey.plugin)
    })
    Object.defineProperties(surface, {
      revision: { enumerable: true, configurable: true, get: this.#readRevision },
      pipelineMode: { enumerable: true, configurable: true, get: this.#readPipelineMode },
      config: { enumerable: true, configurable: true, get: this.#readConfig },
      plugin: { enumerable: true, configurable: true, get: this.#readPlugin }
    })
    Object.assign(surface, {
      useSync: this.useSync,
      use: this.use,
      unUse: this.unUse,
      activate: this.activate,
      replace: this.replace,
      usePipeline: this.usePipeline,
      useAsyncPipeline: this.useAsyncPipeline,
      useGeneratorPipeline: this.useGeneratorPipeline,
      useAsyncGeneratorPipeline: this.useAsyncGeneratorPipeline,
      pipeline: this.pipeline,
      runPipeline: this.runPipeline,
      runPipelineSync: this.runPipelineSync,
      runPipelineAsync: this.runPipelineAsync,
      dispose: this.#disposal.dispose
    })
    return surface
  }
}
