/** `defineModel`: backend-neutral data models whose contract enters the catalog. */
import type { IModelBody } from './data.ts'
import { validateDescriptor } from './descriptor.ts'
import { assertNoTransform, toCatalogSchema, type IStandardSchemaInput } from './schema.ts'
import type { IDescriptor, IJsonSchema } from './types.ts'

/**
 * Model specification. `schema` is a Standard Schema; its JSON Schema comes from the validator's
 * converter, or from `jsonSchema` when given (generated models pass the OpenAPI original).
 */
export type IModelSpec = Pick<IDescriptor, 'id' | 'title' | 'description' | 'meta'> &
  Omit<IModelBody, 'schema'> & {
    readonly schema: IStandardSchemaInput
    readonly jsonSchema?: IJsonSchema
  }

/**
 * A model definition: the catalog descriptor (kind `model`) plus the original schema object used
 * for runtime validation. `__value` only carries the value type.
 */
export type IModelDefinition<TValue = unknown> = {
  readonly descriptor: IDescriptor
  readonly schema: IStandardSchemaInput
  readonly __value?: TValue
}

/**
 * Copy of a record of plain objects with every level frozen, so later changes to the caller's
 * objects cannot alter a registered descriptor. Arrays inside (relation `via`) are copied too.
 */
function frozenRecords<T extends object>(
  record: Readonly<Record<string, T>>
): Readonly<Record<string, T>> {
  /** Frozen copies by key. */
  const copy: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    /** Shallow copy of the entry with arrays and nested records copied and frozen. */
    const entry: Record<string, unknown> = {}
    for (const [field, inner] of Object.entries(value))
      entry[field] = Array.isArray(inner)
        ? Object.freeze([...inner])
        : typeof inner === 'object' && inner !== null
          ? Object.freeze({ ...inner })
          : inner
    copy[key] = Object.freeze(entry) as T
  }
  return Object.freeze(copy)
}

/**
 * Defines a model. Throws `DESCRIPTOR_INVALID` when the schema is not an object schema with
 * properties, or when key, display hints or relations name fields outside it; schema conversion
 * failures keep their own codes (`SCHEMA_NOT_SERIALIZABLE`, `SCHEMA_TRANSFORMS`).
 */
export function defineModel<TValue = unknown>(spec: IModelSpec): IModelDefinition<TValue> {
  /** Spec split into schema inputs and descriptor fields. */
  const { schema, jsonSchema, key, display, relations, id, title, description, meta } = spec
  assertNoTransform(schema)
  /** Catalog body of the model. */
  const body: IModelBody = {
    schema: toCatalogSchema(schema, jsonSchema),
    key: Object.freeze([...key]),
    ...(display === undefined ? {} : { display: frozenRecords(display) }),
    ...(relations === undefined ? {} : { relations: frozenRecords(relations) })
  }
  /** Descriptor with only the fields that were given. */
  const descriptor = validateDescriptor({
    kind: 'model',
    id,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(meta === undefined ? {} : { meta }),
    model: Object.freeze(body)
  })
  return Object.freeze({ descriptor: Object.freeze(descriptor), schema })
}
