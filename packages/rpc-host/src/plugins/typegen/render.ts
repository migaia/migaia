/**
 * Renders accepted directory schemas into inert TypeScript declarations and safe local filenames.
 * Each rendering operation owns its reference aliases only; it consumes admitted portable/schema
 * data without reading native handles, writing files or acquiring Session authority.
 */
import { encodeUtf8 } from '@migaia/utils/bytes'
import { RuntimeApiMode, type IRpcDirectory } from '@migaia/rpc-contract/protocol'
import type { IRpcMethodSchema } from '@migaia/rpc-contract/protocol'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import { RpcTypegenText } from './text.ts'

/** Each rendering operation owns only transient alias bookkeeping for one accepted schema root. */
type ISchemaContext = {
  readonly root: IRpcMethodSchema
  readonly aliases: Map<IRpcMethodSchema, string>
  readonly active: Map<IRpcMethodSchema, number>
  readonly declarations: string[]
  allocate(): string
}

/** Rendering needs only the accepted name and method descriptions, never live Session authority. */
export type ITypegenDirectory = Readonly<{
  self: Pick<IRpcDirectory['self'], 'name'>
  methods: IRpcDirectory['methods']
}>

/** A peer's output is inert declaration text plus one safe local filename. */
export type IPeerDeclaration = Readonly<{ fileName: string; text: string }>

/** Render portable constant data as a type literal without executing or interpolating its strings. */
function literalType(value: IRpcPortableValue): string {
  if (Array.isArray(value)) return `[${value.map(literalType).join(', ')}]`
  if (value !== null && typeof value === 'object')
    return `{ ${Object.entries(value)
      .map(([key, item]) => `${RpcTypegenText.quote(key)}: ${literalType(item)}`)
      .join('; ')} }`
  return JSON.stringify(value)
}

/** Remove repeated constraints without widening the admitted set of values. */
function combine(parts: readonly string[], operator: ' | ' | ' & '): string {
  /** Repeated primitive constraints are common when a schema also carries an enum or anyOf. */
  const unique = [...new Set(parts)]
  if (unique.length === 0) return RpcTypegenText.unknown
  return unique.length === 1 ? unique[0]! : `(${unique.join(operator)})`
}

/** Resolve an already-admitted local JSON pointer against its original schema root only. */
function referenceTarget(reference: string, root: IRpcMethodSchema): IRpcMethodSchema {
  /** Admission already checked pointer escapes, existence and that the target is a schema node. */
  let target: unknown = root
  for (const segment of reference.slice(2).split('/'))
    target = Reflect.get(target as object, segment.replace(/~1/gu, '/').replace(/~0/gu, '~'))
  return target as IRpcMethodSchema
}

/** Render object members while preserving required keys that lack a property schema. */
function objectType(schema: IRpcMethodSchema, context: ISchemaContext, depth: number): string {
  /** Required members are independent of the properties table in JSON Schema. */
  const required = new Set(schema.required ?? [])
  /** Extra required keys still have unknown values rather than silently becoming optional. */
  const names = new Set([...Object.keys(schema.properties ?? {}), ...required])
  /** One rendering input retains the original four values without a multi-owner callback closure. */
  const operation = { required, schema, context, depth }
  /** Every key is quoted; property spellings can never create a TypeScript declaration. */
  const properties = [...names].map(
    (name) =>
      `${RpcTypegenText.quote(name)}${operation.required.has(name) ? '' : '?'}: ${renderSchema(
        operation.schema.properties?.[name],
        operation.context,
        operation.depth + 1
      )}`
  )
  return `{ ${[...properties, RpcTypegenText.additionalProperties].join('; ')} }`
}

/** Map one JSON type domain, entering a productive recursion level for objects and arrays. */
function domainType(
  type: NonNullable<IRpcMethodSchema['type']> extends readonly (infer T)[] ? T : string,
  schema: IRpcMethodSchema,
  context: ISchemaContext,
  depth: number
): string {
  if (type === 'object') return objectType(schema, context, depth)
  if (type === 'array') return `Array<${renderSchema(schema.items, context, depth + 1)}>`
  return RpcTypegenText.scalar[type as keyof typeof RpcTypegenText.scalar]
}

