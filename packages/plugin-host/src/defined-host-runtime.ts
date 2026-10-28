/**
 * Owns the functional entry's protected Host hooks and one memoized disposal result; public surface
 * descriptors belong to host-handle-surface.
 */
import type { IPipelineDefinitions } from './pipeline-spec.js'
import { identifyPluginHostCallbackFailure } from './error-text.js'
import { deferred } from '@migaia/utils/promise'
import { PluginHost } from './host-runtime.js'

import { readDefinedPluginDefinition } from './define-plugin.js'
import type { PluginHostError } from './error-text.js'

import type { IPluginConstraint } from './plugin-definition-types.js'
import type { IPluginHostDisposalResult } from './plugin-lifecycle-types.js'

import type { IDefineHostOptions, IHostCoreConstructionRequest } from './define-host.js'
/**
 * Runtime behind one functional Host. It replaces the four protected class hooks with the options'
 * callbacks and exposes the protected owner entries only to the handle created alongside it.
 */
export class DefinedHostRuntime<
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
    /** Read the user factory once and invoke it without adding a receiver. */
    const domainCore = this.#options.domainCore
    if (!domainCore) return {} as TDomainCore
    /** Stable batch identity scopes admission counters to the original install transaction. */
    const batch = request?.batch ?? this.#defaultBatch
    /** Admission numbering advances only when a domain factory actually runs. */
    const batchIndex = this.#batchCounters.get(batch) ?? 0
    this.#batchCounters.set(batch, batchIndex + 1)
    return domainCore({ pluginName: request?.pluginName ?? '', batchIndex, batch })
  }

  /** Uses the options' translator when supplied. */
  protected override translateDisposalError(error: PluginHostError): Error {
    /** The retained user translator is called receiverlessly, as in the original protected hook. */
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
export class DefinedHostDisposal {
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
  readonly dispose = (): Promise<IPluginHostDisposalResult> => this.#beginDisposal()

  /** Publishes completion before invoking middleware; both cleanup and failure adoption run once. */
  #beginDisposal(): Promise<IPluginHostDisposalResult> {
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
