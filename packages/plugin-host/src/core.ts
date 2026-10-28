/**
 * Owns canonical install-core construction and provenance; domain state remains with its
 * registration.
 */
import ERROR_TEXT, {
  PluginHostError,
  createPluginHostTypeError,
  PluginHostInternalText
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import {
  MiddlewarePipelineMode,
  type IAsyncGeneratorMiddlewareStage,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IMiddlewarePipelineMode,
  type ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'
import type {
  IPluginConfig,
  IPluginResource,
  IPluginOperationContext,
  IPluginRegistrationContext,
  IReadonlyConfig
} from './plugin-lifecycle-types.js'
import type { IPluginHostCore } from './plugin-core-types.js'
import { PluginCoreKey } from './core-constants.js'
import type { IRegistration } from './registry.js'

/** Registration-scoped publication stages exact receipts in the original install batch. */
export type IPluginRuntimeSharedSlot<TFacade extends object = object> = Readonly<{
  /** One stable facade for this Host key/family, created by its canonical extension owner. */
  readonly facade: TFacade
  /** An absent target returns undefined; duplicated instance identity returns null. */
  find(target: string): object | null | undefined
  /** Snapshot of current ready contributions, separate from cold registration inventory. */
  values(): readonly object[]
  /**
   * Cold inventory reads every committed reservation, including registrations without ready
   * sessions.
   */
  registered(): readonly object[]
  /** Annotates this exact original reservation; metadata is published only with its install commit. */
  register(value: object, onCommit?: () => void): void
  /** Withdraw only this exact ready contribution; the live registration retains its shared slot. */
  contribute(value: object, instanceId: string): () => void
}>

/** Cold Feature inventory retains original guards and can resolve the current named output. */
export type IPluginRuntimeFeatureSnapshot = Readonly<{
  /** Captured frozen root map; output objects retain their original identities. */
  readonly outputs: Readonly<Record<string, object>>
  /** Verifies the captured provider generation/output and the calling core's current availability. */
  assertCurrent(feature: string): void
  /** Recheck connection and Feature availability through the original Host handle on each call. */
  readCurrent(feature: string): object
}>

/** A canonical install core exposes only Host identity, Feature reads and shared publication. */
export type IPluginRuntimeIntegration = Readonly<{
  /** Immutable issuing Host identity; it does not itself confer Host mutation authority. */
  readonly identity: Readonly<{
    /** Issuing Host's caller label, defaulting to DEFAULT. */
    name: string
    /** Module-issued local identifier; the label alone does not establish identity. */
    id: string
  }>
  /** One private runtime node fact is shared by every adapter installed on this Host. */
  readonly nodeId: string
  /** Borrow the configured Host diagnostic outlet; absence preserves the receiving domain's default. */
  readonly report?: (error: unknown) => void
  /** Query only the original managed-host authority; this confers no mutation permission. */
  matchesHost(host: object): boolean
  /**
   * Register one synchronous domain-owned removal predicate during this exact install. False
   * rejects explicit removal/replacement before mutation; full disposal and rollback bypass it.
   */
  allowRemovalWhen(allowed: () => boolean): void
  /** Reuse original Host/registration admission for explicitly exposed reserved controls. */
  assertCurrent(): void
  /**
   * Admit this exact prepared registration while its original batch has a current install, or reuse
   * ordinary published admission. This grants no install, resource, or mutation authority.
   */
  assertPreparedRegistration(): void
  /** Read an already committed facade without acquiring ownership or creating another slot. */
  readSharedExtension(key: PropertyKey): object | undefined
  /**
   * Acquires one canonical key/family slot during this core's original uncommitted install only.
   * Conflicting keys/families fail admission; later calls cannot create a parallel publication.
   */
  acquireSharedSlot<TFacade extends object>(
    key: PropertyKey,
    family: object,
    create: (slot: IPluginRuntimeSharedSlot<TFacade>) => TFacade
  ): IPluginRuntimeSharedSlot<TFacade>
  /** Capture the cold inventory once; availability remains a per-call Host decision. */
  readFeatureOutputs(name: string): IPluginRuntimeFeatureSnapshot
}>

/** This weak table proves core provenance only; canonical Host state owns slots and registrations. */
const runtimeIntegrations = new WeakMap<object, IPluginRuntimeIntegration>()

/**
 * Reads the canonical integration port from a core minted by this package instance. Adapters use it
 * to reuse Host-owned publication and Feature guards; it creates no new Host or registry.
 * Structural copies, forged objects and other package instances fail with
 * PLUGIN_DEFINITION_INVALID.
 */
export function getPluginRuntimeIntegration(core: unknown): IPluginRuntimeIntegration {
  /** Arbitrary fields and copied descriptors never establish package provenance. */
  const integration =
    typeof core === 'object' && core !== null ? runtimeIntegrations.get(core) : undefined
  if (!integration)
    throw new PluginHostError(
      PluginHostErrorCode.pluginDefinitionInvalid,
      ERROR_TEXT.PLUGIN_DEFINITION_INVALID
    )
  return integration
}

export type IPluginCoreContext<TDomainCore extends object, TValue> = {
  readonly registration: IRegistration<TDomainCore, TValue>
  readonly createDomainCore: () => TDomainCore
  readonly assertRegistrationValid: () => void
  readonly registerResource: (resource: IPluginResource) => void
  readonly registerStage: (stage: Function, kind: IMiddlewarePipelineMode) => void
  /** This install core can register named stages but never receives execution authority. */
  readonly pipeline: (name: string) => object
  readonly operation: () => IPluginOperationContext
  readonly lifecycle: () => IPluginRegistrationContext
  readonly runtimeIntegration: () => IPluginRuntimeIntegration
}

/** Core members the Host defines; a domain core may not supply any of them. */
const reservedCoreKeys: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  PluginCoreKey.config,
  PluginCoreKey.operation,
  PluginCoreKey.lifecycle,
  PluginCoreKey.onDispose,
  PluginCoreKey.usePipeline,
  PluginCoreKey.useAsyncPipeline,
  PluginCoreKey.useGeneratorPipeline,
  PluginCoreKey.useAsyncGeneratorPipeline,
  PluginCoreKey.pipeline
])

