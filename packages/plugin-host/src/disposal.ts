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

/**
 * Detects the resource shapes that useSync's synchronous rollback contract cannot honor: an async
 * function starts running the instant it is called, and Symbol.asyncDispose is by definition a
 * promise-returning protocol — both mean the disposer's side effect is already in flight before
 * useSync's rollback path could reject it. This is a heuristic, not exhaustive: a plain function
 * that happens to return a Promise at runtime (without being declared `async`) cannot be detected
 * ahead of the call. It only needs to catch the declared, common cases.
 */
export const isLikelyAsyncDisposer = (resource: IPluginResource): boolean => {
  if (typeof resource === 'function') return resource.constructor.name === 'AsyncFunction';
  if (resource && typeof resource === 'object') {
    const candidate = resource as Record<PropertyKey, unknown>;
    if (asyncDisposeKey !== undefined && typeof candidate[asyncDisposeKey] === 'function')
      return true;
  }
  return false;
};

export const aggregateErrors = (errors: unknown[], message: string): void => {
  if (errors.length === 0) return;
  if (errors.length === 1) {
    const cause = errors[0];
    throw new Error(message, { cause });
  }
  throw new AggregateError(errors, message);
};
