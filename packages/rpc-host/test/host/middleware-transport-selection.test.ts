/** Real native Session attachment preserves one subscription per selected physical carrier. */
import { createRpcHost } from '@migaia/rpc-host'
import { expect, it, vi } from 'vitest'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { coreMemoryServer } from './core-fixture.js'

// Retains subscription counts after the root shadow selector is removed.
it('subscribes each selected actual carrier exactly once', async () => {
  /** Each original listener lends its actual native attach authority to one physical endpoint. */
  const first = coreMemoryServer('selected-first')
  /** The other Host owns the opposite accepted Session without a facade or synthetic readiness. */
  const second = coreMemoryServer('selected-second')
  /** Real public installation happens before either listener accepts the physical pair. */
  const hosts = await Promise.all([createRpcHost(first.options), createRpcHost(second.options)])
  /** Physical endpoints retain the existing fixture codec and actual close ownership. */
  const left = new MemoryCarrier('selected-left')
  /** A different real endpoint owns opposite-direction handshake and delivery. */
  const right = new MemoryCarrier('selected-right')
  left.link(right)
  right.link(left)
  /** Passthrough spies borrow the original methods and preserve their native class receivers. */
  const firstSubscribe = vi.spyOn(left, 'subscribe')
  /** This independent receipt observes the second selected native carrier only. */
  const secondSubscribe = vi.spyOn(right, 'subscribe')
  try {
    /** Both subscriptions are installed before asynchronous handshake writes can run. */
    const firstHandle = first.accept(left)
    /** Actual ready completion comes from the canonical Session owner on the opposite Host. */
    const secondHandle = second.accept(right)
    await Promise.all([firstHandle.ready, secondHandle.ready])
    expect(firstSubscribe.mock.calls.length).toBe(1)
    expect(secondSubscribe.mock.calls.length).toBe(1)
  } finally {
    await Promise.all(hosts.map((host) => host.close()))
    firstSubscribe.mockRestore()
    secondSubscribe.mockRestore()
  }
})