/** Render every supported keyword, retaining local reference cycles only through productive types. */
function renderSchema(
  schema: IRpcMethodSchema | undefined,
  context: ISchemaContext,
  depth = 0
): string {
  if (schema === undefined) return RpcTypegenText.unknown
  /** Independent JSON Schema keywords constrain one value together. */
  const parts: string[] = []
  if (schema.$ref !== undefined) {
    /** The same normalized target always receives one safe local alias in this schema root. */
    const target = referenceTarget(schema.$ref, context.root)
    /** Existing aliases terminate reference recursion without expanding a second schema graph. */
    const existing = context.aliases.get(target)
    if (existing) {
      /** A pure reference cycle has no structural constraint and cannot form a legal TS alias. */
      const activeDepth = context.active.get(target)
      parts.push(
        activeDepth !== undefined && depth <= activeDepth ? RpcTypegenText.unknown : existing
      )
    } else {
      /** Alias allocation uses only local counters, never untrusted $defs names. */
      const alias = context.allocate()
      context.aliases.set(target, alias)
      context.active.set(target, depth)
      /** Object or array recursion increments depth and may legally refer back to this alias. */
      const definition = renderSchema(target, context, depth)
      context.active.delete(target)
      context.declarations.push(`type ${alias} = ${definition};`)
      parts.push(alias)
    }
  }
  if (Object.hasOwn(schema, 'const')) parts.push(literalType(schema.const!))
  if (schema.enum !== undefined) parts.push(combine(schema.enum.map(literalType), ' | '))
  if (schema.anyOf !== undefined)
    parts.push(
      combine(
        schema.anyOf.map((child) => renderSchema(child, context, depth)),
        ' | '
      )
    )
  if (schema.type !== undefined) {
    /** An explicit type array is a union, while other keywords still constrain its members. */
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    /** The original schema, alias context and productive depth belong to this one map operation. */
    const operation = { schema, context, depth }
    parts.push(
      combine(
        types.map((type) => domainType(type, operation.schema, operation.context, operation.depth)),
        ' | '
      )
    )
  } else if (schema.properties !== undefined || schema.required !== undefined) {
    parts.push(objectType(schema, context, depth))
  } else if (schema.items !== undefined) {
    parts.push(`Array<${renderSchema(schema.items, context, depth + 1)}>`)
  }
  return combine(parts, ' & ')
}

/** One declaration owns alias allocation and emitted references; schema recursion stays stateless. */
class PeerDeclarationRenderer {
  /** Alias counters span this file so independent method input and result roots cannot collide. */
  #aliasIndex = 0
  /** Reference declarations are emitted before the public capability type. */
  readonly #declarations: string[] = []
  /** One allocation advances this declaration's original shared alias sequence. */
  readonly #allocate = (): string => RpcTypegenText.alias(this.#aliasIndex++)
  /** A schema's references are scoped to that schema root, not to another method's definitions. */
  #render(schema: IRpcMethodSchema | undefined): string {
    return renderSchema(schema, {
      root: schema ?? {},
      aliases: new Map(),
      active: new Map(),
      declarations: this.#declarations,
      allocate: this.#allocate
    })
  }
  /** Generate one accepted directory without accessing peer configuration or native handles. */
  render(description: ITypegenDirectory): IPeerDeclaration {
    /** Method names remain quoted keys even when they contain namespace separators. */
    const methods = description.methods.map((method) => {
      /** An omitted input schema preserves the no-argument call form. */
      const payload =
        method.input === undefined
          ? RpcTypegenText.unknownPayload
          : `payload: ${this.#render(method.input)}`
      /** Request-capable descriptions retain their scalar interface; stream-only routes yield items. */
      const stream =
        method.supportedModes.includes(RuntimeApiMode.stream) &&
        !method.supportedModes.includes(RuntimeApiMode.request)
      /** Stream elements have their own schema rather than borrowing the scalar result schema. */
      const result = stream
        ? `AsyncIterable<${this.#render(method.yield)}>`
        : `Promise<${this.#render(method.output)}>`
      return `  ${RpcTypegenText.quote(method.name)}(${payload}): ${result};`
    })
    /** UTF-8 hex has no path separators, quotes or platform-dependent filename characters. */
    const hex = [...encodeUtf8(description.self.name)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    return {
      fileName: RpcTypegenText.fileName(hex),
      text: `${RpcTypegenText.header}${this.#declarations.join('\n')}${this.#declarations.length ? '\n' : ''}export type ${RpcTypegenText.api} = {\n${methods.join('\n')}\n};\nexport type ${RpcTypegenText.peers} = { ${RpcTypegenText.quote(description.self.name)}: ${RpcTypegenText.api} };\n`
    }
  }
}

/** Render one independent output with invocation-local aliases and declaration storage. */
export function renderPeerDeclaration(description: ITypegenDirectory): IPeerDeclaration {
  return new PeerDeclarationRenderer().render(description)
}
