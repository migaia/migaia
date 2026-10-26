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
  IPluginHostCore,
  IPluginOperationContext,
  IPluginRegistrationContext,
  IReadonlyConfig
} from './typing.js'
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

type IPluginCoreContext<TDomainCore extends object, TValue> = {
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
  'config',
  'operation',
  'lifecycle',
  'onDispose',
  'usePipeline',
  'useAsyncPipeline',
  'useGeneratorPipeline',
  'useAsyncGeneratorPipeline',
  'pipeline'
])

export const createPluginCore = <TDomainCore extends object, TValue>(
  context: IPluginCoreContext<TDomainCore, TValue>
): TDomainCore & IPluginHostCore<TValue> => {
  const domainCore = context.createDomainCore() as object
  const prototype = Object.getPrototypeOf(domainCore)
  if (prototype !== Object.prototype && prototype !== null)
    throw createPluginHostTypeError(PluginHostInternalText.DOMAIN_CORE_OBJECT)
  const facade: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(domainCore)) {
    if (reservedCoreKeys.has(key))
      throw createPluginHostTypeError(PluginHostInternalText.DOMAIN_CORE_RESERVED(key))
    const descriptor = Object.getOwnPropertyDescriptor(domainCore, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw createPluginHostTypeError(PluginHostInternalText.DOMAIN_CORE_DATA)
    Object.defineProperty(facade, key, descriptor)
  }
  const define = (key: PropertyKey, value: unknown): void => {
    Object.defineProperty(facade, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  define('config', {
    get: <T extends IPluginConfig = IPluginConfig>() => {
      context.assertRegistrationValid()
      return context.registration.config as IReadonlyConfig<T>
    }
  })
  Object.defineProperty(facade, 'operation', {
    enumerable: true,
    configurable: false,
    get: () => Object.freeze(context.operation())
  })
  Object.defineProperty(facade, 'lifecycle', {
    enumerable: true,
    configurable: false,
    get: () => Object.freeze(context.lifecycle())
  })
  define('onDispose', (resource: IPluginResource) => context.registerResource(resource))
  define('usePipeline', (stage: ISyncMiddlewareStage<TValue>) => {
    context.registerStage(stage, MiddlewarePipelineMode.sync)
    return facade
  })
  define('useAsyncPipeline', (stage: IAsyncMiddlewareStage<TValue>) => {
    context.registerStage(stage, MiddlewarePipelineMode.async)
    return facade
  })
  define('useGeneratorPipeline', (stage: IGeneratorMiddlewareStage<TValue>) => {
    context.registerStage(stage, MiddlewarePipelineMode.generator)
    return facade
  })
  define('useAsyncGeneratorPipeline', (stage: IAsyncGeneratorMiddlewareStage<TValue>) => {
    context.registerStage(stage, MiddlewarePipelineMode.asyncGenerator)
    return facade
  })
  define('pipeline', (name: string) => context.pipeline(name))
  runtimeIntegrations.set(facade, context.runtimeIntegration())
  return facade as TDomainCore & IPluginHostCore<TValue>
}
