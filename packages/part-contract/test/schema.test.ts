import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  assertNoTransform,
  PartContractErrorCode,
  toCatalogSchema,
  validateArgs,
  type IStandardSchemaInput
} from '../src/index.ts'

/** Hand-written Standard Schema without the JSON Schema extension. */
const plain: IStandardSchemaInput = {
  '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) }
}

/** Standard Schema whose output conversion throws. */
const outputThrows: IStandardSchemaInput = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => ({ value }),
    jsonSchema: {
      input: () => ({ type: 'string' }),
      output: () => {
        throw new Error('output not representable')
      }
    }
  }
}

describe('standard schema intake', () => {
  it('converts a pure zod schema to draft 2020-12 JSON Schema', () => {
    const schema = z.object({ maxDays: z.number().int().positive() })
    const json = toCatalogSchema(schema)
    expect(json).toMatchObject({ type: 'object', properties: { maxDays: { type: 'integer' } } })
    expect(() => assertNoTransform(schema)).not.toThrow()
  })

  it('rejects transforming schemas and keeps the output failure on cause', () => {
    expect(() => assertNoTransform(z.string().transform((value) => value.length))).toThrow(
      expect.objectContaining({
        code: PartContractErrorCode.schemaTransforms,
        source: 'part.contract'
      })
    )
    try {
      assertNoTransform(outputThrows)
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: PartContractErrorCode.schemaTransforms })
      expect((error as Error).cause).toEqual(new Error('output not representable'))
    }
  })

  it('requires a JSON Schema source', () => {
    expect(() => toCatalogSchema(plain)).toThrow(
      expect.objectContaining({ code: PartContractErrorCode.schemaNotSerializable })
    )
    expect(toCatalogSchema(plain, { type: 'number' })).toEqual({ type: 'number' })
  })

  it('validates arguments and rejects with the original issues on cause', async () => {
    const schema = z.object({ maxDays: z.number().int().positive() })
    await expect(validateArgs(schema, { maxDays: 3 })).resolves.toEqual({ maxDays: 3 })
    const failure = await validateArgs(schema, { maxDays: -1 }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: PartContractErrorCode.argsInvalid })
    expect(Array.isArray((failure as Error).cause)).toBe(true)
  })
})
