import { describe, expect, it } from 'vitest'

import { createConcurrencyLimiter } from '../src/promise.ts'

describe('promise primitives', () => {
  it('limits active work and rejects queued work on close', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let release!: () => void
    const first = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const second = limiter.run(() => 'second')
    expect(limiter.activeCount).toBe(1)
    expect(limiter.pendingCount).toBe(1)
    const closed = new Error('closed')
    limiter.close(closed)
    await expect(second).rejects.toBe(closed)
    release()
    await first
    await limiter.dispose()
    expect(limiter.activeCount).toBe(0)
  })

  it('starts a fresh whenIdle epoch after a previous idle settlement', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let release!: () => void
    const first = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const firstIdle = limiter.whenIdle()
    await Promise.resolve()
    release()
    await first
    await firstIdle

    let secondRelease!: () => void
    const second = limiter.run(() => new Promise<void>((resolve) => (secondRelease = resolve)))
    const secondIdle = limiter.whenIdle()
    let settled = false
    void secondIdle.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    secondRelease()
    await second
    await secondIdle
    await limiter.dispose()
  })

  it('does not replace a pending whenIdle waiter when dispose is called', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let release!: () => void
    const running = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const idle = limiter.whenIdle()
    const disposed = limiter.dispose()
    await Promise.resolve()
    release()
    await running
    await expect(idle).resolves.toBeUndefined()
    await expect(disposed).resolves.toBeUndefined()
  })

  it('snapshots limiter option getters exactly once at construction', async () => {
    let concurrencyReads = 0
    let reportReads = 0
    const limiter = createConcurrencyLimiter({
      get concurrency() {
        concurrencyReads += 1
        return 1
      },
      get report() {
        reportReads += 1
        return undefined
      }
    } as never)
    expect(concurrencyReads).toBe(1)
    expect(reportReads).toBe(1)
    await limiter.dispose()
  })

  it('snapshots a run signal getter exactly once before admission', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let signalReads = 0
    const signal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    } as never
    const runOptions = {
      get signal() {
        signalReads += 1
        return signal
      }
    } as never
    const pending = limiter.run(() => 'ok', runOptions)
    await expect(pending).resolves.toBe('ok')
    expect(signalReads).toBe(1)
    await limiter.dispose()
  })

  it('cleans queued abort listeners and preserves FIFO queue admission', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let release!: () => void
    const first = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const controller = new AbortController()
    const second = limiter.run(() => 'never', { signal: controller.signal as never })
    controller.abort('queued-stop')
    await expect(second).rejects.toBe('queued-stop')
    release()
    await first
    await limiter.dispose()
    expect(limiter.pendingCount).toBe(0)
  })

  it('reports hostile queued-listener cleanup without losing close settlement', async () => {
    const reports: unknown[] = []
    const limiter = createConcurrencyLimiter({
      concurrency: 1,
      report: (error) => reports.push(error)
    })
    let release!: () => void
    const active = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const signal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => {
        throw new Error('listener cleanup failed')
      }
    } as {
      aborted: boolean
      addEventListener: (type: 'abort', listener: () => void) => void
      removeEventListener: () => never
    }
    const pending = limiter.run(() => 'never', { signal })
    const reason = new Error('closed')
    expect(() => limiter.close(reason)).not.toThrow()
    await expect(pending).rejects.toBe(reason)
    expect(reports).toHaveLength(1)
    release()
    await active
    await limiter.dispose()
  })

  it('uses tagged utils errors for reasonless abort and limiter close', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    await expect(
      limiter.run(() => 'never', { signal: { aborted: true, reason: undefined } as never })
    ).rejects.toMatchObject({
      source: 'foundation.utils',
      code: 'ABORTED'
    })
    let release!: () => void
    const active = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const pending = limiter.run(() => 'never')
    limiter.close()
    await expect(pending).rejects.toMatchObject({
      source: 'foundation.utils',
      code: 'LIMITER_CLOSED'
    })
    release()
    await active
  })
})
