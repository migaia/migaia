import { describe, expect, it } from 'vitest'
import {
  SERIALIZE_SOURCE,
  SerializeErrorCode,
  createSerializeError,
  createSerializeRangeError,
  createSerializeTypeError,
  tagSerializeError
} from '../src/errors.ts'

describe('serialize error-code contract', () => {
  it('declares 11 unique codes under the package source', () => {
    const codes = Object.values(SerializeErrorCode)
    expect(codes).toHaveLength(11)
    expect(new Set(codes).size).toBe(11)
    expect(codes).toEqual(
      expect.arrayContaining(['ENV_UNSUPPORTED', 'TAG_MISSING', 'TAG_INVALID', 'TAG_UNKNOWN'])
    )
    expect(SERIALIZE_SOURCE).toBe('serialization')
  })
})

describe('tag 幂等（方案 A）', () => {
  it('同 (source, code) 二次 tag 不抛、context 只在未定义时写入', () => {
    const error = new Error('boom')
    tagSerializeError(error, SerializeErrorCode.invalidOption, 'registry.plugin:x')
    const again = tagSerializeError(error, SerializeErrorCode.invalidOption, 'override')
    expect(again).toBe(error)
    expect(error).toMatchObject({
      source: SERIALIZE_SOURCE,
      code: 'INVALID_OPTION',
      context: 'registry.plugin:x'
    })
  })

  it('异 (source, code) 二次 tag 抛 TypeError，不覆盖原始 code/source', () => {
    const error = new Error('boom')
    tagSerializeError(error, SerializeErrorCode.invalidOption)
    expect(() => tagSerializeError(error, SerializeErrorCode.aborted)).toThrowError(TypeError)
    expect(error).toMatchObject({ source: SERIALIZE_SOURCE, code: 'INVALID_OPTION' })
  })
})

describe('错误工厂返回类型', () => {
  it('createSerializeTypeError 返回原生 TypeError + code/source', () => {
    const error = createSerializeTypeError(SerializeErrorCode.invalidOption, 'bad scheduler')
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toMatchObject({ source: SERIALIZE_SOURCE, code: 'INVALID_OPTION' })
  })

  it('createSerializeRangeError 返回原生 RangeError + code/source', () => {
    const error = createSerializeRangeError(SerializeErrorCode.invalidOption, 'empty plugins')
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ source: SERIALIZE_SOURCE, code: 'INVALID_OPTION' })
  })

  it('createSerializeError 支持 cause 与冻结的 errors 快照', () => {
    const cause = new Error('missing TextEncoder')
    const rollback = new Error('rollback failed')
    const error = createSerializeError(SerializeErrorCode.envUnsupported, 'env missing', {
      cause,
      errors: [rollback]
    })
    expect(error.cause).toBe(cause)
    expect(error.errors).toHaveLength(1)
    expect(error.errors?.[0]).toBe(rollback)
    expect(Object.isFrozen(error.errors)).toBe(true)
  })
})
