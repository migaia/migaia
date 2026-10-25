/** Session owns the current handshake timer; removed initial/ACK clauses are recorded locally. */
import { expect, it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

it('releases the sole Session handshake deadline after delayed real bilateral admission', async () => {
  /** Both genuine Sessions borrow this original clock through the public scheduler backend. */
  const scheduler = createManualScheduler()
  /** The spy changes only the backend, without installing another handshake timer owner. */
  const clock = vi
    .spyOn(systemScheduler, 'schedule')
    .mockImplementation((run, delay) => scheduler.schedule(run, delay))
  /** Physical accept gates delay actual delivery; no readiness or peer proposal is fabricated. */
  const left = new MemoryCarrier('budget-left')
  /** The independently owned remote endpoint keeps its own receiver and close operation. */
  const right = new MemoryCarrier('budget-right')
  left.link(right)
  right.link(left)
  left.holdAccept()
  right.holdAccept()
  /** Only real Session.ready resolves the views inspected below. */
  const views: IRpcSessionView[] = []
  /** Two native transport definitions attach the original endpoints through their own real Hosts. */
  const pending = [left, right].map((carrier, index) =>
    createRpcHost({
      self: {
        name: index === 0 ? 'local' : 'remote',
        instanceId: index === 0 ? 'local-1' : 'remote-1'
      },
      report: () => undefined,
      plugins: [
        defineTransportPlugin({
          name: 'budget-native',
          namespace: 'memory',
          handshakeTimeoutMs: 50,
          async open(context) {
            views[index] = await context.attach(carrier).ready
            return { dispose: () => undefined }
          }
        })
      ]
    })
  )
  try {
    // The fixed two-carrier fixture reaches both original Session timer registrations.
    for (let turn = 0; turn < 80 && scheduler.pendingCount < 2; turn++) await Promise.resolve()
    expect(scheduler.pendingCount).toBe(2)
    scheduler.advance(35)
    left.releaseAccept()
    right.releaseAccept()
    await Promise.all(pending)
    expect(views[0]!.peerId).toBe('remote-1')
    expect(scheduler.now()).toBe(35)
    expect(scheduler.pendingCount).toBe(0)
    scheduler.advance(15)
    expect(left.closed).not.toBe(true)
    expect(right.closed).not.toBe(true)
  } finally {
    left.releaseAccept()
    right.releaseAccept()
    const settled = await Promise.allSettled(pending)
    await Promise.all(
      settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value.close()] : []))
    )
    await Promise.all([left.close(), right.close()])
    clock.mockRestore()
  }
})
