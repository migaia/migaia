/**
 * Translation of a JSON Schema subset into TypeScript type text, without the compiler API. Property
 * names and literal types are written with `JSON.stringify`, so any text stays inside quotes.
 */

/** True for a non-array object. */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Type text of one JSON type name. */
function primitive(type: string, schema: Readonly<Record<string, unknown>>): string {
  if (type === 'string') return 'string'
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'null') return 'null'
  if (type === 'array') return `readonly (${schemaType(schema.items)})[]`
  if (type === 'object') return objectType(schema)
  return 'unknown'
}

/** Type text of an object schema; keys outside `required` are optional. */
function objectType(schema: Readonly<Record<string, unknown>>): string {
  /** Required keys. */
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : [])
  /** Member lines. */
  const members: string[] = []
  for (const [key, value] of Object.entries(isObject(schema.properties) ? schema.properties : {}))
    members.push(
      `readonly ${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${schemaType(value)}`
    )
  if (isObject(schema.additionalProperties))
    members.push(`readonly [key: string]: ${schemaType(schema.additionalProperties)}`)
  else if (schema.additionalProperties !== false && members.length === 0)
    return 'Readonly<Record<string, unknown>>'
  return members.length === 0 ? '{}' : `{ ${members.join('; ')} }`
}

/** Union text of several schemas, or `unknown` when there are none. */
function joined(schemas: unknown, separator: ' | ' | ' & '): string | undefined {
  if (!Array.isArray(schemas) || schemas.length === 0) return undefined
  return schemas.map((member) => `(${schemaType(member)})`).join(separator)
}

/** Type text of a schema; unsupported or malformed input gives `unknown`. */
export function schemaType(schema: unknown): string {
  if (!isObject(schema)) return 'unknown'
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const) ?? 'unknown'
  if (Array.isArray(schema.enum))
    return schema.enum.length === 0
      ? 'never'
      : schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  /** Union or intersection of sub-schemas. */
  const composed =
    joined(schema.anyOf, ' | ') ?? joined(schema.oneOf, ' | ') ?? joined(schema.allOf, ' & ')
  if (composed !== undefined) return composed
  /** Declared types. */
  const types =
    schema.type === undefined
      ? isObject(schema.properties)
        ? ['object']
        : []
      : [schema.type].flat()
  if (types.length === 0) return 'unknown'
  /** Type text per declared type. */
  const texts = types.map((type) => primitive(String(type), schema))
  if (schema.nullable === true) texts.push('null')
  return texts.join(' | ')
}
