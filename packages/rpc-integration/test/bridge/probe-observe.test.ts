import { describe, expect, it } from 'vitest'
import type { IRpcCarrierProbe } from '@migaia/rpc-host/probe'
import { BridgeFixture, flush, request } from './fixture.js'

describe('JSON-RPC carrier observation', () => {
  it('exposes direct observation on the canonical translation transport', async () => {
    /** The existing foreign-peer fixture drives the real canonical bridge, without probe-core. */
    const fixture = new BridgeFixture()
    /** The negotiated channel must expose observation without an additional transport wrapper. */
    const channel = await fixture.open()
    /**
     * Captured arguments belong to this test; production must keep its reusable detail by
     * reference.
     */
    const events: unknown[][] = []
    /** A direct carrier probe is independent of the not-yet-installed Core probe plugin. */
    const probe: IRpcCarrierProbe = {
      capturing: true,
      emit(direction, sizeBytes, carrier, detail, content) {
        events.push([direction, sizeBytes, carrier, detail, content])
      }
    }
    try {
      expect(channel.transport.observe).toBeTypeOf('function')
      /** The disposer must retire this exact registration without changing channel ownership. */
      const dispose = channel.transport.observe!(probe)
      await channel.transport.send(JSON.stringify(request('observed', 'p.f.request')))
      await flush()
      expect(events).toHaveLength(1)
      expect(events[0]![0]).toBe(0)
      expect(events[0]![3]).toMatchObject({ jsonrpcId: 'observed', jsonrpcMethod: 'migaia.invoke' })
      dispose()
      dispose()
      await channel.transport.send(JSON.stringify(request('unobserved', 'p.f.request')))
      await flush()
      expect(events).toHaveLength(1)
    } finally {
      await channel.close()
    }
  })
})
