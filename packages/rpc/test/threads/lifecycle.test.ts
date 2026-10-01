import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createThreadHost } from '../../src/threads/host.js'
import {
  createBrowserThreadLauncher,
  createBrowserThreadChannelFactory
} from '../../src/threads/adapters/browser.js'
import { nativeWorkerFor, nativeFixture, contract, endpointFactory } from './fixture.js'

/** Flush supervisor/remote promise ownership without running a second lifecycle scheduler. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
}

describe('thread lifecycle ownership', () => {
  it('[A6] endpoint construction failure preserves primary error and reaps the Worker', async () => {
    const primary = new Error('endpoint factory failure')
    const fixture = nativeFixture({
      endpointFactory: async () => {
        throw primary
      }
    })
    try {
      await expect(fixture.install()).rejects.toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary
      })
      expect(fixture.budget.inUse).toBe(0)
      expect(nativeWorkerFor(fixture.handles[0]!).threadId).toBe(-1)
      expect(nativeWorkerFor(fixture.handles[0]!).listenerCount('message')).toBe(0)
    } finally {
      await fixture.close()
    }
  })
  it('[A6] unsupported exit retains its budget after bootstrap cancellation and abandon timeout', async () => {
    const scheduler = createManualScheduler()
    const report = vi.fn()
    const terminate = vi.fn()
    const Worker = class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      terminate = terminate
    }
    const launcher = createBrowserThreadLauncher({ Worker, report })
    const budget = createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler })
    const host = createThreadHost({
      catalog: { p: contract },
      spec: { entry: 'file:///worker.mjs', data: { value: 1 } },
      launcher,
      budget,
      scheduler,
      channelFactory: createBrowserThreadChannelFactory({ scheduler }),
      endpointFactory,
      report,
      health: { check: async () => undefined },
      supervisor: { isolation: 'best-effort', stop: { exitTimeoutMs: 5, reapTimeoutMs: 5 } }
    })
    const ready = host.ready().catch((error: unknown) => error)
    await flush()
    expect(budget.inUse).toBe(1)
    const release = host.release()
    expect(host.release()).toBe(release)
    await flush()
    scheduler.advance(5)
    await flush()
    scheduler.advance(5)
    await flush()
    await release
    await ready
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(budget.inUse).toBe(1)
    expect(report).toHaveBeenCalled()
    expect(scheduler.pendingCount).toBe(0)
  })
})
