import { encodeUtf8 } from '@migaia/utils/bytes'
import { RuntimeApiMode, type IRuntimePeerDescription } from '@migaia/rpc-contract/runtime'
import type { IRpcMethodSchema } from '@migaia/rpc-contract/remote'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import { RpcTypegenText } from './text.js'

/** Each rendering operation owns only transient alias bookkeeping for one accepted schema root. */
type ISchemaContext = {
  readonly root: IRpcMethodSchema
  readonly aliases: Map<IRpcMethodSchema, string>
  readonly active: Map<IRpcMethodSchema, number>
  readonly declarations: string[]
  allocate(): string
}

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
  /** Every key is quoted; property spellings can never create a TypeScript declaration. */
  const properties = [...names].map(
    (name) =>
      `${RpcTypegenText.quote(name)}${required.has(name) ? '' : '?'}: ${renderSchema(
        schema.properties?.[name],
        context,
        depth + 1
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
    parts.push(
      combine(
        types.map((type) => domainType(type, schema, context, depth)),
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

/** Generate one accepted directory without accessing peer configuration, native handles or the host. */
export function renderPeerDeclaration(description: IRuntimePeerDescription): IPeerDeclaration {
  /** Alias counters span this file so independent method input and result roots cannot collide. */
  let aliasIndex = 0
  /** Reference declarations are emitted before the public capability type. */
  const declarations: string[] = []
  /** A schema's references are scoped to that schema root, not to another method's definitions. */
  const render = (schema: IRpcMethodSchema | undefined): string =>
    renderSchema(schema, {
      root: schema ?? {},
      aliases: new Map(),
      active: new Map(),
      declarations,
      allocate: () => RpcTypegenText.alias(aliasIndex++)
    })
  /** Method names remain quoted keys even when they contain namespace separators. */
  const methods = description.methods.map((method) => {
    /** An omitted input schema preserves the no-argument call form. */
    const payload =
      method.input === undefined
        ? RpcTypegenText.unknownPayload
        : `payload: ${render(method.input)}`
    /** Request-capable descriptions retain their scalar interface; stream-only routes yield items. */
    const stream =
      method.supportedModes.includes(RuntimeApiMode.stream) &&
      !method.supportedModes.includes(RuntimeApiMode.request)
    /** Stream elements have their own schema rather than borrowing the scalar result schema. */
    const result = stream
      ? `AsyncIterable<${render(method.yield)}>`
      : `Promise<${render(method.output)}>`
    return `  ${RpcTypegenText.quote(method.name)}(${payload}): ${result};`
  })
  /** UTF-8 hex has no path separators, quotes or platform-dependent filename characters. */
  const hex = [...encodeUtf8(description.self.name)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return {
    fileName: RpcTypegenText.fileName(hex),
    text: `${RpcTypegenText.header}${declarations.join('\n')}${declarations.length ? '\n' : ''}export type ${RpcTypegenText.api} = {\n${methods.join('\n')}\n};\nexport type ${RpcTypegenText.peers} = { ${RpcTypegenText.quote(description.self.name)}: ${RpcTypegenText.api} };\n`
  }
}
