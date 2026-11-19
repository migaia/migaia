import type { StandardJSONSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import {
  defineModel,
  PartContractErrorCode,
  type IJsonSchema,
  type IModelSpec,
  type IStandardSchemaInput
} from '../src/index.ts'

/** Builds a Standard Schema whose JSON Schema conversion returns the given schema both ways. */
function schemaOf(json: IJsonSchema): IStandardSchemaInput {
  /** Converter returning the same schema for input and output. */
  const converter: StandardJSONSchemaV1.Converter = {
    input: () => json as Record<string, unknown>,
    output: () => json as Record<string, unknown>
  }
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value: unknown) => ({ value }),
      jsonSchema: converter
    }
  }
}

/** Order schema used by every case. */
const orderSchema = schemaOf({
  type: 'object',
  properties: { id: { type: 'string' }, customer: { type: 'string' }, status: { enum: ['open'] } }
})

/** A valid order model spec. */
const spec: IModelSpec = {
  id: 'order@1',
  schema: orderSchema,
  key: ['id'],
  display: { status: { format: 'enum', enumLabels: { open: 'Open' } } },
  relations: { lines: { target: 'line@1', cardinality: 'many', via: ['id'] } }
}

/** Matcher for a DESCRIPTOR_INVALID throw. */
const descriptorInvalid = expect.objectContaining({
  code: PartContractErrorCode.descriptorInvalid,
  source: 'part.contract'
})

describe('defineModel', () => {
  it('records schema, key, display and relations in a model descriptor', () => {
    /** Defined model. */
    const model = defineModel(spec)
    expect(model.descriptor.kind).toBe('model')
    expect(model.descriptor.model?.key).toEqual(['id'])
    expect(Object.keys(model.descriptor.model?.schema.properties as object)).toEqual([
      'id',
      'customer',
      'status'
    ])
    expect(model.schema).toBe(orderSchema)
  })

  it('keeps the descriptor unchanged when the caller later edits its hints and relations', () => {
    /** Caller-owned display hints and relations. */
    const display = { customer: { label: 'Customer' } }
    const relations = { lines: { target: 'line@1', cardinality: 'many' as const, via: ['id'] } }
    /** Defined model. */
    const model = defineModel({ ...spec, display, relations })
    display.customer.label = 'Changed'
    relations.lines.via.push('customer')
    expect(model.descriptor.model?.display?.customer?.label).toBe('Customer')
    expect(model.descriptor.model?.relations?.lines?.via).toEqual(['id'])
  })

  it.each([
    ['empty key', { ...spec, key: [] }],
    ['unknown key', { ...spec, key: ['missing'] }],
    ['unknown display field', { ...spec, display: { missing: { label: 'x' } } }],
    [
      'empty relation via',
      { ...spec, relations: { lines: { ...spec.relations!.lines!, via: [] } } }
    ],
    ['non-object schema', { ...spec, schema: schemaOf({ type: 'string' }) }]
  ])('rejects %s with DESCRIPTOR_INVALID', (_name, invalid) => {
    expect(() => defineModel(invalid as IModelSpec)).toThrow(descriptorInvalid)
  })
})
