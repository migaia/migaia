import { createPluginHostTypeError } from './error-text.js'
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

export type IPluginCoreContext<TDomainCore extends object, TValue> = {
  readonly registration: IRegistration<TDomainCore, TValue>
  readonly createDomainCore: () => TDomainCore
  readonly assertRegistrationValid: () => void
  readonly registerResource: (resource: IPluginResource) => void
  readonly registerStage: (stage: Function, kind: IMiddlewarePipelineMode) => void
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
  return facade as TDomainCore & IPluginHostCore<TValue>
}
