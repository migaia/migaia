/** Owns plain-data config validation and immutable DAG copies; Host owns transaction publication. */
import ERROR_TEXT, {
  PluginHostError,
  createPluginHostTypeError,
  PluginHostInternalText
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { parseConfigPath as parseUtilsConfigPath } from '@migaia/utils/config'
import type { IPluginConfig } from './plugin-lifecycle-types.js'
import type { IPluginHostErrorCode } from './error-code.js'

/** Prototype-sensitive record keys are excluded by the existing config value grammar. */
const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype'])
/** Captures enumerable own data without evaluating getters or admitting custom record prototypes. */
export const readPlainDataRecord = (
  value: unknown,
  label: string,
  rejectDangerousKeys = true,
  rejectSymbolKeys = false
): Record<PropertyKey, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw createPluginHostTypeError(PluginHostInternalText.RECORD_OBJECT(label))
  /** Only the existing plain-object or array prototype is admitted at this boundary. */
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    throw createPluginHostTypeError(PluginHostInternalText.RECORD_OBJECT(label))
  /** Null-prototype admission record isolates public config keys from inherited properties. */
  const result = Object.create(null) as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(value)) {
    if (rejectSymbolKeys && typeof key === 'symbol')
      throw createPluginHostTypeError(PluginHostInternalText.RECORD_SYMBOL_KEYS(label))
    if (rejectDangerousKeys && typeof key === 'string' && dangerousKeys.has(key))
      throw createPluginHostTypeError(PluginHostInternalText.RECORD_KEY(label, key))
    /** Own descriptors preserve the existing accessor-rejection order without executing getters. */
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor))
      throw createPluginHostTypeError(PluginHostInternalText.RECORD_DATA(label))
    if (descriptor.enumerable) result[key] = descriptor.value
  }
  return result
}
/** Parent-linked validation path avoids copying every ancestor name during successful traversal. */
type IConfigValidationPath = Readonly<{
  readonly parent: IConfigValidationPath | undefined
  readonly segment: string
}>

/** One validation operation separates current ancestors from objects already checked successfully. */
type IConfigValidationContext = Readonly<{
  readonly seen: WeakSet<object>
  readonly validated: WeakSet<object>
}>

/** Extends the path in O(1), retaining the original omission of an empty leading key prefix. */
function appendValidationPath(
  parent: IConfigValidationPath | undefined,
  segment: string
): IConfigValidationPath | undefined {
  return parent === undefined && segment === '' ? undefined : { parent, segment }
}

/** Formats only the first rejected path, preserving the existing dot-separated diagnostic spelling. */
function renderValidationPath(path: IConfigValidationPath | undefined): string {
  /** Reversed segments are collected once and joined only when constructing a failure. */
  const segments: string[] = []
  /** Current ancestor link advances without rebuilding any prior prefix. */
  let current = path
  while (current !== undefined) {
    segments.push(current.segment)
    current = current.parent
  }
  return segments.reverse().join('.')
}

/** Throws the original classified error after rendering its exact first-failure path once. */
function reject(
  code: IPluginHostErrorCode,
  path: IConfigValidationPath | undefined,
  reason: string
): never {
  /** Existing public error text and detail use the same one-time path rendering. */
  const rendered = renderValidationPath(path)
  throw new PluginHostError(
    code,
    code === PluginHostErrorCode.configCycleRejected
      ? ERROR_TEXT.CONFIG_CYCLE_REJECTED(rendered)
      : ERROR_TEXT.INVALID_CONFIG_VALUE(rendered, reason),
    { detail: { path: rendered, reason } }
  )
}

