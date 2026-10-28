/** Process has no native wall cap: an explicit false disables its installed call timeout. */
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { deferred } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { expect, it } from 'vitest'

it('keeps an actual Process call pending beyond its installed timeout when timeout is false', async () => {
  /** Only the installed feature clock is controlled; native acquisition and IO remain genuine. */
  const scheduler = createManualScheduler()
  /** Actual provider entry proves that both native request directions have completed admission. */
  const entered = deferred<void>()
  /** Business completion remains under the parent's real provider rather than a timer fixture. */
  const gate = deferred<number>()
  /** The existing child calls parent.double from its real reverse provider. */
  const host = await createRpcHost({
    self: { name: 'parent', instanceId: 'process-timeout-false-parent' },
    provide: {
      double: () => {
        entered.resolve()
        return gate.promise
      }
    },
    plugins: [
      processPlugin({
        spawn: new URL('./fixtures/core-session-child.ts', import.meta.url),
        features: [timeoutFeature({ ms: 100, scheduler })]
      })
    ],
    report: () => undefined
  })
  /** This observation records settlement only; it cannot change either native operation. */
  let settled = false
  try {
    /** The public false applies to the actual selected Process invocation. */
    const pending = host.process.request('reverse', 21, { timeout: false })
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await entered.promise
    scheduler.advance(101)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    gate.resolve(42)
    await expect(pending).resolves.toBe(42)
  } finally {
    gate.resolve(42)
    await host.close()
  }
  expect(scheduler.pendingCount).toBe(0)
}, 10_000)
