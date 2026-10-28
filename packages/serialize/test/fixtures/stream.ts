import { expect, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'

/** Creates ordered stream input rows with deterministic identifiers. */
export const rows = (count: number) => Array.from({ length: count }, (_, id) => ({ id }))

/** 立即让出，测试里不必真的等 setTimeout。 */
export const immediateYield = () => Promise.resolve()

/** 每个需要 scheduler 的流测试各取一个独立手动时钟，避免用例间共享可变时钟。 */
export const scheduler = () => createManualScheduler()

/** 局部类型化访问 node 的 process：应用工程刻意不引 @types/node， 不该为了一个测试把它拉进整个 src 的类型环境。 */
type IRejectionHost = {
  on(event: 'unhandledRejection', listener: () => void): void
  off(event: 'unhandledRejection', listener: () => void): void
}
/** Host rejection event seam shared by the unchanged stream cases. */
export const rejectionHost = (globalThis as { process?: IRejectionHost }).process

/** Minimal structural signal lets the unchanged cases expose registration and removal failures. */
export type ITestAbortSignal = {
  readonly aborted: boolean
  readonly reason: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** Await one hostile-signal result and verify its rejection is observed without a detached event. */
export const observeYieldResult = async (promise: Promise<unknown>): Promise<unknown> => {
  /** Host observer detects a rejection detached from the explicitly awaited operation. */
  const unhandled = vi.fn()
  rejectionHost?.on('unhandledRejection', unhandled)
  /** Preserve the operation's original thrown value for the case's identity assertions. */
  const result = await promise.catch((caught: unknown) => caught)
  await Promise.resolve()
  rejectionHost?.off('unhandledRejection', unhandled)
  expect(unhandled).not.toHaveBeenCalled()
  return result
}
