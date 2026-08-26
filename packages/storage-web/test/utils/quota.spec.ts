import { describe, expect, it } from 'vitest'
import { normalizeStorageException } from '../../src/utils/quota'
import { StorageError, StorageErrorCode } from '../../src/types/errors'

describe('normalizeStorageException', () => {
  it('已经是 StorageError 时原样返回', () => {
    const original = new StorageError(StorageErrorCode.invalidConfig)
    expect(normalizeStorageException(original, 'local')).toBe(original)
  })

  it('为缺少 owner 的 StorageError 补充 operation 且保留原始协议字段', () => {
    const cause = new Error('codec')
    const original = new StorageError(StorageErrorCode.extensionFailed, {
      backend: 'local',
      extensionStage: 'codec',
      cause
    })
    expect(normalizeStorageException(original, 'local', undefined, 'local.clearAll')).toMatchObject(
      {
        code: 'EXTENSION_FAILED',
        backend: 'local',
        extensionStage: 'codec',
        operation: 'local.clearAll',
        cause
      }
    )
  })

  it('QuotaExceededError（Chrome/Safari 标准 DOMException）归一为 QUOTA_EXCEEDED', () => {
    const domException = new DOMException('quota', 'QuotaExceededError')
    const normalized = normalizeStorageException(domException, 'local', 'k')
    expect(normalized.code).toBe('QUOTA_EXCEEDED')
    expect(normalized.backend).toBe('local')
    expect(normalized.key).toBe('k')
    expect(normalized.cause).toBe(domException)
  })

  it('鸭子类型的 QuotaExceededError（非标准异常对象）同样归一为 QUOTA_EXCEEDED', () => {
    const nonStandardException = { name: 'QuotaExceededError', message: 'quota' }
    expect(normalizeStorageException(nonStandardException, 'local').code).toBe('QUOTA_EXCEEDED')
  })

  it.each([
    { name: 'NS_ERROR_DOM_QUOTA_REACHED' },
    { code: 22 },
    { code: 1014 },
    { code: '22' },
    { code: '1014' },
    { code: 'NS_ERROR_DOM_QUOTA_REACHED' }
  ])('兼容旧浏览器配额标识 %#', (error) => {
    expect(normalizeStorageException(error, 'local').code).toBe('QUOTA_EXCEEDED')
  })

  it('其他异常归一为 BACKEND_UNAVAILABLE', () => {
    const error = new Error('boom')
    expect(normalizeStorageException(error, 'local').code).toBe('BACKEND_UNAVAILABLE')
  })
})

it('不覆盖已有 StorageError owner', () => {
  const original = new StorageError(StorageErrorCode.unavailable, {
    backend: 'session',
    key: 'owned-key',
    operation: 'session.keys'
  })
  expect(normalizeStorageException(original, 'local', 'outer-key', 'local.clearAll')).toBe(original)
})

it('补充 owner 时采用外层 backend/key 作为缺失字段', () => {
  const original = new StorageError(StorageErrorCode.unavailable)
  expect(
    normalizeStorageException(original, 'session', 'key', 'session.clearValues')
  ).toMatchObject({
    backend: 'session',
    key: 'key',
    operation: 'session.clearValues'
  })
})
