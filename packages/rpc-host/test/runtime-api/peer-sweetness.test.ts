import { connectedCoreHosts } from '../host/core-fixture.js'
import { RUNTIME_API_CAPABILITIES } from '../../dist/remote/runtime-api/constants.js'
import { describe, expect, it, vi } from 'vitest'
import { createRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import { runtimeSources } from './fixture.js'

describe('Runtime Peer convenience', () => {
  it('uses the host default reporter through genuine namespace traffic', async () => {
    /** No report option is configured on the real provider Host. */
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    /** The original native application failure remains distinct from wire diagnostics. */
    const failure = new RangeError('p5-default-report-fixture')
    try {
      /** BC1 retired Peer default name=peer; these are independent real Host identities. */
      const fixture = await connectedCoreHosts({
        double: (value: number) => value * 2,
        fail: () => {
          throw failure
        }
      })
      try {
        expect(fixture.a.self.instanceId).not.toBe(fixture.b.self.instanceId)
        expect(await fixture.b.memory.request('double', 21)).toBe(42)
        await fixture.b.memory.notify('fail')
        await expect.poll(() => report.mock.calls.length).toBeGreaterThan(0)
      } finally {
        await fixture.close()
      }
    } finally {
      report.mockRestore()
    }
  })

  it('asyncDispose is the original close function and Promise', async () => {
    /** The original public Host owns cleanup; the fixture returns no per-session RPC facade. */
    const fixture = await connectedCoreHosts({}, {}, () => undefined)
    try {
      expect(fixture.a[Symbol.asyncDispose]).toBe(fixture.a.close)
      /** Concurrent explicit/scoped cleanup retains exact original settlement identity. */
      const closing = fixture.a.close()
      expect(fixture.a[Symbol.asyncDispose]()).toBe(closing)
      await closing
    } finally {
      await fixture.close()
    }
  })

  it('raw Peer subscriptions never fabricate initial ready or native exit', async () => {
    /** Memory provides callable Peers, but has no native execution lifecycle to report. */
    const pairOptions = { a: { provide: {} }, b: { provide: {} } }
    /** Reuse the independently negotiated sources and actual canonical Peer constructors. */
    const pairChannel = runtimeSources(RUNTIME_API_CAPABILITIES, RUNTIME_API_CAPABILITIES)
    const [a, b] = await Promise.all([
      createRuntimePeer({
        ...pairOptions.a,
        self: { name: 'a', instanceId: 'test-pair-a' },
        connect: pairChannel.sources[0]
      }),
      createRuntimePeer({
        ...pairOptions.b,
        self: { name: 'b', instanceId: 'test-pair-b' },
        connect: pairChannel.sources[1]
      })
    ])
    const pair = { a, b }
    /** Factory resolution is initial readiness; a later listener must not receive a fake replay. */
    const ready = vi.fn()
    /** Closing a logical memory connection cannot counterfeit native execution exit. */
    const exit = vi.fn()
    try {
      /** The original publisher owns this exact listener receipt and idempotent cancellation. */
      const cancel = pair.a.on('ready', ready)
      pair.a.on('exit', exit)
      await Promise.resolve()
      expect(ready).not.toHaveBeenCalled()
      cancel()
      cancel()
      await pair.a.close()
      expect(exit).not.toHaveBeenCalled()
    } finally {
      await Promise.all([pair.a.close(), pair.b.close()])
      pairChannel.close()
    }
  })
})
