import { isDeepStrictEqual } from 'node:util'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The standard keyword subset exercised by the two shipped RPC description schemas. */
export type ISchemaRule = Record<string, unknown>

/** Relative remote references reuse the remote schema rather than copying its contract rules. */
const remoteSchema = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../schema/remote-contract.schema.json'), 'utf8')
) as ISchemaRule & { $defs: Record<string, ISchemaRule> }

/** Evaluate the standard keywords used by shipped vectors, including local and remote references. */
export function acceptsSchema(
  rule: ISchemaRule,
  value: unknown,
  root: ISchemaRule & { $defs: Record<string, ISchemaRule> } = remoteSchema
): boolean {
  if (typeof rule.$ref === 'string') {
    const [file, fragment] = rule.$ref.split('#')
    const target = file === 'remote-contract.schema.json' ? remoteSchema : root
    const name = fragment?.split('/').at(-1)
    return name !== undefined && acceptsSchema(target.$defs[name]!, value, target)
  }
  if ('const' in rule && !isDeepStrictEqual(value, rule.const)) return false
  if (
    Array.isArray(rule.enum) &&
    !rule.enum.some((candidate) => isDeepStrictEqual(value, candidate))
  )
    return false
  if (Array.isArray(rule.allOf) && !rule.allOf.every((part) => acceptsSchema(part, value, root)))
    return false
  if (Array.isArray(rule.anyOf) && !rule.anyOf.some((part) => acceptsSchema(part, value, root)))
    return false
  if (
    Array.isArray(rule.oneOf) &&
    rule.oneOf.filter((part) => acceptsSchema(part, value, root)).length !== 1
  )
    return false
  if (rule.not && acceptsSchema(rule.not as ISchemaRule, value, root)) return false
  if (rule.if) {
    if (acceptsSchema(rule.if as ISchemaRule, value, root)) {
      if (rule.then && !acceptsSchema(rule.then as ISchemaRule, value, root)) return false
    } else if (rule.else && !acceptsSchema(rule.else as ISchemaRule, value, root)) return false
  }
  if (typeof rule.type === 'string') {
    const validType =
      rule.type === 'null'
        ? value === null
        : rule.type === 'array'
          ? Array.isArray(value)
          : rule.type === 'object'
            ? value !== null && typeof value === 'object' && !Array.isArray(value)
            : rule.type === 'integer'
              ? Number.isInteger(value)
              : typeof value === rule.type
    if (!validType) return false
  }
  if (typeof value === 'string') {
    if (typeof rule.pattern === 'string' && !new RegExp(rule.pattern, 'u').test(value)) return false
    if (typeof rule.maxLength === 'number' && [...value].length > rule.maxLength) return false
    if (typeof rule.minLength === 'number' && [...value].length < rule.minLength) return false
  }
  if (typeof value === 'number') {
    if (typeof rule.minimum === 'number' && value < rule.minimum) return false
    if (typeof rule.exclusiveMinimum === 'number' && value <= rule.exclusiveMinimum) return false
  }
  if (Array.isArray(value)) {
    if (typeof rule.minItems === 'number' && value.length < rule.minItems) return false
    if (typeof rule.maxItems === 'number' && value.length > rule.maxItems) return false
    if (Array.isArray(rule.prefixItems)) {
      for (const [index, part] of rule.prefixItems.entries())
        if (index < value.length && !acceptsSchema(part, value[index], root)) return false
    }
    if (rule.items && value.some((entry) => !acceptsSchema(rule.items as ISchemaRule, entry, root)))
      return false
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object)
    if (typeof rule.maxProperties === 'number' && keys.length > rule.maxProperties) return false
    if (typeof rule.minProperties === 'number' && keys.length < rule.minProperties) return false
    if (Array.isArray(rule.required) && rule.required.some((key) => !Object.hasOwn(object, key)))
      return false
    const properties = (rule.properties ?? {}) as Record<string, ISchemaRule>
    for (const key of keys) {
      if (rule.propertyNames && !acceptsSchema(rule.propertyNames as ISchemaRule, key, root))
        return false
      if (key in properties) {
        if (!acceptsSchema(properties[key]!, object[key], root)) return false
      } else if (rule.additionalProperties === false) return false
      else if (
        rule.additionalProperties &&
        !acceptsSchema(rule.additionalProperties as ISchemaRule, object[key], root)
      )
        return false
    }
  }
  return true
}
