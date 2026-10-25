/** The sole pure method-schema normalizer; traversal and diagnostic identity are operation-local. */
import { orderStringKeys } from '@migaia/utils/string'
import { normalizePortable, type IRpcPortableValue } from '../portable/index.js'
import { createContractError } from '../contract/contract-error.js'
import type { IRpcErrorWireMetadata } from '../contract/types.js'
import { RpcContractErrorCode } from '../error-code.js'
import {
  inspectShape,
  rejectShape,
  RpcShapeReason,
  type IShapeInspection
} from './schema-diagnostics.js'

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

/** JSON value equality ignores object insertion order when checking enum uniqueness. */
function canonical(value: IRpcPortableValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${orderStringKeys(Object.keys(value))
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Readonly<Record<string, IRpcPortableValue>>)[key]!)}`
      )
      .join(',')}}`
  return JSON.stringify(value)
}

/** A single pure parse passes its admitted tree and local-reference work explicitly. */
type IMethodSchemaContext = Readonly<{
  /** Portable admission already supplied the sole snapshot of the caller's schema. */
  root: IRpcPortableValue
  /** Directory/provider and schema diagnostics share the same original operation identity. */
  inspection: IShapeInspection
  /** Only concrete schema nodes can be valid local-reference targets in this parse. */
  nodes: Set<object>
  /** Inert references are resolved after every concrete child has been admitted. */
  references: string[]
}>

/** Schema failures keep the original fixed, non-reflecting diagnostic path. */
function invalidMethodSchema(context: IMethodSchemaContext): never {
  return rejectShape(context.inspection, RpcShapeReason.schema, '$.schema')
}

/** Portable normalization already supplied getter, prototype and scalar-value admission. */
function methodSchemaRecord(
  context: IMethodSchemaContext,
  value: unknown
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalidMethodSchema(context)
  return value as Readonly<Record<string, unknown>>
}

/** Recursion visits concrete schema children only; local $ref remains inert data. */
function visitMethodSchema(context: IMethodSchemaContext, input: unknown): void {
  /** Unknown keywords retain the closed subset even when their values appear harmless. */
  const value = methodSchemaRecord(context, input)
  context.nodes.add(value)
  for (const key of Object.keys(value))
    if (!schemaKeywords.includes(key as (typeof schemaKeywords)[number]))
      invalidMethodSchema(context)
  if (Object.hasOwn(value, 'type')) {
    /** JSON Schema permits one domain or a nonempty unique union of domains. */
    const types = Array.isArray(value.type) ? value.type : [value.type]
    if (
      !types.length ||
      new Set(types).size !== types.length ||
      types.some((type) => !schemaTypes.includes(type as (typeof schemaTypes)[number]))
    )
      invalidMethodSchema(context)
  }
  for (const key of ['properties', '$defs'] as const) {
    if (!Object.hasOwn(value, key)) continue
    for (const child of Object.values(methodSchemaRecord(context, value[key])))
      visitMethodSchema(context, child)
  }
  if (Object.hasOwn(value, 'required')) {
    if (
      !Array.isArray(value.required) ||
      value.required.some((key) => typeof key !== 'string') ||
      new Set(value.required).size !== value.required.length
    )
      invalidMethodSchema(context)
  }
  if (Object.hasOwn(value, 'items')) visitMethodSchema(context, value.items)
  if (Object.hasOwn(value, 'enum')) {
    if (
      !Array.isArray(value.enum) ||
      !value.enum.length ||
      new Set(value.enum.map((item) => canonical(item as IRpcPortableValue))).size !==
        value.enum.length
    )
      invalidMethodSchema(context)
  }
  if (Object.hasOwn(value, 'anyOf')) {
    if (!Array.isArray(value.anyOf) || !value.anyOf.length) invalidMethodSchema(context)
    for (const child of value.anyOf) visitMethodSchema(context, child)
  }
  if (Object.hasOwn(value, '$ref')) {
    if (typeof value.$ref !== 'string' || !value.$ref.startsWith('#/$defs/'))
      invalidMethodSchema(context)
    context.references.push(value.$ref)
  }
}

/** Resolve bounded local references only after every concrete schema node has been visited. */
function resolveMethodSchemaReferences(context: IMethodSchemaContext): void {
  for (const reference of context.references) {
    /** JSON Pointer escapes preserve safe local definition keys without external lookup. */
    const segments = reference.slice(2).split('/')
    /** Resolution starts from this operation's admitted snapshot, never the caller's graph. */
    let target: unknown = context.root
    for (const segment of segments) {
      if (/~(?:[^01]|$)/u.test(segment)) invalidMethodSchema(context)
      /** Decode each segment once in the original traversal order. */
      const key = segment.replace(/~1/gu, '/').replace(/~0/gu, '~')
      if (target === null || typeof target !== 'object' || !Object.hasOwn(target, key))
        invalidMethodSchema(context)
      target = Reflect.get(target, key)
    }
    if (!target || typeof target !== 'object' || !context.nodes.has(target))
      invalidMethodSchema(context)
  }
}

/**
 * Read schema payloads at their caller-supplied embedding depth; standalone declarations start at
 * zero.
 */
export function readMethodSchema(
  input: unknown,
  inspection: IShapeInspection,
  metadata?: IRpcErrorWireMetadata,
  embeddingDepth = 0
): IRpcMethodSchema {
  /** This single portable admission preserves the original getter order and native failure cause. */
  let root: IRpcPortableValue
  try {
    root = normalizePortable(input, embeddingDepth, undefined, false, metadata)
  } catch (cause) {
    return rejectShape(inspection, RpcShapeReason.schema, '$.schema', cause)
  }
  /** No context survives this synchronous call or retains the original untrusted input. */
  const context: IMethodSchemaContext = { root, inspection, nodes: new Set(), references: [] }
  visitMethodSchema(context, root)
  resolveMethodSchemaReferences(context)
  return root as IRpcMethodSchema
}

/**
 * Standalone schema admission defaults to depth zero; embedded callers retain their original
 * allowance.
 */
export function normalizeMethodSchema(
  input: unknown,
  metadata?: IRpcErrorWireMetadata,
  embeddingDepth = 0
): IRpcMethodSchema {
  /** One explicit read context keeps caller inputs out of nested inspection captures. */
  const operation = { input, metadata, embeddingDepth }
  /** A prior returned diagnostic thrown by input remains the original cause, never a local exit. */
  const result = inspectShape((inspection) =>
    readMethodSchema(operation.input, inspection, operation.metadata, operation.embeddingDepth)
  )
  if (!result.ok)
    throw createContractError(
      RpcContractErrorCode.invalidDescriptor,
      result.cause ?? result,
      metadata
    )
  return result.value
}
