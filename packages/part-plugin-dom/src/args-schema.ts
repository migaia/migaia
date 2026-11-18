import type { IStandardSchemaInput } from '@migaia/part-contract'

/** Field types the built-in modifiers accept in their arguments. */
export type IArgFieldType = 'number' | 'string' | 'string[]'

/** Vendor name this package reports through Standard Schema. */
const VENDOR = 'migaia-part-dom'
/** Message of a failed argument check; the field name follows. */
const FIELD_INVALID = 'invalid modifier argument: '
/** Message when the arguments are not an object. */
const NOT_OBJECT = 'modifier arguments must be an object'

/** True when a value has the declared field type. */
function hasType(value: unknown, type: IArgFieldType): boolean {
  if (type === 'string[]')
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
  return typeof value === type
}

/** JSON Schema of one field type. */
function jsonType(type: IArgFieldType): Readonly<Record<string, unknown>> {
  return type === 'string[]' ? { type: 'array', items: { type: 'string' } } : { type }
}

/**
 * Minimal Standard Schema for built-in modifier arguments: an optional object whose listed fields
 * are all optional and typed. It implements the JSON Schema extension so the catalog can list it,
 * and never transforms its value.
 */
export class ModifierArgsSchema implements IStandardSchemaInput {
  /** Field types by name; each built-in declares at most three fields. */
  readonly #fields: Readonly<Record<string, IArgFieldType>>
  /** Standard Schema surface. */
  readonly '~standard': IStandardSchemaInput['~standard']

  /** Builds the schema for the given fields. */
  constructor(fields: Readonly<Record<string, IArgFieldType>>) {
    this.#fields = fields
    this['~standard'] = {
      version: 1,
      vendor: VENDOR,
      validate: (value) => this.#validate(value),
      jsonSchema: { input: () => this.#jsonSchema(), output: () => this.#jsonSchema() }
    }
  }

  /** Validates a value: `undefined` or an object whose present fields have their types. */
  #validate(
    value: unknown
  ): { readonly value: unknown } | { readonly issues: readonly { readonly message: string }[] } {
    if (value === undefined) return { value }
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return { issues: [{ message: NOT_OBJECT }] }
    for (const [name, type] of Object.entries(this.#fields)) {
      /** Field value, possibly absent. */
      const field = (value as Record<string, unknown>)[name]
      if (field !== undefined && !hasType(field, type))
        return { issues: [{ message: `${FIELD_INVALID}${name}` }] }
    }
    return { value }
  }

  /** JSON Schema of the arguments object. */
  #jsonSchema(): Record<string, unknown> {
    /** Property schemas. */
    const properties: Record<string, unknown> = {}
    for (const [name, type] of Object.entries(this.#fields)) properties[name] = jsonType(type)
    return { type: 'object', properties }
  }
}
