import { createPluginHostTypeError } from './error-text.js'
import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPluginConfig,
  IPluginResource,
  IPluginHostCore,
  IPluginOperationContext,
  IPluginRegistrationContext,
  IReadonlyConfig,
  IPipelineMode,
  ISyncPipelineStage
} from './typing.js'
import {
  adaptSyncStageToAsync,
  adaptSyncStageToAsyncGenerator,
  adaptSyncStageToGenerator
} from './pipeline.js'
import type { IRegistration } from './registry.js'
import { PluginHostPipelineMode, type IPluginHostPipelineViolation } from './state-constants.js'

export type IPluginCoreContext<TDomainCore extends object, TValue> = {
  readonly registration: IRegistration<TDomainCore, TValue>
  readonly createDomainCore: () => TDomainCore
  readonly assertRegistrationValid: () => void
  readonly getShared: (key: PropertyKey) => unknown
  readonly pipelineMode: () => IPipelineMode
  readonly onPipelineViolation: (kind: IPluginHostPipelineViolation) => void
  readonly registerResource: (resource: IPluginResource) => void
  readonly registerStage: (stage: Function, kind: IPipelineMode) => void
  readonly operation: () => IPluginOperationContext
  readonly lifecycle: () => IPluginRegistrationContext
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
    'getShared',
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
  define('getShared', (key: PropertyKey) => {
    context.assertRegistrationValid()
    return context.getShared(key)
  })
  define('onDispose', (resource: IPluginResource) => context.registerResource(resource))
  define('usePipeline', (stage: ISyncPipelineStage<TValue>) => {
    const mode = context.pipelineMode()
    if (mode === PluginHostPipelineMode.sync) context.registerStage(stage, mode)
    else if (mode === PluginHostPipelineMode.async)
      context.registerStage(adaptSyncStageToAsync(stage, context.onPipelineViolation), mode)
    else if (mode === PluginHostPipelineMode.generator)
      context.registerStage(adaptSyncStageToGenerator(stage, context.onPipelineViolation), mode)
    else
      context.registerStage(
        adaptSyncStageToAsyncGenerator(stage, context.onPipelineViolation),
        mode
      )
    return facade
  })
  define('useAsyncPipeline', (stage: IAsyncPipelineStage<TValue>) => {
    context.registerStage(stage, PluginHostPipelineMode.async)
    return facade
  })
  define('useGeneratorPipeline', (stage: IGeneratorPipelineStage<TValue>) => {
    context.registerStage(stage, PluginHostPipelineMode.generator)
    return facade
  })
  define('useAsyncGeneratorPipeline', (stage: IAsyncGeneratorPipelineStage<TValue>) => {
    context.registerStage(stage, PluginHostPipelineMode.asyncGenerator)
    return facade
  })
  return facade as TDomainCore & IPluginHostCore<TValue>
}
