import type { IPluginDisposer, IPluginResource } from './typing';

export const asyncDisposeKey = (Symbol as typeof Symbol & { asyncDispose?: symbol }).asyncDispose;
export const disposeKey = (Symbol as typeof Symbol & { dispose?: symbol }).dispose;

export const resolveDisposer = (resource: IPluginResource): IPluginDisposer | undefined => {
  if (typeof resource === 'function') return resource;
  if (resource && typeof resource === 'object') {
    const candidate = resource as Record<PropertyKey, unknown>;
    const asyncDispose = asyncDisposeKey === undefined ? undefined : candidate[asyncDisposeKey];
    if (typeof asyncDispose === 'function')
      return () =>
        (candidate as Record<PropertyKey, () => void | Promise<void>>)[asyncDisposeKey!]();
    const dispose = disposeKey === undefined ? undefined : candidate[disposeKey];
    if (typeof dispose === 'function')
      return () => (candidate as Record<PropertyKey, () => void>)[disposeKey!]();
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
