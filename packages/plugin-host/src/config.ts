import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { parseConfigPath as parseUtilsConfigPath } from '@migaia/utils/config'
import type { IPluginConfig } from './typing.js'

const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype'])
export const readPlainDataRecord = (
  value: unknown,
  label: string,
  rejectDangerousKeys = true,
  rejectSymbolKeys = false
): Record<PropertyKey, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw createPluginHostTypeError(`${label} must be a plain object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    throw createPluginHostTypeError(`${label} must be a plain object`)
  const result = Object.create(null) as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(value)) {
    if (rejectSymbolKeys && typeof key === 'symbol')
      throw createPluginHostTypeError(`${label} symbol keys are not allowed`)
    if (rejectDangerousKeys && typeof key === 'string' && dangerousKeys.has(key))
      throw createPluginHostTypeError(`${label} key "${key}" is not allowed`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor))
      throw createPluginHostTypeError(`${label} properties must be data properties`)
    if (descriptor.enumerable) result[key] = descriptor.value
  }
  return result
}
/**
 * 抛出配置准入失败。
 *
 * 显式标注为返回 `never` 的函数类型，而不是只在箭头函数上写 `: never`：TypeScript 只对带显式类型 标注的
 * const（或函数声明）做「调用即终止」的控制流收窄，缺了标注时每个 `reject(...)` 之后的分支 仍被当作可达，调用点就要为已经被拒绝的值再写一次空值判断。
 */
const reject: (code: keyof typeof PluginHostErrorCode, path: string, reason: string) => never = (
  code,
  path,
  reason
) => {
  throw new PluginHostError(
    PluginHostErrorCode[code],
    code === 'configCycleRejected'
      ? ERROR_TEXT.CONFIG_CYCLE_REJECTED(path)
      : ERROR_TEXT.INVALID_CONFIG_VALUE(path, reason),
    { detail: { path, reason } }
  )
}
const assertValue = (value: unknown, path: string, seen: WeakSet<object>): void => {
  if (value === null || typeof value === 'function') return
  if (typeof value !== 'object') {
    if (typeof value === 'symbol') reject('invalidConfigValue', path, 'symbol')
    return
  }
  if (seen.has(value)) reject('configCycleRejected', path, 'cycle')
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    reject('invalidConfigValue', path, 'prototype')
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    if (array && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)))
      reject('invalidConfigValue', path, 'array-key')
    if (typeof key === 'symbol') reject('invalidConfigValue', path, 'key')
    if (typeof key === 'string' && dangerousKeys.has(key)) reject('invalidConfigValue', path, 'key')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      reject('invalidConfigValue', path ? `${path}.${String(key)}` : String(key), 'descriptor')
    if (key === 'then' && typeof descriptor.value === 'function')
      reject('invalidConfigValue', path ? `${path}.${String(key)}` : String(key), 'thenable')
    assertValue(descriptor.value, path ? `${path}.${String(key)}` : String(key), seen)
  }
  seen.delete(value)
}
const own = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return Object.freeze(value.map(own))
  const target = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(value))
    target[key] = own((value as Record<PropertyKey, unknown>)[key])
  return Object.freeze(target)
}
export const copyConfig = (config: IPluginConfig, label = 'config'): IPluginConfig => {
  assertValue(config, '', new WeakSet())
  const record = readPlainDataRecord(config, label, true, true)
  return own(record) as IPluginConfig
}
export const copyConfigWithPatch = (
  base: IPluginConfig,
  patch: Record<PropertyKey, unknown>
): IPluginConfig => {
  const record = readPlainDataRecord(patch, 'plugin config patch', true, true)
  for (const key of Reflect.ownKeys(record)) assertValue(record[key], String(key), new WeakSet())
  const target = Object.create(null) as Record<PropertyKey, unknown>
  // `Reflect.ownKeys` 的静态类型是 `(string | symbol)[]`，而 `IPluginConfig` 只有字符串键；
  // 符号键在 `assertValue` 就已被拒绝，这里按更宽的键类型读取，运行期行为不变。
  for (const key of Reflect.ownKeys(base)) target[key] = (base as Record<PropertyKey, unknown>)[key]
  for (const key of Reflect.ownKeys(record)) target[key] = own(record[key])
  return Object.freeze(target) as IPluginConfig
}
export const parseConfigPath = (path: string): string[] => {
  try {
    return [...parseUtilsConfigPath(path)]
  } catch (cause) {
    throw createPluginHostTypeError('config path is invalid', { cause })
  }
}
export const readConfigPath = (config: IPluginConfig, segments: readonly string[]): unknown => {
  let current: unknown = config
  for (const segment of segments.slice(1)) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
