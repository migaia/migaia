import { normalizePortable, type IRpcPortableValue } from '../portable-index.js'
import { rejectShape, RpcShapeReason } from './check-result.js'

/** Registered scalar JSON Schema domains; integer is the number refinement. */
const schemaTypes = ['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'] as const

/** The sole keyword boundary used by provider and accepted-directory schema fields. */
const schemaKeywords = [
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'const',
  'anyOf',
  '$defs',
  '$ref'
] as const

/** Portable schema declarations are data only; no keyword executes code or resolves external I/O. */
export type IRpcMethodSchema = Readonly<{
  type?: (typeof schemaTypes)[number] | readonly (typeof schemaTypes)[number][]
  properties?: Readonly<Record<string, IRpcMethodSchema>>
  required?: readonly string[]
  items?: IRpcMethodSchema
  enum?: readonly IRpcPortableValue[]
  const?: IRpcPortableValue
  anyOf?: readonly IRpcMethodSchema[]
  $defs?: Readonly<Record<string, IRpcMethodSchema>>
  $ref?: string
}>

/** Schema key and value failures use one fixed path, never user property or reference text. */
function invalid(): never {
  return rejectShape(RpcShapeReason.schema, '$.schema')
}

/** A normalized schema record has no getters or custom prototypes. */
function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Readonly<Record<string, unknown>>
}

/** JSON value equality ignores object insertion order when checking enum uniqueness. */
function canonical(value: IRpcPortableValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Readonly<Record<string, IRpcPortableValue>>)[key]!)}`
      )
      .join(',')}}`
  return JSON.stringify(value)
}

/** Validate one normalized schema tree and its local references without following reference cycles. */
export function normalizeMethodSchema(input: unknown): IRpcMethodSchema {
  /** Portable admission supplies the existing recursion, value and original getter-failure bounds. */
  let root: IRpcPortableValue
  try {
    root = normalizePortable(input)
  } catch (cause) {
    return rejectShape(RpcShapeReason.schema, '$.schema', cause)
  }
  /** References are checked only after all concrete schema objects have been admitted. */
  const references: string[] = []
  /** A pointer must resolve to an admitted schema position, never a const or enum payload object. */
  const nodes = new WeakSet<object>()

  /** Recursion visits concrete schema children only; local $ref is inert data. */
  function visit(input: unknown): void {
    /** Unknown keywords retain the closed subset even when their values look harmless. */
    const value = record(input)
    nodes.add(value)
    for (const key of Object.keys(value))
      if (!schemaKeywords.includes(key as (typeof schemaKeywords)[number])) invalid()
    if (Object.hasOwn(value, 'type')) {
      /** JSON Schema permits one domain or a nonempty unique union of domains. */
      const types = Array.isArray(value.type) ? value.type : [value.type]
      if (
        !types.length ||
        new Set(types).size !== types.length ||
        types.some((type) => !schemaTypes.includes(type as (typeof schemaTypes)[number]))
      )
        invalid()
    }
    for (const key of ['properties', '$defs'] as const) {
      if (!Object.hasOwn(value, key)) continue
      for (const child of Object.values(record(value[key]))) visit(child)
    }
    if (Object.hasOwn(value, 'required')) {
      if (
        !Array.isArray(value.required) ||
        value.required.some((key) => typeof key !== 'string') ||
        new Set(value.required).size !== value.required.length
      )
        invalid()
    }
    if (Object.hasOwn(value, 'items')) visit(value.items)
    if (Object.hasOwn(value, 'enum')) {
      if (
        !Array.isArray(value.enum) ||
        !value.enum.length ||
        new Set(value.enum.map((item) => canonical(item as IRpcPortableValue))).size !==
          value.enum.length
      )
        invalid()
    }
    if (Object.hasOwn(value, 'anyOf')) {
      if (!Array.isArray(value.anyOf) || !value.anyOf.length) invalid()
      for (const child of value.anyOf) visit(child)
    }
    if (Object.hasOwn(value, '$ref')) {
      if (typeof value.$ref !== 'string' || !value.$ref.startsWith('#/$defs/')) invalid()
      references.push(value.$ref)
    }
  }

  visit(root)
  for (const reference of references) {
    /** JSON Pointer escapes retain arbitrary safe local definition keys without path interpretation. */
    const segments = reference.slice(2).split('/')
    let target: unknown = root
    for (const segment of segments) {
      if (/~(?:[^01]|$)/u.test(segment)) invalid()
      const key = segment.replace(/~1/gu, '/').replace(/~0/gu, '~')
      if (target === null || typeof target !== 'object' || !Object.hasOwn(target, key)) invalid()
      target = Reflect.get(target, key)
    }
    if (!target || typeof target !== 'object' || !nodes.has(target)) invalid()
  }
  return root as IRpcMethodSchema
}