/** Owns one core surface while keeping all registration state in its explicit context. */
export class PluginCoreSurface<TDomainCore extends object, TValue> {
  /** Exact registration authority supplied by the core runtime. */
  readonly #context: IPluginCoreContext<TDomainCore, TValue>
  /** Original plain, extensible facade returned to domain hooks. */
  readonly #facade: Record<PropertyKey, unknown> = {}

  /** Validates the domain surface before publishing any canonical Host capabilities. */
  constructor(context: IPluginCoreContext<TDomainCore, TValue>) {
    this.#context = context
    this.#copyDomainCore()
    this.#defineCapabilities()
    runtimeIntegrations.set(this.#facade, context.runtimeIntegration())
  }

  /** Returns the exact original facade; fluent capabilities always return this same object. */
  get facade(): TDomainCore & IPluginHostCore<TValue> {
    return this.#facade as TDomainCore & IPluginHostCore<TValue>
  }

  /** Captures enumerable data descriptors without invoking accessors or accepting reserved keys. */
  #copyDomainCore(): void {
    /** Domain fields retain their captured descriptors rather than being read through getters. */
    const domainCore = this.#context.createDomainCore() as object
    /** Only ordinary or null-prototype domain surfaces participate in core construction. */
    const prototype = Object.getPrototypeOf(domainCore)
    if (prototype !== Object.prototype && prototype !== null)
      throw createPluginHostTypeError(PluginHostInternalText.DOMAIN_CORE_OBJECT)
    for (const key of Reflect.ownKeys(domainCore)) {
      if (reservedCoreKeys.has(key))
        throw createPluginHostTypeError(PluginHostInternalText.DOMAIN_CORE_RESERVED(key))
      /** Admission copies the descriptor unchanged after excluding accessors and hidden keys. */
      const descriptor = Object.getOwnPropertyDescriptor(domainCore, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        throw createPluginHostTypeError(PluginHostInternalText.DOMAIN_CORE_DATA)
      Object.defineProperty(this.#facade, key, descriptor)
    }
  }

  /** Installs the existing own-property surface; small adapters preserve detached method calls. */
  #defineCapabilities(): void {
    this.#define(PluginCoreKey.config, {
      get: <T extends IPluginConfig = IPluginConfig>() => this.#readConfig<T>()
    })
    Object.defineProperty(this.#facade, PluginCoreKey.operation, {
      enumerable: true,
      configurable: false,
      get: () => this.#readOperation()
    })
    Object.defineProperty(this.#facade, PluginCoreKey.lifecycle, {
      enumerable: true,
      configurable: false,
      get: () => this.#readLifecycle()
    })
    this.#define(PluginCoreKey.onDispose, (resource: IPluginResource) =>
      this.#context.registerResource(resource)
    )
    this.#define(PluginCoreKey.usePipeline, (stage: ISyncMiddlewareStage<TValue>) =>
      this.#registerStage(stage, MiddlewarePipelineMode.sync)
    )
    this.#define(PluginCoreKey.useAsyncPipeline, (stage: IAsyncMiddlewareStage<TValue>) =>
      this.#registerStage(stage, MiddlewarePipelineMode.async)
    )
    this.#define(PluginCoreKey.useGeneratorPipeline, (stage: IGeneratorMiddlewareStage<TValue>) =>
      this.#registerStage(stage, MiddlewarePipelineMode.generator)
    )
    this.#define(
      PluginCoreKey.useAsyncGeneratorPipeline,
      (stage: IAsyncGeneratorMiddlewareStage<TValue>) =>
        this.#registerStage(stage, MiddlewarePipelineMode.asyncGenerator)
    )
    this.#define(PluginCoreKey.pipeline, (name: string) => this.#context.pipeline(name))
  }

  /** Defines mutable enumerable capabilities with their original property attributes. */
  #define(key: PropertyKey, value: unknown): void {
    Object.defineProperty(this.#facade, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }

  /** Reads the current immutable config only after original registration admission succeeds. */
  #readConfig<T extends IPluginConfig>(): IReadonlyConfig<T> {
    this.#context.assertRegistrationValid()
    return this.#context.registration.config as IReadonlyConfig<T>
  }

  /** Each read freezes the original operation snapshot without caching across hook attempts. */
  #readOperation(): IPluginOperationContext {
    return Object.freeze(this.#context.operation())
  }

  /** Registration lifetime snapshots remain independent from per-operation cancellation. */
  #readLifecycle(): IPluginRegistrationContext {
    return Object.freeze(this.#context.lifecycle())
  }

  /** Owns fluent registration routing without changing the canonical stage admission path. */
  #registerStage(stage: Function, kind: IMiddlewarePipelineMode): Record<PropertyKey, unknown> {
    this.#context.registerStage(stage, kind)
    return this.#facade
  }
}
