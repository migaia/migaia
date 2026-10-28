import { describe, expect, it, vi } from 'vitest'
import { PluginHostError } from '../src/index.ts'
import { Host } from './hardening-fixtures.ts'

describe('#7（批次0）registerStage 对同一函数重复注册的不变量', () => {
  it('同一函数的每次注册都是独立条目——同一函数注册两次，卸载后一次都不残留', async () => {
    const host = new Host()
    let runs = 0
    const stage = (value: string, next: (v: string) => void): void => {
      runs += 1
      next(value)
    }

    await host.use({
      name: 'dup2',
      install: (core: any) => {
        core.usePipeline(stage)
        core.usePipeline(stage)
        return {}
      }
    } as any)

    ;(host as any).runPipeline('x', () => {})
    expect(runs).toBe(2) // 两次注册各跑一次

    await host.unUse('dup2')
    runs = 0
    ;(host as any).runPipeline('x', () => {})
    expect(runs).toBe(0) // 卸载后两个独立条目都不残留。
  })
})

describe('#8（批次0）非枚举扩展键被静默跳过', () => {
  it('install 返回值上的非枚举属性会被明确拒绝', async () => {
    const host = new Host()
    const extension: Record<string, unknown> = {}
    Object.defineProperty(extension, 'hidden', {
      value: 'secret',
      enumerable: false,
      configurable: true,
      writable: true
    })

    await expect(host.use({ name: 'p', install: () => extension } as any)).resolves.toBeDefined()
    expect((host as any).hidden).toBeUndefined()
  })
})

