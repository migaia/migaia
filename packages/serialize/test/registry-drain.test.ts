import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import * as utilsRoot from '@migaia/utils'
import * as utilsScheduler from '@migaia/utils/scheduler'
import * as lifecycleScheduler from '@migaia/lifecycle/scheduler'
import { createAbortController } from '@migaia/lifecycle'
import { type IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import {
  createSerializeRegistry,
  type ISerializeChunk,
  type ISerializeRegistryOptions
} from '../src/index.ts'

import { plugin } from './fixtures/registry.ts'

describe('dispose 等待在途 encode/decode 结算后才释放 parser', () => {
  it('dispose() 等待在途 encode 完成后才释放 parser（不再并发释放正在用的资源）', async () => {
    let releaseInFlight: (() => void) | undefined
    let disposeCalled = false
    const inFlight = new Promise<void>((resolve) => {
      releaseInFlight = resolve
    })
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: async (): Promise<ISerializeChunk> => {
          await inFlight
          return ['text', 'done']
        },
        decode: (c) => c,
        dispose: () => {
          disposeCalled = true
        }
      })
    ])

    const pending = registry.encode('x', { type: 'a' })
    const disposePromise = registry.dispose()
    // dispose 已进入 drain 阶段，但 parser 尚未释放（在途 encode 未结算）
    expect(disposeCalled).toBe(false)

    releaseInFlight?.()
    await disposePromise
    // 在途 encode 结算（被 closing 信号 abort 后 reject）后，parser 才被释放
    expect(disposeCalled).toBe(true)
    await expect(pending).rejects.toThrow(/aborted/)
  })
})

describe('cleanup 判别联合 + detached sink', () => {
  it('cleanup report 策略：dispose 最终 resolve，reporter 收到 cleanup error', async () => {
    const boom = new Error('boom')
    const reported: unknown[] = []
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (v) => ['text', String(v)],
          decode: (c) => c,
          dispose: () => {
            throw boom
          }
        })
      ],
      { cleanup: { policy: 'report', report: (d) => reported.push(d) } }
    )
    await expect(registry.dispose()).resolves.toBeUndefined()
    expect(reported).toHaveLength(1)
    expect(reported[0]).toMatchObject({ kind: 'cleanup-error', error: boom })
  })

  it('onDrainTimeout 抛错不阻断 cleanup', async () => {
    const manual = createManualScheduler()
    let disposed = false
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: async (): Promise<ISerializeChunk> => {
            await gate
            return ['text', 'x']
          },
          decode: (c) => c,
          dispose: () => {
            disposed = true
          }
        })
      ],
      {
        scheduler: manual,
        onDrainTimeout: () => {
          throw new Error('timeout boom')
        }
      }
    )
    const pending = registry.encode('x', { type: 'a' }).catch(() => undefined)
    const disposePromise = registry.dispose({ deadlineAt: 100 })
    manual.advance(101)
    await disposePromise
    expect(disposed).toBe(true)
    release?.()
    await pending
  })
})

describe('iterator.return 错误专项', () => {
  it('return() 失败和 detached abort 均 report，不覆盖 public abort', async () => {
    const reported: unknown[] = []
    const controller = createAbortController()
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: () => {
            let first = true
            return {
              [Symbol.asyncIterator]() {
                return {
                  async next() {
                    if (first) {
                      first = false
                      controller.abort('stop')
                      return { done: false, value: ['text', 'x'] as ISerializeChunk }
                    }
                    return { done: true, value: undefined }
                  },
                  async return() {
                    throw new Error('return boom')
                  }
                }
              }
            }
          },
          decode: (c) => c
        })
      ],
      { report: (e) => reported.push(e) }
    )
    await expect(registry.encode('x', { type: 'a', signal: controller.signal })).rejects.toThrow(
      /aborted/
    )
    expect(reported).toHaveLength(2)
    expect((reported[0] as Error).message).toBe('return boom')
    expect(reported[1]).toMatchObject({ code: 'ABORTED', cause: 'stop' })
  })
})

describe('abort → return() 悬挂 → deadline 竞态', () => {
  it('deadline 到达后 dispose 不等 return()；迟到 return rejection 被观测，cleanup 已执行', async () => {
    const manual = createManualScheduler()
    const controller = createAbortController()
    const reported: unknown[] = []
    let rejectReturn: ((error: unknown) => void) | undefined
    // return() 挂起（永不 settle，直到测试显式 reject）。
    const returnPending = new Promise<IteratorResult<ISerializeChunk>>((_, reject) => {
      rejectReturn = reject
    })
    let disposed = false

    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: () => {
            let first = true
            return {
              [Symbol.asyncIterator]() {
                return {
                  async next() {
                    if (first) {
                      first = false
                      controller.abort('stop')
                      return { done: false, value: ['text', 'x'] as ISerializeChunk }
                    }
                    return { done: true, value: undefined }
                  },
                  return(): Promise<IteratorResult<ISerializeChunk>> {
                    return returnPending
                  }
                }
              }
            }
          },
          decode: (c) => c,
          dispose: () => {
            disposed = true
          }
        })
      ],
      { scheduler: manual, report: (e) => reported.push(e) }
    )

    // encode 卡在 await iterator.return()（悬挂），registry 持有 1 个 in-flight lease。
    const encodePromise = registry.encode('x', { type: 'a', signal: controller.signal })
    const disposePromise = registry.dispose({ deadlineAt: 100 })
    manual.advance(100)
    await disposePromise

    // deadline 赢：cleanup 不等 return()，parser 已被同步释放（terminal）。
    expect(disposed).toBe(true)

    // 迟到 return() rejection：在 drain 阶段（task settle 之前）就被 report 观测。
    rejectReturn?.(new Error('late return rejection'))

    // encode task 以 aborted 拒绝；await 它既观测该 rejection（不 unhandled），
    // 也确立「return() 的 report 已执行」的时序。track 的 then 先于本断言注册，
    // 故其 report(aborted) 也已入队；再补一个微任务 tick 兜底，不依赖真实定时器。
    await expect(encodePromise).rejects.toThrow(/aborted/)
    await Promise.resolve()
    expect(reported.some((e) => (e as Error).message === 'late return rejection')).toBe(true)
    // detached task 的 aborted rejection 同样进入 report，与 registry 生命周期解耦、不改变 terminal。
    expect(reported.some((e) => (e as Error).message.includes('aborted'))).toBe(true)
  })
})

