import { describe, expect, it, vi } from 'vitest'
import { PluginHost, PluginHostError } from '../src/index.js'
import { createManualScheduler } from '@migaia/lifecycle'

class Host extends PluginHost<Record<string, never>, string> {
  /** Supplies an explicit test policy while preserving each test's option override. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }
}

describe('AF-T10 plugin-host scheduler/policy options', () => {
  it('rejects NaN/Infinity/negative timeout options with INVALID_OPTION', () => {
    for (const value of [NaN, Infinity, -Infinity, -1]) {
      expect(() => new Host({ queueAdmissionTimeoutMs: value } as any)).toThrow(TypeError)
      expect(() => new Host({ disposeStepTimeoutMs: value } as any)).toThrow(TypeError)
    }
  })

  it('rejects external mutation while a lifecycle hook is active', async () => {
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
      expect(() => host.use({ name: 'queued', install: () => ({}) } as any)).toThrow(
        PluginHostError
      )
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(blocking).resolves.toBeDefined()
      expect(diagnostics).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('queueAdmissionTimeoutMs: false does not alter lifecycle fail-fast admission', async () => {
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
      expect(() => host.use({ name: 'queued', install: () => ({}) } as any)).toThrow(
        PluginHostError
      )
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(blocking).resolves.toBeDefined()
      expect(diagnostics).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('queueAdmissionTimeoutMs does not defer lifecycle fail-fast admission', async () => {
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
      expect(() => host.use({ name: 'queued', install: () => ({}) } as any)).toThrow(
        PluginHostError
      )
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(blocking).resolves.toBeDefined()
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
      await expect(disposePromise).resolves.toMatchObject({ logicalTerminal: true })
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
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
    // 只推进注入的 manual scheduler；真实 host timer 不参与。
    scheduler.advance(100)
    const outcome = await disposePromise.catch((error: unknown) => error)
    expect((outcome as any).cleanupComplete).toBe(false)
    expect((outcome as any).cleanupErrors.length).toBeGreaterThan(0)
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
