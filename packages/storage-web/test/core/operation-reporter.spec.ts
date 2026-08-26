import { describe, expect, it, vi } from 'vitest'
import {
  reportCleanupError,
  createStorageOperationReporter
} from '../../src/core/operation-reporter.js'

describe('operation reporter（T-14 cleanup 观测）', () => {
  it('cleanup 错误传给 primary reporter（原始错误）', () => {
    const received: unknown[] = []
    reportCleanupError((error) => {
      received.push(error)
    }, new Error('cleanup failed'))
    expect(received).toHaveLength(1)
    expect((received[0] as Error).message).toBe('cleanup failed')
  })

  it('reporter 自身抛错时不抛出、走 fallback、不产生 unhandled rejection', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = (): void => {
      throw new Error('reporter failed')
    }
    expect(() => reportCleanupError(reporter, new Error('cleanup'))).not.toThrow()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('fallback 自身也失败时仍不抛出（最终硬吞）', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console.error failed')
    })
    const reporter = (): void => {
      throw new Error('reporter failed')
    }
    expect(() => reportCleanupError(reporter, new Error('cleanup'))).not.toThrow()
    consoleError.mockRestore()
  })

  it('默认 reporter 为函数（非 singleton 工厂）', () => {
    const a = createStorageOperationReporter()
    const b = createStorageOperationReporter()
    expect(typeof a).toBe('function')
    expect(a).not.toBe(b)
  })
})
