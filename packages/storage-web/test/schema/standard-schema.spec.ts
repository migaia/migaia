import { describe, expect, it } from 'vitest'
import { fromStandardSchema, type IStandardSchemaV1 } from '../../src/schema/standard-schema'

const numberSchema: IStandardSchemaV1<unknown, number> = {
  '~standard': {
    version: 1,
    vendor: 'fake-vendor',
    validate: (value) =>
      typeof value === 'number' ? { value } : { issues: [{ message: 'expected a number' }] }
  }
}

const asyncSchema: IStandardSchemaV1<unknown, number> = {
  '~standard': {
    version: 1,
    vendor: 'fake-async-vendor',
    validate: async (value) =>
      typeof value === 'number' ? { value } : { issues: [{ message: 'not a number' }] }
  }
}

describe('fromStandardSchema', () => {
  it('校验通过时返回 value', async () => {
    await expect(fromStandardSchema(numberSchema).validate(42)).resolves.toBe(42)
  })
  it('校验失败时抛 VALIDATION_FAILED，携带 issue 信息', async () => {
    await expect(fromStandardSchema(numberSchema).validate('not a number')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED'
    })
  })
  it('支持 async validate 实现', async () => {
    const adapter = fromStandardSchema(asyncSchema)
    await expect(adapter.validate(1)).resolves.toBe(1)
    await expect(adapter.validate('x')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
  it('name 携带 vendor 信息', () => {
    expect(fromStandardSchema(numberSchema).name).toBe('standard-schema:fake-vendor')
  })
  it('契约与成功 result 字段只读取一次', async () => {
    let contractReads = 0
    let resultReads = 0
    const adapter = fromStandardSchema<number>({
      get '~standard'() {
        contractReads += 1
        return {
          get version() {
            contractReads += 1
            return 1 as const
          },
          get vendor() {
            contractReads += 1
            return 'getter-vendor'
          },
          get validate() {
            contractReads += 1
            return async () => ({
              get issues() {
                resultReads += 1
                return undefined
              },
              get value() {
                resultReads += 1
                return 42
              }
            })
          }
        }
      }
    })
    await expect(adapter.validate('input')).resolves.toBe(42)
    expect(contractReads).toBe(4)
    expect(resultReads).toBe(2)
  })
  it('issue message 只读取一次', async () => {
    let reads = 0
    const adapter = fromStandardSchema({
      '~standard': {
        version: 1,
        vendor: 'getter-issue',
        validate: async () => ({
          issues: [
            {
              get message() {
                reads += 1
                return 'invalid'
              }
            }
          ]
        })
      }
    })
    await expect(adapter.validate('input')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(reads).toBe(1)
  })
  it('构造期拒绝畸形 Standard Schema 契约', () => {
    for (const schema of [null, [], {}, { '~standard': null }, { '~standard': {} }])
      expect(() => fromStandardSchema(schema as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
  })
  it('校验期拒绝畸形 Standard Schema result', async () => {
    for (const result of [null, [], {}, { issues: 'bad' }, { issues: [{}] }]) {
      const adapter = fromStandardSchema({
        '~standard': {
          version: 1,
          vendor: 'hostile',
          validate: async () => result as never
        }
      })
      await expect(adapter.validate('value')).rejects.toMatchObject({
        code: 'VALIDATION_FAILED'
      })
    }
  })
})
