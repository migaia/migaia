import { createSerializeTypeError, SerializeErrorCode, SerializeErrorText } from './errors.js'
import { SerializeTextFormat, type ISerializeTextFormat } from './format-constants.js'
import { jsonParser } from './plugins/json.js'
import { createAbortController } from '@migaia/lifecycle/abort'
import type { ISerializeChunk, ISerializeContext } from './types.js'

/** Text formats share one admitted data graph; unsupported values cannot be silently omitted. */
type IOutputValue =
  | null
  | boolean
  | number
  | string
  | IOutputValue[]
  | { [key: string]: IOutputValue }

/** Native JSON remains owned by its existing parser, without user replacers or toJSON callbacks. */
const json = jsonParser()

/** The existing parser context is immutable and cannot cancel this synchronous output operation. */
const jsonContext: ISerializeContext = Object.freeze({
  signal: createAbortController().signal,
  context: SerializeTextFormat.json
})

/** A format or value rejection preserves the package's existing native coded TypeError. */
function invalid(cause?: unknown): never {
  throw createSerializeTypeError(
    SerializeErrorCode.invalidOption,
    SerializeErrorText.outputInvalid,
    cause === undefined ? undefined : { cause }
  )
}

/** TOML basic strings require Unicode scalars; JSON and YAML retain their original string domain. */
function scalarString(value: string): void {
  for (const character of value) {
    /** Iteration combines valid surrogate pairs, so a remaining surrogate is not a scalar. */
    const point = character.codePointAt(0)!
    if (point >= 0xd800 && point <= 0xdfff) invalid()
  }
}

/** Copy only own enumerable data, without invoking getters, callbacks or object serialization hooks. */
function admit(value: unknown, format: ISerializeTextFormat, active: Set<object>): IOutputValue {
  if (value === null) {
    if (format === SerializeTextFormat.toml) invalid()
    return null
  }
  if (typeof value === 'string') {
    if (format === SerializeTextFormat.toml) scalarString(value)
    return value
  }
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid()
    return value
  }
  if (typeof value !== 'object' || active.has(value)) invalid()
  /** Descriptor admission prevents an accessor from exposing a secret or causing side effects. */
  let descriptors: PropertyDescriptorMap
  /** Array shape is retained separately from ordinary own-data record shape. */
  const array = Array.isArray(value)
  try {
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      invalid()
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch (cause) {
    invalid(cause)
  }
  active.add(value)
  try {
    if (array) {
      /** Holes and named enumerable array properties are not portable collection structure. */
      const length = descriptors.length!.value as number
      /** New arrays preserve ordering and contain only admitted data values. */
      const result: IOutputValue[] = []
      for (const key of Reflect.ownKeys(descriptors)) {
        const descriptor = descriptors[key as string]!
        if (!descriptor.enumerable) continue
        if (
          typeof key !== 'string' ||
          !Object.hasOwn(descriptor, 'value') ||
          !/^(0|[1-9][0-9]*)$/u.test(key) ||
          Number(key) >= length
        )
          invalid()
      }
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[index]
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid()
        result.push(admit(descriptor.value, format, active))
      }
      return result
    }
    /** A null prototype also prevents a user key from changing projection object ownership. */
    const result: { [key: string]: IOutputValue } = Object.create(null)
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as string]!
      if (!descriptor.enumerable) continue
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) invalid()
      if (format === SerializeTextFormat.toml) scalarString(key)
      result[key] = admit(descriptor.value, format, active)
    }
    return result
  } finally {
    active.delete(value)
  }
}

/** Quoted flow strings avoid YAML folding and TOML control-character restrictions. */
function quote(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}

/** Dependency-free flow collections preserve empty and nested shapes in YAML and TOML. */
function flow(value: IOutputValue, format: ISerializeTextFormat): string {
  if (typeof value === 'string') return quote(value)
  if (Array.isArray(value)) return `[${value.map((item) => flow(item, format)).join(', ')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .map(
        ([key, item]) =>
          `${quote(key)}${format === SerializeTextFormat.toml ? ' = ' : ': '}${flow(item, format)}`
      )
      .join(', ')}}`
  if (format === SerializeTextFormat.toml && typeof value === 'number') {
    if (Object.is(value, -0)) return '-0.0'
    /** Unsafe JavaScript integers use TOML floats rather than overflowing its integer domain. */
    const number = String(value)
    return Number.isInteger(value) && !Number.isSafeInteger(value) && !/[e.]/iu.test(number)
      ? `${number}.0`
      : number
  }
  return String(value)
}

/**
 * Emit one complete portable projection; invalid inputs never produce partial output or evaluate
 * getters.
 */
export function emitOutput(
  value: unknown,
  format: ISerializeTextFormat = SerializeTextFormat.json
): string {
  if (!Object.values(SerializeTextFormat).includes(format)) invalid()
  if (
    format === SerializeTextFormat.toml &&
    (value === null || typeof value !== 'object' || Array.isArray(value))
  )
    invalid()
  /** Admission happens once before any format branch generates text. */
  const admitted = admit(value, format, new Set())
  if (format === SerializeTextFormat.json)
    return (json.encode(admitted, jsonContext) as ISerializeChunk)[1] as string
  if (format === SerializeTextFormat.yaml) return flow(admitted, format)
  return Object.entries(admitted as { [key: string]: IOutputValue })
    .map(([key, item]) => `${quote(key)} = ${flow(item, format)}`)
    .join('\n')
}