/** Checks each source object once in original DFS order while active ancestors still reject cycles. */
function assertValue(
  value: unknown,
  path: IConfigValidationPath | undefined,
  context: IConfigValidationContext
): void {
  if (value === null || typeof value === 'function') return
  if (typeof value !== 'object') {
    if (typeof value === 'symbol')
      reject(
        PluginHostErrorCode.invalidConfigValue,
        path,
        PluginHostInternalText.CONFIG_REASON_SYMBOL
      )
    return
  }
  if (context.seen.has(value))
    reject(
      PluginHostErrorCode.configCycleRejected,
      path,
      PluginHostInternalText.CONFIG_REASON_CYCLE
    )
  if (context.validated.has(value)) return
  /** Arrays keep their original dedicated index/length admission rules. */
  const array = Array.isArray(value)
  /** Custom prototypes fail before walking any of their properties, as before. */
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    reject(
      PluginHostErrorCode.invalidConfigValue,
      path,
      PluginHostInternalText.CONFIG_REASON_PROTOTYPE
    )
  context.seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    if (array && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)))
      reject(
        PluginHostErrorCode.invalidConfigValue,
        path,
        PluginHostInternalText.CONFIG_REASON_ARRAY_KEY
      )
    if (typeof key === 'symbol')
      reject(PluginHostErrorCode.invalidConfigValue, path, PluginHostInternalText.CONFIG_REASON_KEY)
    if (typeof key === 'string' && dangerousKeys.has(key))
      reject(PluginHostErrorCode.invalidConfigValue, path, PluginHostInternalText.CONFIG_REASON_KEY)
    /** Descriptor admission keeps the original per-key order before recursive descent. */
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    /** A single link records this key without copying its growing ancestor prefix. */
    const childPath = appendValidationPath(path, String(key))
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      reject(
        PluginHostErrorCode.invalidConfigValue,
        childPath,
        PluginHostInternalText.CONFIG_REASON_DESCRIPTOR
      )
    if (key === 'then' && typeof descriptor.value === 'function')
      reject(
        PluginHostErrorCode.invalidConfigValue,
        childPath,
        PluginHostInternalText.CONFIG_REASON_THENABLE
      )
    assertValue(descriptor.value, childPath, context)
  }
  context.seen.delete(value)
  context.validated.add(value)
}

/** Produces one frozen copy per source object, preserving aliases within this ownership operation. */
function own(value: unknown, copies: WeakMap<object, object>): unknown {
  if (value === null || typeof value !== 'object') return value
  /** Completed DAG nodes are reused; validation already excluded active recursion cycles. */
  const existing = copies.get(value)
  if (existing !== undefined) return existing
  if (Array.isArray(value)) {
    /** Native map preserves the existing array length, hole and index traversal semantics. */
    const target = Object.freeze(value.map((entry) => own(entry, copies)))
    copies.set(value, target)
    return target
  }
  /** Admitted records retain their original ordinary or null prototype. */
  const target = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(value))
    target[key] = own((value as Record<PropertyKey, unknown>)[key], copies)
  /** Only completed immutable copies enter the operation-local identity cache. */
  const frozen = Object.freeze(target)
  copies.set(value, frozen)
  return frozen
}

/** Validates and owns one config DAG without changing its root-record admission or error policy. */
export const copyConfig = (config: IPluginConfig, label = 'config'): IPluginConfig => {
  /** Ancestors and completed objects are scoped to this exact validation operation. */
  const validation = { seen: new WeakSet<object>(), validated: new WeakSet<object>() }
  assertValue(config, undefined, validation)
  /** Root capture keeps the original null-prototype config representation. */
  const record = readPlainDataRecord(config, label, true, true)
  return own(record, new WeakMap()) as IPluginConfig
}

/** Owns one patch DAG while preserving the exact existing identities of untouched base roots. */
export const copyConfigWithPatch = (
  base: IPluginConfig,
  patch: Record<PropertyKey, unknown>
): IPluginConfig => {
  /** Patch root admission still completes before validating any of its nested values. */
  const record = readPlainDataRecord(patch, 'plugin config patch', true, true)
  /** One patch operation shares completed validation across all of its changed root paths. */
  const validation = { seen: new WeakSet<object>(), validated: new WeakSet<object>() }
  for (const key of Reflect.ownKeys(record))
    assertValue(record[key], appendValidationPath(undefined, String(key)), validation)
  /** Untouched base values remain shared; only admitted patch values enter the copy operation. */
  const target = Object.create(null) as Record<PropertyKey, unknown>
  /** Alias preservation spans every patched root without scanning or re-owning the base graph. */
  const copies = new WeakMap<object, object>()
  // Symbol keys were rejected by root admission; the wider key type preserves descriptor traversal.
  for (const key of Reflect.ownKeys(base)) target[key] = (base as Record<PropertyKey, unknown>)[key]
  for (const key of Reflect.ownKeys(record)) target[key] = own(record[key], copies)
  return Object.freeze(target) as IPluginConfig
}

/** Reuses the canonical utils path parser while retaining its original failure on cause. */
export const parseConfigPath = (path: string): string[] => {
  try {
    return [...parseUtilsConfigPath(path)]
  } catch (cause) {
    throw createPluginHostTypeError(PluginHostInternalText.CONFIG_PATH_INVALID, { cause })
  }
}
/** Resolves the existing plugin-relative config path without changing stored object identity. */
export const readConfigPath = (config: IPluginConfig, segments: readonly string[]): unknown => {
  /** Current immutable value advances once per admitted path segment. */
  let current: unknown = config
  for (const segment of segments.slice(1)) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
