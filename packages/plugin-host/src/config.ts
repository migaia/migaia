import type { IPluginConfig } from './typing';

const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);

/** Validate and shallow-copy a plain data record used by config/shared values. */
export const readPlainDataRecord = (
  value: unknown,
  label: string,
  rejectDangerousKeys = true,
  rejectSymbolKeys = false
): Record<PropertyKey, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${label} must be a plain object`);
  const result = Object.create(null) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (rejectSymbolKeys && typeof key === 'symbol')
      throw new TypeError(`${label} symbol keys are not allowed`);
    if (rejectDangerousKeys && typeof key === 'string' && dangerousKeys.has(key))
      throw new TypeError(`${label} key "${key}" is not allowed`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor))
      throw new TypeError(`${label} properties must be data properties`);
    if (descriptor.enumerable) result[key] = descriptor.value;
  }
  return result;
};

/** Return a one-level config snapshot; nested values intentionally retain identity. */
export const copyConfig = (config: IPluginConfig, validationLabel?: string): IPluginConfig =>
  readPlainDataRecord(config, validationLabel ?? 'config', true, true);

/** Parse `key.[0].nested` paths without accepting prototype-related segments. */
export const parseConfigPath = (path: string): string[] => {
  if (typeof path !== 'string' || path.length === 0)
    throw new TypeError('config path must be a non-empty string');
  const segments: string[] = [];
  for (const part of path.split('.')) {
    if (part.length === 0) throw new TypeError('config path contains an empty segment');
    const match = /^\[(\d+)\]$/.exec(part);
    const segment = match ? match[1] : part;
    if (!segment || dangerousKeys.has(segment))
      throw new TypeError(`config path key "${segment}" is not allowed`);
    if (!match && (segment.includes('[') || segment.includes(']')))
      throw new TypeError(`config path segment "${segment}" is invalid`);
    segments.push(segment);
  }
  if (segments.length < 2) throw new TypeError('config path must target a nested value');
  return segments;
};

/** Read one nested config value and shallow-copy it when the value is a plain object. */
export const readConfigPath = (config: IPluginConfig, segments: readonly string[]): unknown => {
  let current: unknown = config;
  for (const segment of segments.slice(1)) {
    if (current === null || (typeof current !== 'object' && typeof current !== 'function'))
      return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  if (current !== null && typeof current === 'object' && !Array.isArray(current))
    return readPlainDataRecord(current, 'config value', false, false);
  if (Array.isArray(current)) return current.slice();
  return current;
};
