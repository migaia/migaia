import type {
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPluginConfig,
  IPluginResource,
  IPluginHostCore,
  IPipelineMode,
  ISyncPipelineStage
} from './typing';
import { copyConfig } from './config';
import { adaptSyncStageToAsync, adaptSyncStageToGenerator } from './pipeline';
import type { IRegistration } from './registry';

export type IPluginCoreContext<TDomainCore extends object, TValue> = {
  readonly registration: IRegistration<TDomainCore, TValue>;
  readonly createDomainCore: () => TDomainCore;
  readonly assertRegistrationValid: () => void;
  readonly getShared: (key: PropertyKey) => unknown;
  readonly pipelineMode: () => IPipelineMode;
  readonly onPipelineViolation: (kind: 'late' | 'duplicate') => void;
  readonly registerResource: (resource: IPluginResource) => void;
  readonly registerStage: (stage: Function, kind: IPipelineMode) => void;
};

export const createPluginCore = <TDomainCore extends object, TValue>(
  context: IPluginCoreContext<TDomainCore, TValue>
): TDomainCore & IPluginHostCore<TValue> => {
  const domainCore = context.createDomainCore() as object;
  const prototype = Object.getPrototypeOf(domainCore);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('domain core must be a plain object');
  const reservedKeys = new Set<PropertyKey>([
    'config',
    'getShared',
    'onDispose',
    'usePipeline',
    'useAsyncPipeline',
    'useGeneratorPipeline'
  ]);
  const facade: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(domainCore)) {
    if (reservedKeys.has(key)) throw new TypeError(`domain core key "${String(key)}" is reserved`);
    const descriptor = Object.getOwnPropertyDescriptor(domainCore, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw new TypeError('domain core must contain enumerable data properties');
    Object.defineProperty(facade, key, descriptor);
  }
  const define = (key: PropertyKey, value: unknown): void => {
    Object.defineProperty(facade, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  };
  define('config', {
    get: <T extends IPluginConfig = IPluginConfig>() => {
      context.assertRegistrationValid();
      return copyConfig(context.registration.config) as Readonly<T>;
    }
  });
  define('getShared', (key: PropertyKey) => {
    context.assertRegistrationValid();
    return context.getShared(key);
  });
  define('onDispose', (resource: IPluginResource) => context.registerResource(resource));
  define('usePipeline', (stage: ISyncPipelineStage<TValue>) => {
    const mode = context.pipelineMode();
    if (mode === 'sync') context.registerStage(stage, mode);
    else if (mode === 'async') context.registerStage(adaptSyncStageToAsync(stage), mode);
    else context.registerStage(adaptSyncStageToGenerator(stage, context.onPipelineViolation), mode);
    return facade;
  });
  define('useAsyncPipeline', (stage: IAsyncPipelineStage<TValue>) => {
    context.registerStage(stage, 'async');
    return facade;
  });
  define('useGeneratorPipeline', (stage: IGeneratorPipelineStage<TValue>) => {
    context.registerStage(stage, 'generator');
    return facade;
  });
  return facade as TDomainCore & IPluginHostCore<TValue>;
};
