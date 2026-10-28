import { describe, expect, it, vi } from 'vitest'
import { captureOperationCleanup } from '../helpers/operation-reporter.js'
import { assertOperationContext } from '@migaia/storage-contract'
import { mergeSignals, throwIfAborted, withAbort } from '@migaia/storage-host/sdk'

const noopReporter = (): void => {}

describe('throwIfAborted', () => {
  it('非法 timeoutMs 抛 INVALID_ARGUMENT', () => {
    for (const timeoutMs of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => assertOperationContext({ timeoutMs })).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
  })
  it('拒绝非法 context 容器与 signal', () => {
    for (const ctx of [null, [], 'context', 1])
      expect(() => assertOperationContext(ctx as never)).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    for (const signal of [null, [], {}, { aborted: false }, { aborted: 'no' }])
      expect(() => assertOperationContext({ signal } as never)).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
  })
  it('未 abort 时不抛错', () => {
    const controller = new AbortController()
    expect(() => throwIfAborted(controller.signal)).not.toThrow()
  })
  it('已 abort 时抛 ABORTED', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => throwIfAborted(controller.signal)).toThrow(
      expect.objectContaining({ code: 'ABORTED' })
    )
  })

  it('signal 为 undefined 时不抛错', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow()
  })
})

describe('mergeSignals', () => {
  it('preserves the migrated signal getter and event-reason trace', () => {
    let aborted = false
    let listener: (() => void) | undefined
    const reason = new Error('storage external abort')
    const calls = {
      aborted: 0,
      reason: 0,
      addGetter: 0,
      addCall: 0,
      removeGetter: 0,
      removeCall: 0
    }
    const signal = {
      get aborted() {
        calls.aborted += 1
        return aborted
      },
      get reason() {
        calls.reason += 1
        return reason
      },
      get addEventListener() {
        calls.addGetter += 1
        return (_type: 'abort', callback: () => void) => {
          calls.addCall += 1
          listener = callback
        }
      },
      get removeEventListener() {
        calls.removeGetter += 1
        return () => {
          calls.removeCall += 1
        }
      }
    }

    const merged = mergeSignals({ signal: signal as never, timeoutMs: 1000 }, noopReporter)
    expect(calls).toEqual({
      aborted: 3,
      reason: 0,
      addGetter: 2,
      addCall: 1,
      removeGetter: 1,
      removeCall: 0
    })
    aborted = true
    listener?.()
    expect(merged.signal?.reason).toBe(reason)
    expect(calls.aborted).toBe(3)
    expect(calls.reason).toBe(1)
    merged.dispose()
    merged.dispose()
    expect(calls.removeGetter).toBe(2)
    expect(calls.removeCall).toBe(1)
  })

  it('maps a post-subscribe observation failure and rolls cleanup back once', () => {
    const failure = new Error('storage post-subscribe observation failed')
    let abortedReads = 0
    let removeCount = 0
    const signal = {
      get aborted(): boolean {
        abortedReads += 1
        if (abortedReads === 3) throw failure
        return false
      },
      addEventListener: () => undefined,
      removeEventListener: () => {
        removeCount += 1
      }
    }

    expect(() => mergeSignals({ signal: signal as never, timeoutMs: 1000 }, noopReporter)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: failure })
    )
    expect(removeCount).toBe(1)
  })

  it('keeps the timeout error identity reachable through the storage abort cause', () => {
    const merged = mergeSignals({ timeoutMs: 0 }, noopReporter)
    const timeoutReason = merged.signal?.reason
    expect(timeoutReason).toMatchObject({ source: 'storage.contract', code: 'ABORTED' })
    try {
      throwIfAborted(merged.signal)
      throw new Error('expected timeout abort')
    } catch (error) {
      expect(error).toMatchObject({
        source: 'storage.contract',
        code: 'ABORTED',
        cause: timeoutReason
      })
    } finally {
      merged.dispose()
    }
  })

  it('无 ctx 时返回 undefined signal 与空 dispose', () => {
    const { signal, dispose } = mergeSignals(undefined, noopReporter)
    expect(signal).toBeUndefined()
    expect(() => dispose()).not.toThrow()
  })
  it('只有外部 signal 时原样返回', () => {
    const controller = new AbortController()
    const { signal } = mergeSignals({ signal: controller.signal }, noopReporter)
    expect(signal).toBe(controller.signal)
  })
  it('operation context 保留 signal 和选项值', async () => {
    const controller = new AbortController()
    const context = {
      signal: controller.signal,
      timeoutMs: undefined,
      pageSize: 64,
      conflictPolicy: 'replace' as const
    }
    await expect(
      withAbort(context, async (signal, snapshot) => ({ signal, snapshot }))
    ).resolves.toEqual({
      signal: controller.signal,
      snapshot: {
        signal: controller.signal,
        timeoutMs: undefined,
        pageSize: 64,
        conflictPolicy: 'replace'
      }
    })
  })
  it('operation context 可跨层复用', async () => {
    const controller = new AbortController()
    const snapshot = mergeSignals({ signal: controller.signal }, noopReporter).context
    await expect(withAbort(snapshot, async () => 42)).resolves.toBe(42)
    expect(snapshot?.signal).toBe(controller.signal)
  })
  it('timeoutMs 到期后合成 signal 被 abort', async () => {
    const { signal, dispose } = mergeSignals({ timeoutMs: 5 }, noopReporter)
    expect(signal?.aborted).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(signal?.aborted).toBe(true)
    dispose()
  })
  it('外部 signal 已 abort 时合成 signal 立即 abort', () => {
    const controller = new AbortController()
    controller.abort('external reason')
    const { signal, dispose } = mergeSignals(
      { signal: controller.signal, timeoutMs: 1000 },
      noopReporter
    )
    expect(signal?.aborted).toBe(true)
    dispose()
  })
  it('外部 signal 后触发时合成 signal 跟着 abort', () => {
    const controller = new AbortController()
    const { signal, dispose } = mergeSignals(
      { signal: controller.signal, timeoutMs: 1000 },
      noopReporter
    )
    expect(signal?.aborted).toBe(false)
    controller.abort()
    expect(signal?.aborted).toBe(true)
    dispose()
  })
  it('外部 abort 发生在检查与 listener 注册之间时不会丢失', () => {
    let aborted = false
    const external = {
      get aborted() {
        return aborted
      },
      reason: 'race abort',
      addEventListener: () => {
        aborted = true
      },
      removeEventListener: () => {}
    }
    const merged = mergeSignals({ signal: external as never, timeoutMs: 1000 }, noopReporter)
    expect(merged.signal?.aborted).toBe(true)
    expect(merged.signal?.reason).toBe('race abort')
    merged.dispose()
  })
  it('listener setup 失败时清理 timer 并归一错误', () => {
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout')
    const cause = new Error('hostile addEventListener')
    expect(() =>
      mergeSignals(
        {
          timeoutMs: 1000,
          signal: {
            aborted: false,
            addEventListener: () => {
              throw cause
            },
            removeEventListener: () => {}
          } as never
        },
        noopReporter
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause }))
    expect(clearTimer).toHaveBeenCalledOnce()
    clearTimer.mockRestore()
  })
  it('listener cleanup 失败不覆盖已完成 operation 结果', async () => {
    const cleanup = await captureOperationCleanup(() =>
      withAbort(
        {
          timeoutMs: 1000,
          signal: {
            aborted: false,
            addEventListener: () => {},
            removeEventListener: () => {
              throw new Error('hostile removeEventListener')
            }
          } as never
        },
        async () => 42
      )
    )
    expect(cleanup.result).toBe(42)
    expect(cleanup.reports).toEqual([
      expect.objectContaining({ message: 'hostile removeEventListener' })
    ])
  })
  it('timeoutMs 为 0 时立即 abort，不创建延迟操作', () => {
    const { signal, dispose } = mergeSignals({ timeoutMs: 0 }, noopReporter)
    expect(signal?.aborted).toBe(true)
    dispose()
  })
})

describe('withAbort', () => {
  it('已 abort 时 run 不被调用', async () => {
    const controller = new AbortController()
    controller.abort()
    let called = false
    await expect(
      withAbort({ signal: controller.signal }, async () => {
        called = true
      })
    ).rejects.toMatchObject({ code: 'ABORTED' })
    expect(called).toBe(false)
  })
  it('入口检查失败后仍清理合成 signal', async () => {
    await expect(withAbort({ timeoutMs: 0 }, async () => 42)).rejects.toMatchObject({
      code: 'ABORTED'
    })
  })
  it('正常路径返回 run 的结果', async () => {
    await expect(withAbort(undefined, async () => 42)).resolves.toBe(42)
  })
  it('执行完成后 dispose 被调用（timer 不再挂起）', async () => {
    const result = await withAbort({ timeoutMs: 1000 }, async () => 'done')
    expect(result).toBe('done')
  })
})