describe('detached 迟到错误经 report 通道', () => {
  it('report 自身失败交宿主异常通路，迟到 rejection 被观察且不改变 terminal', async () => {
    const manual = createManualScheduler()
    let rejectGate: ((reason: unknown) => void) | undefined
    const gate = new Promise<unknown>((_, reject) => {
      rejectGate = reject
    })
    let reportCalls = 0
    /** The same secondary reporter failure must remain observable at the host boundary. */
    const reporterFailure = new Error('report boom')
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: async (): Promise<ISerializeChunk> => {
            await gate
            return ['text', 'x']
          },
          decode: (c) => c
        })
      ],
      {
        scheduler: manual,
        report: () => {
          reportCalls++
          throw reporterFailure
        }
      }
    )
    const pending = registry.encode('x', { type: 'a' })
    const disposePromise = registry.dispose({ deadlineAt: 100 })
    manual.advance(100)
    await disposePromise

    /** Capture the existing host diagnostic seam without executing an uncaught host throw. */
    const hostCallbacks: (() => void)[] = []
    /** Restore host scheduling even when an assertion fails. */
    const enqueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      hostCallbacks.push(callback)
    })
    try {
      rejectGate?.(new Error('late encode boom'))
      await expect(pending).rejects.toThrow(/aborted/)
      for (let turn = 0; turn < 8; turn++) await Promise.resolve()
      expect(reportCalls).toBe(1)
      expect(hostCallbacks).toHaveLength(1)
      expect(hostCallbacks[0]).toThrow(reporterFailure)
      expect(registry.dispose()).toBe(disposePromise)
    } finally {
      enqueue.mockRestore()
    }
  })

  it('无 report 时走 no-op fallback：迟到 rejection 被 catch 观测、不 unhandled', async () => {
    const manual = createManualScheduler()
    let rejectGate: ((reason: unknown) => void) | undefined
    const gate = new Promise<unknown>((_, reject) => {
      rejectGate = reject
    })
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: async (): Promise<ISerializeChunk> => {
            await gate
            return ['text', 'x']
          },
          decode: (c) => c
        })
      ],
      { scheduler: manual } // 无 report
    )
    const pending = registry.encode('x', { type: 'a' })
    const disposePromise = registry.dispose({ deadlineAt: 100 })
    manual.advance(100)
    await disposePromise

    // 无 report：迟到 rejection 仍被 track 的 rejection handler 观测（不 unhandled）。
    rejectGate?.(new Error('late encode boom'))
    await expect(pending).rejects.toThrow(/aborted/)
  })
})

describe('single scheduler export surface consumed by serialize', () => {
  it('exposes runtime schedulers through utils and reserves manual scheduling for testing', () => {
    expect(utilsRoot.systemScheduler).toBe(utilsScheduler.systemScheduler)
    expect('createManualScheduler' in utilsRoot).toBe(false)
    expect('createManualScheduler' in utilsScheduler).toBe(false)
    expect(utilsRoot.systemWallClock).toBe(utilsScheduler.systemWallClock)
    expect('systemScheduler' in lifecycleScheduler).toBe(false)
    expect('createManualScheduler' in lifecycleScheduler).toBe(false)
    expectTypeOf<NonNullable<ISerializeRegistryOptions['scheduler']>>().toEqualTypeOf<IScheduler>()
  })

  it('drives a registry drain timeout with the utils manual scheduler', async () => {
    const manual = createManualScheduler()
    /** Drain timeout diagnostics received by the registry option. */
    const timeouts: unknown[] = []
    /** Releases the in-flight encode after the drain deadline. */
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: async (): Promise<ISerializeChunk> => {
            await gate
            return ['text', 'x']
          },
          decode: (chunk) => chunk
        })
      ],
      { scheduler: manual, onDrainTimeout: (diagnostic) => timeouts.push(diagnostic) }
    )
    const pending = registry.encode('x', { type: 'a' }).catch(() => undefined)
    const disposePromise = registry.dispose({ deadlineAt: 100 })
    manual.advance(99)
    expect(timeouts).toHaveLength(0)
    manual.advance(2)
    await expect(disposePromise).resolves.toBeUndefined()
    expect(timeouts).toHaveLength(1)
    release?.()
    await pending
  })
})
