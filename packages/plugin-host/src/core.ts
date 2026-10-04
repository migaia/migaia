import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
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
  readonly facade: TFacade
  /** An absent target returns undefined; duplicated instance identity returns null. */
  find(target: string): object | null | undefined
  values(): readonly object[]
  /** Withdraw only this exact ready contribution; the live registration retains its shared slot. */
  contribute(value: object, instanceId: string): () => void
}>

/** Cold Feature inventory retains original guards and can resolve the current named output. */
export type IPluginRuntimeFeatureSnapshot = Readonly<{
  readonly outputs: Readonly<Record<string, object>>
  assertCurrent(feature: string): void
  /** Recheck connection and Feature availability through the original Host handle on each call. */
  readCurrent(feature: string): object
}>

/** A canonical install core exposes only Host identity, Feature reads and shared publication. */
export type IPluginRuntimeIntegration = Readonly<{
  readonly identity: Readonly<{ name: string; id: string }>
  /** Query only the original managed-host authority; this confers no mutation permission. */
  matchesHost(host: object): boolean
  /** Reuse original Host/registration admission for explicitly exposed reserved controls. */
  assertCurrent(): void
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

/** Reject structural lookalikes; only the core actually minted for this install gets the port. */
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
  readonly operation: () => IPluginOperationContext
  readonly lifecycle: () => IPluginRegistrationContext
  readonly runtimeIntegration: () => IPluginRuntimeIntegration
}

export const createPluginCore = <TDomainCore extends object, TValue>(
  context: IPluginCoreContext<TDomainCore, TValue>
): TDomainCore & IPluginHostCore<TValue> => {
  const domainCore = context.createDomainCore() as object
  const prototype = Object.getPrototypeOf(domainCore)
  if (prototype !== Object.prototype && prototype !== null)
    throw createPluginHostTypeError('domain core must be a plain object')
  const reservedKeys = new Set<PropertyKey>([
    'config',
    'operation',
    'lifecycle',
    'onDispose',
    'usePipeline',
    'useAsyncPipeline',
    'useGeneratorPipeline',
    'useAsyncGeneratorPipeline'
  ])
  const facade: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(domainCore)) {
    if (reservedKeys.has(key))
      throw createPluginHostTypeError(`domain core key "${String(key)}" is reserved`)
    const descriptor = Object.getOwnPropertyDescriptor(domainCore, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw createPluginHostTypeError('domain core must contain enumerable data properties')
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
  runtimeIntegrations.set(facade, context.runtimeIntegration())
  return facade as TDomainCore & IPluginHostCore<TValue>
}
