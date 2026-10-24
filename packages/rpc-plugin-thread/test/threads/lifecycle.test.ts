import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { deferred } from '@migaia/utils/promise'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/public-host.js'
import {
  createAdapterWebThreadLauncher as createWebThreadLauncher,
  createAdapterWebThreadChannelFactory as createWebThreadChannelFactory
} from '../../dist/threads/web-launcher.js'

/** Flush supervisor/remote promise ownership without running a second lifecycle scheduler. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
}

describe('thread lifecycle ownership', () => {
  it('unsupported exit retains its budget after bootstrap cancellation and abandon timeout', async () => {
    const scheduler = createManualScheduler()
    const report = vi.fn()
    const terminate = vi.fn()
    /** Native construction proves that the actual launcher has acquired its original unit lease. */
    const launched = deferred<void>()
    const Worker = class {
      /** Signal the existing native launch phase without manufacturing a bootstrap acknowledgement. */
      constructor() {
        launched.resolve()
      }
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      terminate = terminate
    }
    const launcher = createWebThreadLauncher({ Worker, report })
    const budget = createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler })
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    const plugin = threadPlugin({
      name: 'p',
      spawn: {
        spec: { entry: 'file:///worker.mjs', data: { value: 1 } },
        launcher,
        budget,
        scheduler,
        channelFactory: createWebThreadChannelFactory({ scheduler }),
        report,
        health: { check: async () => undefined },
        supervisor: { isolation: 'best-effort', stop: { exitTimeoutMs: 5, reapTimeoutMs: 5 } }
      },

      report
    })
    const ready = host.use(plugin).catch((error: unknown) => error)
    await launched.promise
    await flush()
    expect(budget.inUse).toBe(1)
    const release = host.dispose()
    expect(host.dispose()).toBe(release)
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
