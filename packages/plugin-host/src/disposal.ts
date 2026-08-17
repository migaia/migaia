import type { IPluginDisposer, IPluginResource } from './typing.js';
import { asyncDisposeKey, asyncDisposeKeys, disposeKey, disposeKeys } from './symbols.js';

export { asyncDisposeKey, disposeKey };

export const resolveDisposer = (resource: IPluginResource): IPluginDisposer | undefined => {
  if (typeof resource === 'function') return resource;
  if (resource && typeof resource === 'object') {
    const candidate = resource as Record<PropertyKey, unknown>;
    for (const key of asyncDisposeKeys) {
      if (typeof candidate[key] === 'function')
        return () => (candidate as Record<PropertyKey, () => void | Promise<void>>)[key]();
    }
    for (const key of disposeKeys) {
      if (typeof candidate[key] === 'function')
        return () => (candidate as Record<PropertyKey, () => void>)[key]();
    }
  }
  return undefined;
};

export const aggregateErrors = (errors: unknown[], message: string): void => {
  if (errors.length === 0) return;
  if (errors.length === 1) {
    const cause = errors[0];
    throw new Error(message, { cause });
  }
  throw new AggregateError(errors, message);
};
