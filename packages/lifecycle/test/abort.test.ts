import { describe, expect, it } from 'vitest'
import type { IAbortSignal } from '@migaia/utils/promise'
import { createAbortController, observeAbortSubscription } from '../src/abort.js'

describe('reason 行为', () => {
  it('abort(reason) 后 reason 经 signal.reason 保持 === 身份可达', () => {
    const controller = createAbortController()
    const reason = { code: 'CANCELLED' }
    controller.abort(reason)
    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBe(reason)
  })

  it('abort() 无 reason 时保留宿主原生 AbortError reason', () => {
    const controller = createAbortController()
    controller.abort()
    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toMatchObject({ name: 'AbortError' })
  })

  it('abort 幂等：后续 abort 不改写已固化的 reason（closing reason 不改写）', () => {
    const controller = createAbortController()
    const first = { code: 'first' }
    controller.abort(first)
    controller.abort({ code: 'second' })
    expect(controller.signal.reason).toBe(first)
  })

  it('按 callback 去重 once listener，重复注册只执行一次', () => {
    const controller = createAbortController()
    let calls = 0
    const listener = (): void => {
      calls++
    }

    controller.signal.addEventListener('abort', listener, { once: true })
    controller.signal.addEventListener('abort', listener, { once: true })
    controller.abort()

    expect(calls).toBe(1)
  })

  it('removeEventListener 按 callback 移除去重后的 once listener', () => {
    const controller = createAbortController()
    let calls = 0
    const listener = (): void => {
      calls++
    }

    controller.signal.addEventListener('abort', listener, { once: true })
    controller.signal.addEventListener('abort', listener, { once: true })
    controller.signal.removeEventListener('abort', listener)
    controller.abort()

    expect(calls).toBe(0)
  })

  it('returns the actual host-native AbortController instance', () => {
    const controller = createAbortController()
    const hostConstructor = (globalThis as { AbortController: Function }).AbortController
    expect(controller).toBeInstanceOf(hostConstructor)
  })

  it('exports the canonical hostile-signal subscription through the abort leaf', () => {
    const controller = createAbortController()
    const reason = { code: 'ABORTED' }
    let observedReason: unknown
    const subscription = observeAbortSubscription(
      controller.signal,
      (value) => {
        observedReason = value
      },
      () => undefined
    )

    controller.abort(reason)

    expect(observedReason).toBe(reason)
    subscription.unsubscribe()
  })
})

describe('signal 双向结构兼容', () => {
  it('createAbortController().signal 满足 @migaia/utils 的 IAbortSignal（compile-time）', () => {
    // lifecycle 与 serialize 不再各自声明 signal 结构，统一使用 utils 的 IAbortSignal。
    const signal: IAbortSignal = createAbortController().signal
    const forward: IAbortSignal = signal
    const backward: IAbortSignal = forward
    expect(backward).toBe(signal)
  })
})
