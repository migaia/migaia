import { describe, expect, it, vi } from 'vitest'
import { PluginHost } from '../src/host-runtime'
import { createManualScheduler } from '@migaia/lifecycle'

class Host extends PluginHost<Record<string, never>, string> {}

describe('AF-T10 plugin-host scheduler/policy options', () => {
  it('rejects NaN/Infinity/negative timeout options with INVALID_OPTION', () => {
    for (const value of [NaN, Infinity, -Infinity, -1]) {
      expect(() => new Host({ queueAdmissionTimeoutMs: value } as any)).toThrow(TypeError)
      expect(() => new Host({ disposeStepTimeoutMs: value } as any)).toThrow(TypeError)
    }
  })

  it('unconfigured queue timeout only diagnoses, never rejects', async () => {
    vi.useFakeTimers()
    try {
      const diagnostics: string[] = []
      const host = new Host({ diagnostic: (message: string) => diagnostics.push(message) } as any)
      const blocking = host.use({
        name: 'blocking',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000))
          return {}
        }
      } as any)
      const queued = host.use({ name: 'queued', install: () => ({}) } as any)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(diagnostics.length).toBeGreaterThan(0)
      expect(diagnostics[0]).toMatch(/queued|mutation/i)
      // 未配置 reject 阈值：任务仍在排队，不被拒绝。
      await vi.advanceTimersByTimeAsync(8_000)
      await expect(blocking).resolves.toBeDefined()
      await expect(queued).resolves.toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('queueAdmissionTimeoutMs: false never rejects and never diagnoses', async () => {
    vi.useFakeTimers()
    try {
      const diagnostics: string[] = []
      const host = new Host({
        diagnostic: (message: string) => diagnostics.push(message),
        queueAdmissionTimeoutMs: false
      } as any)
      const blocking = host.use({
        name: 'blocking',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000))
          return {}
        }
      } as any)
      const queued = host.use({ name: 'queued', install: () => ({}) } as any)
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(blocking).resolves.toBeDefined()
      await expect(queued).resolves.toBeDefined()
      expect(diagnostics).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('queueAdmissionTimeoutMs: number rejects exactly at the configured time', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host({ queueAdmissionTimeoutMs: 1_000 } as any)
      const blocking = host.use({
        name: 'blocking',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000))
          return {}
        }
      } as any)
      void blocking.catch(() => undefined)
      const queued = host.use({ name: 'queued', install: () => ({}) } as any)
      let rejected: unknown
      void queued.catch((error) => (rejected = error))
      await vi.advanceTimersByTimeAsync(999)
      expect(rejected).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect((rejected as { code?: string } | undefined)?.code).toBe('MUTATION_QUEUE_TIMEOUT')
    } finally {
      vi.useRealTimers()
    }
  })

  it('disposeStepTimeoutMs: false waits forever instead of forcing', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host({ disposeStepTimeoutMs: false } as any)
      let disposed = false
      await host.use({
        name: 'slow',
        install: (core: any) => {
          core.onDispose(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10_000))
            disposed = true
          })
          return {}
        }
      } as any)
      const disposePromise = host.dispose()
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(disposePromise).resolves.toBeUndefined()
      expect(disposed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('AF-T19: a scheduler missing now/schedule is rejected with INVALID_OPTION', () => {
    expect(() => new Host({ scheduler: {} } as any)).toThrow(TypeError)
    expect(() => new Host({ scheduler: { now: 'x', schedule: () => undefined } } as any)).toThrow(
      TypeError
    )
  })

  it('AF-T18: dispose step timeout is driven by the injected manual scheduler (no host timer)', async () => {
    const scheduler = createManualScheduler()
    const host = new Host({ scheduler, disposeStepTimeoutMs: 100 } as any)
    await host.use({
      name: 'stuck',
      install: (core: any) => {
        core.onDispose(() => new Promise<void>(() => {})) // never settles
        return {}
      }
    } as any)
    const disposePromise = host.dispose()
    await Promise.resolve()
    await Promise.resolve()
    // 只推进注入的 manual scheduler；真实 host timer 不参与。
    scheduler.advance(100)
    const outcome = await disposePromise.catch((error: unknown) => error)
    expect(String((outcome as any)?.cause?.cause?.message ?? outcome)).toMatch(/等待超过 100ms/)
  })

  it('AF-T28: hostile scheduler getter is wrapped as INVALID_OPTION with the original as cause', () => {
    const getterError = new Error('scheduler getter boom')
    const scheduler = new Proxy(
      {},
      {
        get() {
          throw getterError
        }
      }
    )
    let caught: unknown
    try {
      new Host({ scheduler: scheduler as any })
    } catch (error) {
      caught = error
    }
    expect((caught as { code?: string }).code).toBe('INVALID_OPTION')
    expect((caught as { cause?: unknown }).cause).toBe(getterError)
  })

  it('AF-T31: scheduler is read exactly once and the validated snapshot is used', () => {
    let reads = 0
    const scheduler = { now: () => 0, schedule: () => ({ cancel: () => {} }) }
    const options = {
      get scheduler() {
        reads += 1
        return scheduler
      }
    }
    new Host(options as any)
    expect(reads).toBe(1)
  })
})
