import { describe, expect, it } from 'vitest'
import { invokeExtension } from '../../src/backends/backend-errors.js'
import { createStorageOperationRuntime } from '@migaia/storage-host/sdk'
import { captureOperationCleanup } from '../helpers/operation-reporter.js'

describe('invokeExtension abort lifecycle', () => {
  it('关闭 check-subscribe race 并阻止扩展结果胜出', async () => {
    let aborted = false
    const signal = {
      get aborted() {
        return aborted
      },
      reason: 'extension race',
      addEventListener: () => {
        aborted = true
      },
      removeEventListener: () => {}
    } as never
    await expect(
      invokeExtension(
        async () => 'late result',
        'memory',
        'entity.validate',
        'schema',
        signal,
        createStorageOperationRuntime()
      )
    ).rejects.toMatchObject({
      code: 'ABORTED',
      backend: 'memory'
    })
  })

  it('listener setup 错误归一化且 cleanup 错误不覆盖扩展结果', async () => {
    const setupCause = new Error('hostile extension listener setup')
    const setupSignal = {
      aborted: false,
      addEventListener: () => {
        throw setupCause
      },
      removeEventListener: () => {}
    } as never
    await expect(
      invokeExtension(
        async () => 'value',
        'memory',
        'entity.validate',
        'schema',
        setupSignal,
        createStorageOperationRuntime()
      )
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    const cleanupSignal = {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {
        throw new Error('hostile extension listener cleanup')
      }
    } as never
    const cleanup = await captureOperationCleanup(() =>
      invokeExtension(
        async () => 'value',
        'memory',
        'entity.validate',
        'schema',
        cleanupSignal,
        createStorageOperationRuntime()
      )
    )
    expect(cleanup.result).toBe('value')
    expect(cleanup.reports).toEqual([
      expect.objectContaining({ message: 'hostile extension listener cleanup' })
    ])
  })
})
