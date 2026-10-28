import { describe, expect, it } from 'vitest'
import { StorageError } from '../../src/types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'

describe('StorageError', () => {
  it('公开错误码集合保持 25 个稳定值且无重复', () => {
    const codes = Object.values(StorageBrowserErrorCode)
    expect([...codes].sort()).toEqual(
      [
        'BACKEND_UNAVAILABLE',
        'QUOTA_EXCEEDED',
        'VALUE_TOO_LARGE',
        'SERIALIZE_FAILED',
        'DESERIALIZE_FAILED',
        'TRANSACTION_FAILED',
        'DUPLICATE_KEY',
        'VERSION_UNSUPPORTED',
        'EXTENSION_FAILED',
        'WRITE_FAILED',
        'COOKIE_SCOPE_AMBIGUOUS',
        'INVALID_CONFIG',
        'INDEX_ORPHAN',
        'INDEX_UNIQUE_CONFLICT',
        'INDEX_QUERY_INVALIDATED',
        'LIVE_QUERY_DISPOSED',
        'INDEX_BACKFILL_STALE',
        'INDEX_BACKFILL_FAILED',
        'LIVE_QUERY_DISPOSE_FAILED',
        'REACTIVE_FEATURE_INVALID',
        'REACTIVE_ADAPTER_NOT_INSTALLED',
        'REACTIVE_ADAPTER_FAILED',
        'REACTIVE_ADAPTER_DISPOSE_FAILED',
        'BACKEND_DISPOSE_FAILED',
        'INDEXED_DB_FEATURE_NOT_INSTALLED'
      ].sort()
    )
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('StorageBrowserErrorCode runtime descriptor 不可变', () => {
    expect(() => {
      ;(StorageBrowserErrorCode as { invalidConfig: string }).invalidConfig = 'changed'
    }).toThrow(TypeError)
    expect(StorageBrowserErrorCode.invalidConfig).toBe('INVALID_CONFIG')
  })

  it('携带 code/backend/key', () => {
    const error = new StorageError(StorageBrowserErrorCode.quotaExceeded, {
      backend: 'local',
      key: 'k'
    })
    expect(error.code).toBe('QUOTA_EXCEEDED')
    expect(error.backend).toBe('local')
    expect(error.key).toBe('k')
  })

  it('原始异常进 cause，不改写自身 message', () => {
    const cause = new Error('原始信息')
    const error = new StorageError(StorageBrowserErrorCode.unavailable, { cause })
    expect(error.cause).toBe(cause)
    expect(cause.message).toBe('原始信息')
  })
  it('未提供 message 时使用默认文案', () => {
    expect(new StorageError(StorageBrowserErrorCode.invalidConfig).message).toContain(
      'INVALID_CONFIG'
    )
  })
  it('name 固定为 StorageError', () => {
    expect(new StorageError(StorageBrowserErrorCode.invalidConfig).name).toBe('StorageError')
  })
})
