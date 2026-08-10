import ERROR_TEXT, { PluginHostError } from './error-text';
import { asyncDisposeKey, disposeKey } from './disposal';

/** Validate extension container before Host-specific descriptor mounting. */
export const assertExtensionResult = (extension: unknown, pluginName: string): object => {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension))
    throw new TypeError('plugin install() must return an object');
  const prototype = Object.getPrototypeOf(extension);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('plugin install() must return a plain object');
  for (const key of Reflect.ownKeys(extension)) {
    if (
      key === 'then' ||
      (asyncDisposeKey !== undefined && key === asyncDisposeKey) ||
      (disposeKey !== undefined && key === disposeKey)
    )
      throw new PluginHostError(
        'EXTENSION_RESERVED',
        ERROR_TEXT.EXTENSION_RESERVED(pluginName, key)
      );
  }
  return extension;
};
