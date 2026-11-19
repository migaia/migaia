/** Translation of JSON Schema fragments into zod 4 source text. */
import { isObject, pointerSegment, type IUncertain, type RefResolver } from './openapi.ts'
import { ImportReason } from './text.ts'

/** Keywords that only describe a schema and need no translation; fixed size. */
const DESCRIPTIVE: ReadonlySet<string> = new Set([
  'type',
  'title',
  'description',
  'example',
  'examples',
  'default',
  'format',
  'readOnly',
  'writeOnly',
  'deprecated',
  'properties',
  'required',
  'items',
  'enum',
  'nullable',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'additionalProperties',
  'xml',
  'externalDocs'
])

/** What the translator needs: model references, inlining of other references, the report. */
export type IZodContext = {
  /** Schema constant of a model reference (`#/components/schemas/X`), when X is a model. */
  readonly modelSchema: (ref: string) => string | undefined
  readonly resolver: RefResolver
  readonly uncertain: IUncertain[]
}

/** Zod source of a schema; `at` is the JSON Pointer used in the report. */
export function zodSource(schema: unknown, at: string, context: IZodContext): string {
  if (!isObject(schema)) return 'z.unknown()'
  if (typeof schema.$ref === 'string') return refSource(schema.$ref, at, context)
  reportUnsupported(schema, at, context)
  /** Source without nullability. */
  const base = baseSource(schema, at, context)
  /** Whether null is allowed. */
  const nullable =
    schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes('null'))
  return nullable ? `${base}.nullable()` : base
}

/** Reports every keyword with no translation. */
function reportUnsupported(
  schema: Readonly<Record<string, unknown>>,
  at: string,
  context: IZodContext
): void {
  for (const key of Object.keys(schema))
    if (!DESCRIPTIVE.has(key) && !key.startsWith('x-'))
      context.uncertain.push({
        pointer: `${at}/${pointerSegment(key)}`,
        reason: ImportReason.keywordUnsupported
      })
}

/** Source of a reference: the model's schema constant, or the inlined target. */
function refSource(ref: string, at: string, context: IZodContext): string {
  /** Model schema constant, when the reference names a model. */
  const model = context.modelSchema(ref)
  if (model !== undefined) return `z.lazy(() => ${model})`
  return zodSource(context.resolver.inline({ $ref: ref }, at), at, context)
}

/** The single JSON type of a schema, ignoring `null`. */
function typeOf(schema: Readonly<Record<string, unknown>>): string | undefined {
  /** Declared types. */
  const types = [schema.type].flat().filter((type) => type !== 'null' && type !== undefined)
  if (types.length === 0 && isObject(schema.properties)) return 'object'
  return types.length === 1 ? String(types[0]) : undefined
}

/** Source of the schema's main type. */
function baseSource(
  schema: Readonly<Record<string, unknown>>,
  at: string,
  context: IZodContext
): string {
  if (Array.isArray(schema.enum)) return enumSource(schema.enum)
  /** Main type. */
  const type = typeOf(schema)
  if (type === 'string')
    return `z.string()${bounds(schema, 'minLength', 'min')}${bounds(schema, 'maxLength', 'max')}`
  if (type === 'number' || type === 'integer')
    return `z.number()${type === 'integer' ? '.int()' : ''}${bounds(schema, 'minimum', 'min')}${bounds(schema, 'maximum', 'max')}`
  if (type === 'boolean') return 'z.boolean()'
  if (type === 'array') return `z.array(${zodSource(schema.items, `${at}/items`, context)})`
  if (type === 'object') return objectSource(schema, at, context)
  return 'z.unknown()'
}

/** `.min(n)` / `.max(n)` when the keyword is a number. */
function bounds(
  schema: Readonly<Record<string, unknown>>,
  keyword: string,
  method: string
): string {
  /** Keyword value. */
  const value = schema[keyword]
  return typeof value === 'number' && Number.isFinite(value) ? `.${method}(${value})` : ''
}

/** Source of an enum: string enums become `z.enum`, other values a union of literals. */
function enumSource(values: readonly unknown[]): string {
  if (values.length > 0 && values.every((value) => typeof value === 'string'))
    return `z.enum(${JSON.stringify(values)})`
  /** Literal members. */
  const literals = values.map((value) => `z.literal(${JSON.stringify(value)})`)
  return literals.length === 1 ? (literals[0] as string) : `z.union([${literals.join(', ')}])`
}

/** Source of an object schema; keys outside `required` are optional. */
function objectSource(
  schema: Readonly<Record<string, unknown>>,
  at: string,
  context: IZodContext
): string {
  /** Required keys. */
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : [])
  /** Declared properties. */
  const properties = isObject(schema.properties) ? schema.properties : {}
  /** Member lines. */
  const members: string[] = []
  for (const [key, value] of Object.entries(properties)) {
    /** Member schema source. */
    const member = zodSource(value, `${at}/properties/${pointerSegment(key)}`, context)
    members.push(`${JSON.stringify(key)}: ${member}${required.has(key) ? '' : '.optional()'}`)
  }
  return `z.object({ ${members.join(', ')} })`
}
