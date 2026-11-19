/** Mapping of an OpenAPI document to models, resources and commands, in document order. */
import { camel, kebab, NameSpace } from './names.ts'
import {
  isObject,
  pointerSegment,
  RefResolver,
  type IJsonObject,
  type IUncertain
} from './openapi.ts'
import { GeneratedText, ImportReason } from './text.ts'

/** Prefix of schema references that can name models. */
const SCHEMA_PREFIX = '#/components/schemas/'
/** HTTP methods mapped to commands; fixed size four. */
const MUTATIONS = ['post', 'put', 'patch', 'delete'] as const

/** One model to generate. */
export type IModelPlan = {
  readonly id: string
  readonly file: string
  readonly constant: string
  readonly pointer: string
  readonly schema: IJsonObject
  readonly jsonSchema: unknown
  readonly key: readonly string[]
  readonly display: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Path and query parameter names of an operation. */
export type IParameterPlan = { readonly path: readonly string[]; readonly query: readonly string[] }

/** One command to generate. */
export type ICommandPlan = {
  readonly name: string
  readonly method: string
  readonly path: string
  readonly parameters: IParameterPlan
  readonly hasBody: boolean
  readonly pointer: string
  readonly args: IJsonObject
}

/** One resource to generate. */
export type IResourcePlan = {
  readonly id: string
  readonly constant: string
  readonly path: string
  readonly parameters: IParameterPlan
  readonly pointer: string
  readonly params: IJsonObject
  readonly result: unknown
  readonly commands: ICommandPlan[]
}

/** Resources of one tag, written to one file. */
export type ITagPlan = {
  readonly tag: string
  readonly file: string
  readonly resources: IResourcePlan[]
}

/** Everything an import generates. */
export type IImportPlan = {
  readonly models: readonly IModelPlan[]
  readonly tags: readonly ITagPlan[]
  readonly uncertain: IUncertain[]
  readonly resolver: RefResolver
  /** Model constant by schema reference, for zod generation. */
  readonly modelByRef: ReadonlyMap<string, IModelPlan>
}

/** Primary key of an object schema: `id`, or a guessed required `…Id` / `…_id` field. */
function keyOf(
  schema: IJsonObject,
  pointer: string,
  uncertain: IUncertain[]
): string[] | undefined {
  /** Declared properties. */
  const properties = isObject(schema.properties) ? schema.properties : {}
  if (Object.hasOwn(properties, 'id')) return ['id']
  /** Required fields. */
  const required = Array.isArray(schema.required) ? schema.required.map(String) : []
  /** Guessed key field. */
  const guess = required.find(
    (field) => /(Id|_id)$/.test(field) && Object.hasOwn(properties, field)
  )
  uncertain.push({
    pointer,
    reason: guess === undefined ? ImportReason.keyMissing : ImportReason.keyGuessed
  })
  return guess === undefined ? undefined : [guess]
}

/** Display hints of a model's properties. */
function displayOf(
  schema: IJsonObject,
  resolver: RefResolver,
  pointer: string
): Record<string, Record<string, string>> {
  /** Hints by field. */
  const display: Record<string, Record<string, string>> = {}
  /** Declared properties. */
  const properties = isObject(schema.properties) ? schema.properties : {}
  for (const [field, raw] of Object.entries(properties)) {
    /** Property schema with references inlined. */
    const property = resolver.inline(raw, `${pointer}/properties/${pointerSegment(field)}`)
    if (!isObject(property)) continue
    /** Hint of the field. */
    const hint: Record<string, string> = {}
    if (typeof property.title === 'string') hint.label = property.title
    /** Display format. */
    const format = formatOf(property)
    if (format !== undefined) hint.format = format
    if (Object.keys(hint).length > 0) display[field] = hint
  }
  return display
}

/** Display format of a property schema. */
function formatOf(property: IJsonObject): string | undefined {
  if (property.format === 'date') return 'date'
  if (property.format === 'date-time') return 'datetime'
  if (Array.isArray(property.enum)) return 'enum'
  if (property.type === 'number' || property.type === 'integer') return 'number'
  if (property.type === 'boolean') return 'boolean'
  return undefined
}

/** Builds the model plans of `components.schemas`. */
function modelPlans(
  document: IJsonObject,
  resolver: RefResolver,
  ids: NameSpace,
  uncertain: IUncertain[]
): IModelPlan[] {
  /** Schemas of the components. */
  const schemas =
    isObject(document.components) && isObject(document.components.schemas)
      ? document.components.schemas
      : {}
  /** Plans in document order. */
  const plans: IModelPlan[] = []
  for (const [name, schema] of Object.entries(schemas)) {
    /** Pointer of the schema. */
    const pointer = `/components/schemas/${pointerSegment(name)}`
    if (!isObject(schema) || (schema.type !== 'object' && !isObject(schema.properties))) continue
    /** Primary key. */
    const key = keyOf(schema, pointer, uncertain)
    if (key === undefined) continue
    /** Unique kebab name. */
    const base = ids.claim(kebab(name), pointer)
    plans.push({
      id: `${base}@1`,
      file: `models/${base}.ts`,
      constant: `${camel(base)}Schema`,
      pointer: `${SCHEMA_PREFIX}${pointerSegment(name)}`,
      schema,
      jsonSchema: resolver.inline(schema, pointer),
      key,
      display: displayOf(schema, resolver, pointer)
    })
  }
  return plans
}

/** Resolved parameters of an operation: path and query names plus an object schema. */
function parametersOf(
  operation: IJsonObject,
  shared: unknown,
  resolver: RefResolver,
  pointer: string
): {
  readonly plan: IParameterPlan
  readonly properties: Record<string, unknown>
  readonly required: string[]
} {
  /** Path names. */
  const path: string[] = []
  /** Query names. */
  const query: string[] = []
  /** Schema properties. */
  const properties: Record<string, unknown> = {}
  /** Required names. */
  const required: string[] = []
  /** Raw parameter list: path-level first, then the operation's. */
  const raw = [
    ...(Array.isArray(shared) ? shared : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : [])
  ]
  raw.forEach((entry, index) => {
    /** Parameter object, resolved when it is a reference. */
    const parameter =
      isObject(entry) && typeof entry.$ref === 'string'
        ? resolver.target(entry.$ref, `${pointer}/parameters/${index}`)
        : entry
    if (!isObject(parameter) || typeof parameter.name !== 'string') return
    if (parameter.in === 'path') path.push(parameter.name)
    else if (parameter.in === 'query') query.push(parameter.name)
    else return
    properties[parameter.name] = parameter.schema ?? {}
    if (parameter.required === true || parameter.in === 'path') required.push(parameter.name)
  })
  return { plan: { path, query }, properties, required }
}

/** JSON request body schema of an operation, when it has one. */
function bodyOf(operation: IJsonObject, resolver: RefResolver, pointer: string): unknown {
  /** Request body, resolved when it is a reference. */
  const body =
    isObject(operation.requestBody) && typeof operation.requestBody.$ref === 'string'
      ? resolver.target(operation.requestBody.$ref, `${pointer}/requestBody`)
      : operation.requestBody
  if (!isObject(body) || !isObject(body.content)) return undefined
  /** JSON media type entry. */
  const json = body.content['application/json']
  return isObject(json) ? json.schema : undefined
}

/** Successful JSON response schema of an operation. */
function resultOf(operation: IJsonObject): unknown {
  /** Responses of the operation. */
  const responses = isObject(operation.responses) ? operation.responses : {}
  /** 200 or 201 response. */
  const response = responses['200'] ?? responses['201']
  if (!isObject(response) || !isObject(response.content)) return undefined
  /** JSON media type entry. */
  const json = response.content['application/json']
  return isObject(json) ? json.schema : undefined
}

/** One operation found in `paths`, in document order. */
type IOperation = {
  readonly method: string
  readonly path: string
  readonly operation: IJsonObject
  readonly shared: unknown
  readonly pointer: string
  readonly tag: string
}

/** Every operation of the document, in document order. */
function operationsOf(document: IJsonObject): IOperation[] {
  /** Collected operations. */
  const operations: IOperation[] = []
  for (const [path, item] of Object.entries(document.paths as IJsonObject)) {
    if (!isObject(item)) continue
    for (const [method, operation] of Object.entries(item)) {
      if (
        !isObject(operation) ||
        (method !== 'get' && !(MUTATIONS as readonly string[]).includes(method))
      )
        continue
      /** First tag. */
      const tag =
        Array.isArray(operation.tags) && typeof operation.tags[0] === 'string'
          ? operation.tags[0]
          : GeneratedText.defaultTag
      operations.push({
        method,
        path,
        operation,
        shared: item.parameters,
        pointer: `/paths/${pointerSegment(path)}/${method}`,
        tag
      })
    }
  }
  return operations
}

/** Name of an operation: `operationId`, or the method plus the path segments. */
function operationName(entry: IOperation): string {
  return typeof entry.operation.operationId === 'string'
    ? entry.operation.operationId
    : `${entry.method}-${entry.path.replaceAll(/[{}]/g, '')}`
}

/** Builds the full import plan. */
export function planImport(document: IJsonObject): IImportPlan {
  /** Report list. */
  const uncertain: IUncertain[] = []
  /** Reference resolver. */
  const resolver = new RefResolver(document, uncertain)
  /** Catalog id space shared by models and resources. */
  const ids = new NameSpace(uncertain, '-')
  /** Tag file names. */
  const tagNames = new NameSpace(uncertain, '-')
  /** Models. */
  const models = modelPlans(document, resolver, ids, uncertain)
  /** Tags by tag text, in first-seen order. */
  const tags = new Map<string, ITagPlan>()
  /** Command name spaces per resource id. */
  const commandNames = new Map<string, NameSpace>()
  /** Every operation. */
  const operations = operationsOf(document)
  for (const entry of operations) {
    if (entry.method !== 'get') continue
    /** Tag plan. */
    let tag = tags.get(entry.tag)
    if (tag === undefined) {
      tag = {
        tag: entry.tag,
        file: `resources/${tagNames.claim(kebab(entry.tag), entry.pointer)}.ts`,
        resources: []
      }
      tags.set(entry.tag, tag)
    }
    /** Parameters. */
    const parameters = parametersOf(entry.operation, entry.shared, resolver, entry.pointer)
    /** Unique resource name. */
    const name = ids.claim(kebab(operationName(entry)), entry.pointer)
    /** Parameter schema. */
    const params = {
      type: 'object',
      properties: parameters.properties,
      required: parameters.required
    }
    tag.resources.push({
      id: `${name}@1`,
      constant: camel(name),
      path: entry.path,
      parameters: parameters.plan,
      pointer: entry.pointer,
      params,
      result: resultOf(entry.operation),
      commands: []
    })
    commandNames.set(`${name}@1`, new NameSpace(uncertain, ''))
  }
  for (const entry of operations) {
    if (entry.method === 'get') continue
    /** First resource of the tag. */
    const resource = tags.get(entry.tag)?.resources[0]
    if (resource === undefined) {
      uncertain.push({ pointer: entry.pointer, reason: ImportReason.commandOrphan })
      continue
    }
    /** Parameters. */
    const parameters = parametersOf(entry.operation, entry.shared, resolver, entry.pointer)
    /** Body schema. */
    const body = bodyOf(entry.operation, resolver, entry.pointer)
    /** Argument properties. */
    const properties = { ...parameters.properties, ...(body === undefined ? {} : { body }) }
    resource.commands.push({
      name: (commandNames.get(resource.id) as NameSpace).claim(
        camel(operationName(entry)),
        entry.pointer
      ),
      method: entry.method.toUpperCase(),
      path: entry.path,
      parameters: parameters.plan,
      hasBody: body !== undefined,
      pointer: entry.pointer,
      args: {
        type: 'object',
        properties,
        required: [...parameters.required, ...(body === undefined ? [] : ['body'])]
      }
    })
  }
  /** Models by reference. */
  const modelByRef = new Map(models.map((model) => [model.pointer, model]))
  return { models, tags: [...tags.values()], uncertain, resolver, modelByRef }
}
