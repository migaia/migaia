import type { IPluginConfig } from './typing';

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
    if (
      rejectDangerousKeys &&
      typeof key === 'string' &&
      (key === '__proto__' || key === 'constructor' || key === 'prototype')
    )
      throw new TypeError(`${label} key "${key}" is not allowed`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor))
      throw new TypeError(`${label} properties must be data properties`);
    if (descriptor.enumerable) result[key] = descriptor.value;
  }
  return result;
};

const cloneConfigValue = (
  value: unknown,
  seen = new WeakMap<object, unknown>(),
  validationLabel?: string
): unknown => {
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing) return existing;
    const result: unknown[] = [];
    seen.set(value, result);
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor))
        throw new TypeError('config nested properties must be data properties');
      if (!descriptor.enumerable) continue;
      if (validationLabel && typeof key === 'symbol')
        throw new TypeError(`${validationLabel} symbol keys are not allowed`);
      if (
        validationLabel &&
        typeof key === 'string' &&
        (key === '__proto__' || key === 'constructor' || key === 'prototype')
      )
        throw new TypeError(`${validationLabel} key "${key}" is not allowed`);
      Object.defineProperty(result, key, {
        ...descriptor,
        value: cloneConfigValue(descriptor.value, seen, validationLabel)
      });
    }
    return result;
  }
  if (value === null || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const existing = seen.get(value);
  if (existing) return existing;
  const result: Record<PropertyKey, unknown> = Object.create(prototype);
  seen.set(value, result);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor))
      throw new TypeError('config nested properties must be data properties');
    if (!descriptor.enumerable) continue;
    if (validationLabel && typeof key === 'symbol')
      throw new TypeError(`${validationLabel} symbol keys are not allowed`);
    if (
      validationLabel &&
      typeof key === 'string' &&
      (key === '__proto__' || key === 'constructor' || key === 'prototype')
    )
      throw new TypeError(`${validationLabel} key "${key}" is not allowed`);
    Object.defineProperty(result, key, {
      ...descriptor,
      value: cloneConfigValue(descriptor.value, seen, validationLabel)
    });
  }
  return result;
};

/** Clone plain nested config data while preserving functions and non-plain values by reference. */
export const copyConfig = (config: IPluginConfig, validationLabel?: string): IPluginConfig => {
  if (validationLabel && (config === null || typeof config !== 'object' || Array.isArray(config)))
    throw new TypeError(`${validationLabel} must be a plain object`);
  if (validationLabel) {
    const prototype = Object.getPrototypeOf(config);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError(`${validationLabel} must be a plain object`);
  }
  return cloneConfigValue(config, new WeakMap<object, unknown>(), validationLabel) as IPluginConfig;
};
