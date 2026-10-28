/** Original failure, counter and deadline business crosses actual namespace and feature owners. */
import { RpcTimeoutError } from '@migaia/rpc-contract/errors'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { deferred } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { expect, it } from 'vitest'
import { connectedCoreHosts } from './core-fixture.ts'

it('preserves original provider failure,49/50 deadline and first counter result', async () => {
  /** Only the complete timeout instance borrows manual time; Host receives no clock injection. */
  const scheduler = createManualScheduler()
  /** Actual business entry establishes that this deadline belongs to a running provider. */
  const entered = deferred<void>()
  /** The original hanging business is released only after its original deadline assertions. */
  const release = deferred<unknown>()
  /** Only the original counter provider changes this observable business value. */
  let calls = 0
  /** Genuine Hosts and original physical carriers own all admission, cancellation and delivery. */
  const fixture = await connectedCoreHosts(
    {},
    {
      fail: (_value, context) => context.failed('expected failure', 'EXPECTED_FAILURE'),
      count: (_value, context) => context.success(++calls),
      hang: () => {
        entered.resolve()
        return release.promise
      }
    },
    () => undefined
  )
  try {
    // Preserve the original explicit provider failure path.
    await expect(fixture.a.memory.send('b', 'fail', null, { timeout: false })).rejects.toBeDefined()
    /** Observe the same public call before its real feature timer is advanced. */
    const outcome = fixture.a.memory
      .send('b', 'hang', null, { timeout: timeoutFeature({ ms: 50, scheduler }) })
      .catch((error: unknown) => error)
    /** A passive settlement observation preserves the original before-deadline assertion. */
    let settled = false
    void outcome.then(() => {
      settled = true
    })
    await entered.promise
    scheduler.advance(49)
    await Promise.resolve()
    // No terminal outcome before its original50 ms deadline.
    expect(settled).toBe(false)
    scheduler.advance(1)
    // /retain the strict canonical native timeout family.
    expect(await outcome).toBeInstanceOf(RpcTimeoutError)
    // Original counter business returns1 on its first call.
    await expect(fixture.a.memory.send('b', 'count', null, { timeout: false })).resolves.toBe(1)
  } finally {
    release.resolve('late')
    await fixture.close()
  }
})
