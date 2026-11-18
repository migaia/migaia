import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { PartContractErrorCode } from './error-code.ts'
import { PartContractErrorText } from './error-text.ts'
import { createPartContractError } from './errors.ts'
import type { IJsonSchema } from './types.ts'

/** A Standard Schema v1 validator that may also implement the Standard JSON Schema extension. */
export type IStandardSchemaInput = {
  readonly '~standard': StandardSchemaV1.Props & {
    readonly jsonSchema?: StandardJSONSchemaV1.Converter
  }
}

/** JSON Schema target stored in the catalog. */
const CATALOG_TARGET = 'draft-2020-12'

/** Reads the JSON Schema converter if the schema implements the extension. */
function converterOf(schema: IStandardSchemaInput): StandardJSONSchemaV1.Converter | undefined {
  return schema['~standard'].jsonSchema
}

/**
 * Returns the catalog JSON Schema of a schema: its `input` conversion, or the explicit
 * `jsonSchema`. Throws `SCHEMA_NOT_SERIALIZABLE` when neither is available; a conversion error
 * stays on `cause`.
 */
export function toCatalogSchema(
  schema: IStandardSchemaInput,
  jsonSchema?: IJsonSchema
): IJsonSchema {
  if (jsonSchema !== undefined) return jsonSchema
  /** Converter supplied by the validation library, if any. */
  const converter = converterOf(schema)
  if (converter === undefined)
    throw createPartContractError(
      PartContractErrorCode.schemaNotSerializable,
      PartContractErrorText.schemaNotSerializable
    )
  try {
    return converter.input({ target: CATALOG_TARGET })
  } catch (cause) {
    throw createPartContractError(
      PartContractErrorCode.schemaNotSerializable,
      PartContractErrorText.schemaNotSerializable,
      cause
    )
  }
}

/**
 * Serializes a JSON Schema for comparison without `additionalProperties`. Object validators
 * commonly describe accepted input as open and validated output as closed; dropping unknown keys
 * does not change any declared field, so it is not a transformation of the argument value.
 */
function comparable(schema: unknown): string {
  return JSON.stringify(schema, (key, value: unknown) =>
    key === 'additionalProperties' ? undefined : value
  )
}

/**
 * Throws `SCHEMA_TRANSFORMS` when a schema changes its value: input and output JSON Schemas differ,
 * or `output()` throws while `input()` succeeds. Schemas without the extension pass unchecked.
 */
export function assertNoTransform(schema: IStandardSchemaInput): void {
  /** Converter supplied by the validation library, if any. */
  const converter = converterOf(schema)
  if (converter === undefined) return
  /** Input-side JSON Schema; its failure is a serialization problem reported by toCatalogSchema. */
  const input = toCatalogSchema(schema)
  /** Output-side JSON Schema text for comparison. */
  let output: string
  try {
    output = comparable(converter.output({ target: CATALOG_TARGET }))
  } catch (cause) {
    throw createPartContractError(
      PartContractErrorCode.schemaTransforms,
      PartContractErrorText.schemaTransforms,
      cause
    )
  }
  if (comparable(input) !== output)
    throw createPartContractError(
      PartContractErrorCode.schemaTransforms,
      PartContractErrorText.schemaTransforms
    )
}

/**
 * Validates a value and resolves with the validated value. Synchronous and asynchronous validators
 * share one Promise boundary; issues reject with `ARGS_INVALID` and the issue list on `cause`.
 */
export async function validateArgs<T>(schema: IStandardSchemaInput, value: unknown): Promise<T> {
  /** Validation result, awaited whether the validator is synchronous or not. */
  const result = await schema['~standard'].validate(value)
  if (result.issues !== undefined)
    throw createPartContractError(
      PartContractErrorCode.argsInvalid,
      PartContractErrorText.argsInvalid,
      result.issues
    )
  return result.value as T
}
