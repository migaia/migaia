import { describe, expect, it } from 'vitest'
import { StorageContractError } from '@migaia/storage-contract'
import { snapshotOperationContext } from '../src/authoring/context.js'

describe('信号结构等价（真实 AbortSignal 满足 IAbortSignal）', () => {
  it('真实 AbortController().signal 被 snapshotOperationContext 接受', () => {
    const controller = new AbortController()
    const snapshot = snapshotOperationContext({ signal: controller.signal })
    expect(snapshot?.signal).toBe(controller.signal)
  })

  it('非法 timeoutMs / pageSize 抛 contract invalidArgument', () => {
    expect(() => snapshotOperationContext({ timeoutMs: -1 } as never)).toThrow(StorageContractError)
    expect(() => snapshotOperationContext({ pageSize: 0 } as never)).toThrow(StorageContractError)
  })
})