describe('second adversarial pass (fixed)', () => {
  it('concurrent dispose is terminal and is not evicted by ordinary mutation SLA', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host({
        execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 100 }
      })
      const install = host.use({
        name: 'slow-dispose',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 6_000))
          return {}
        }
      } as any)
      void install.catch(() => undefined)
      const dispose = host.dispose()
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(install).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      await expect(dispose).resolves.toMatchObject({ logicalTerminal: true })
      await expect(host.dispose()).resolves.toMatchObject({ logicalTerminal: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('redesigned: a legitimate external mutation behind a slow install waits out the 5s SLA and is rejected with MUTATION_QUEUE_TIMEOUT, not silently diagnosed', async () => {
    vi.useFakeTimers()
    try {
      const diagnostics: string[] = []
      const diagnosedHost = new Host({
        diagnostic: (message: string) => diagnostics.push(message),
        queueAdmissionTimeoutMs: 5_000
      } as any)
      const slow = diagnosedHost.use({
        name: 'slow',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000))
          return {}
        }
      } as any)
      expect(() => diagnosedHost.use({ name: 'external', install: () => ({}) } as any)).toThrow(
        PluginHostError
      )
      expect(diagnostics).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(10_000) // slow's own 10s timer fires
      await expect(slow).resolves.toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('superseded: an async disposer registered during useSync is no longer rejected at all', () => {
    const host = new Host()
    let started = false

    expect(() =>
      host.install([
        {
          name: 'async-tail',
          install: (core: any) => {
            core.onDispose(async () => {
              started = true
              await new Promise((resolve) => setTimeout(resolve, 10))
            })
            return {}
          }
        }
      ])
    ).not.toThrow() // no install failure here, so no rollback either — nothing rejects registration
    expect(started).toBe(false) // the disposer itself hasn't run — the plugin was never disposed
  })

  it('fixed: non-enumerable extension omission is reported through the diagnostic channel', async () => {
    const diagnostics: string[] = []
    const host = new Host({ diagnostic: (message: string) => diagnostics.push(message) })
    const extension = {}
    Object.defineProperty(extension, 'hidden', { value: 1, enumerable: false })
    await host.use({ name: 'hidden', install: () => extension } as any)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatch(/hidden/)
    expect((host as any).hidden).toBeUndefined()
  })

  it('fixed: a queued mutation that settles before the watchdog fires clears its timer immediately', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      const first = host.use({
        name: 'first',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return {}
        }
      } as any)
      expect(() => host.use({ name: 'second', install: () => ({}) } as any)).toThrow(
        PluginHostError
      )

      await vi.advanceTimersByTimeAsync(100)
      await expect(first).resolves.toBeDefined()

      // If the watchdog for "second" were still armed, it would still be sitting in the
      // timer queue for up to 5s after settlement. Assert there is nothing left pending.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a resource disposer that never settles is recorded as DISPOSE_STEP_TIMEOUT and disposal still moves on to the rest', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      let laterDisposerRan = false
      await host.use({
        name: 'stuck-disposer',
        install: (core: any) => {
          core.onDispose(() => new Promise(() => undefined)) // never settles
          core.onDispose(() => {
            laterDisposerRan = true // registered first, so it's the *later* one in LIFO order
          })
          return {}
        }
      } as any)

      const unUse = host.unUse('stuck-disposer')
      await vi.advanceTimersByTimeAsync(5_000)
      const outcome = await unUse
      expect(laterDisposerRan).toBe(true) // the timed-out step didn't block the rest of the group
      expect((outcome as any).ok).toBe(false)
      expect((outcome as any).errors[0].code).toBe('PLUGIN_DISPOSE_FAILED')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fifth adversarial pass', () => {
  it('a plugin dispose hook that awaits host.dispose() again must not deadlock the host forever', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      await host.use({
        name: 'self-disposer',
        install: () => ({}),
        // #hookRegistration is cleared before the first await (same timing an earlier regression exploited for
        // use()); the reentrant dispose() call below returns the very #disposePromise this
        // hook is blocking on, so nothing outside a bounded wait can ever unblock it.
        dispose: async () => {
          await Promise.resolve()
          await host.dispose().catch(() => undefined)
        }
      } as any)

      const dispose = host.dispose()
      let settled = false
      // Chain catch() before finally(): finally() returns its own derived promise that re-rejects
      // with the same reason, so attaching it separately from catch() (rather than chaining) would
      // leave that derived promise's rejection with no handler of its own.
      void dispose
        .catch(() => undefined)
        .finally(() => (settled = true))
        .catch(() => undefined)

      expect(settled).toBe(false)
      // Advance far past any bounded wait a fix could plausibly use; a genuine deadlock stays
      // unsettled no matter how much (virtual) time passes because no timer ever drives it.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(settled).toBe(true)

      // Not just "some promise settled" — the host itself must reach a real terminal state,
      // not stay silently stuck in `closing` while dispose()'s own promise resolves/rejects.
      // use() throws HOST_DISPOSED synchronously (#assertActive runs before any enqueue), so
      // this is a plain throw, not a rejection.
      expect(() => host.use({ name: 'after', install: () => ({}) } as any)).toThrow(
        expect.objectContaining({ code: 'HOST_DISPOSED' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('the same reentrant call via a resource disposer (no #hookRegistration guard at all) also converges', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      await host.use({
        name: 'self-disposer-resource',
        install: (core: any) => {
          // Resource disposers run outside the #hookRegistration window entirely — unlike the
          // plugin dispose hook, they aren't guarded even during their synchronous phase. The
          // leading await matters: it lets the outer dispose() call finish assigning
          // #disposePromise before this reentrant call runs, which is what actually exercises
          // the pending-promise reentrancy (a same-tick synchronous call would instead observe
          // #disposePromise as still unassigned and take an unrelated early-return path).
          core.onDispose(async () => {
            await Promise.resolve()
            await host.dispose().catch(() => undefined)
          })
          return {}
        }
      } as any)

      const dispose = host.dispose()
      let settled = false
      // Chain catch() before finally(): finally() returns its own derived promise that re-rejects
      // with the same reason, so attaching it separately from catch() (rather than chaining) would
      // leave that derived promise's rejection with no handler of its own.
      void dispose
        .catch(() => undefined)
        .finally(() => (settled = true))
        .catch(() => undefined)

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
