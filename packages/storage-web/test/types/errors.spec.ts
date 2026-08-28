import { describe, expect, it } from 'vitest'
import { StorageError, StorageErrorCode } from '../../src/types/errors'

describe('StorageError', () => {
  it('公开错误码集合保持 36 个稳定值且无重复', () => {
    const codes = Object.values(StorageErrorCode)
    expect(codes).toHaveLength(36)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('StorageErrorCode runtime descriptor 不可变', () => {
    expect(() => {
      ;(StorageErrorCode as { invalidConfig: string }).invalidConfig = 'changed'
    }).toThrow(TypeError)
    expect(StorageErrorCode.invalidConfig).toBe('INVALID_CONFIG')
  })

  it('携带 code/backend/key', () => {
    const error = new StorageError(StorageErrorCode.quotaExceeded, {
      backend: 'local',
      key: 'k'
    })
    expect(error.code).toBe('QUOTA_EXCEEDED')
    expect(error.backend).toBe('local')
    expect(error.key).toBe('k')
  })
  it('StorageError 实例字段在运行时不可变', () => {
    const error = new StorageError(StorageErrorCode.invalidConfig)
    expect(() => {
      ;(error as { code: string }).code = 'changed'
    }).toThrow(TypeError)
    expect(error.code).toBe('INVALID_CONFIG')
  })
  it('原始异常进 cause，不改写自身 message', () => {
    const cause = new Error('原始信息')
    const error = new StorageError(StorageErrorCode.unavailable, { cause })
    expect(error.cause).toBe(cause)
    expect(cause.message).toBe('原始信息')
  })
  it('未提供 message 时使用默认文案', () => {
    expect(new StorageError(StorageErrorCode.invalidConfig).message).toContain('INVALID_CONFIG')
  })
  it('name 固定为 StorageError', () => {
    expect(new StorageError(StorageErrorCode.invalidConfig).name).toBe('StorageError')
  })
})
