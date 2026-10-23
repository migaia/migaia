import { expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { createMemoryTransportPair } from '@migaia/rpc-host/adapters/memory'

it('uses the injected clock when the host has no microtask queue', () => {
  /** This scheduler exercises only the external method/error contract under test. */
  const scheduler = createManualScheduler()
  vi.stubGlobal('queueMicrotask', undefined)
  try {
    const [sender, receiver] = createMemoryTransportPair({ scheduler })
    /** Only advancing the injected clock may deliver this queued transport message. */
    const received: unknown[] = []
    receiver.subscribe((event) => received.push(event.data))
    sender.send('payload')
    expect(received).toEqual([])
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(0)
    expect(received).toEqual(['payload'])
    sender.close()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('keeps default delivery before a later Promise reaction', async () => {
  const [sender, receiver] = createMemoryTransportPair()
  /** Observed callback order distinguishes microtasks, clock jobs and timer callbacks. */
  const trace: unknown[] = []
  receiver.subscribe((event) => trace.push(event.data))
  sender.send('delivery')
  void Promise.resolve().then(() => trace.push('reaction'))
  expect(trace).toEqual([])
  await Promise.resolve()
  expect(trace).toEqual(['delivery', 'reaction'])
  sender.close()
})
