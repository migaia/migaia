import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { describe, expect, it, vi } from 'vitest'

import { connect } from '../../dist/core/middleware/connect.js'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { defineProbe, type IRpcProbe } from '../../dist/core/probe/index.js'
import { RpcPortName } from '../../dist/core/internal/plugin-shared-keys.js'
import type { IRpcTransport } from '../../dist/core/transport.js'
import { createRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import { runtimeSources } from '../runtime-api/fixture.js'

describe('activated probe slots', () => {
  it.each(['absent', 'single', 'array'] as const)(
    'preserves real Peer results with %s probe options',
    async (mode) => {
      /** The existing fixture reaches the genuine Peer assembly and independent channel agreement. */
      const channel = runtimeSources()
      /** Installed probes activate observation exactly once on each owned endpoint. */
      const emit = vi.fn(),
        observe = vi.fn(() => vi.fn())
      /** One immutable handle is passed unchanged in either supported option shape. */
      const handle = defineProbe({ stages: ['peer', 'message', 'carrier'], emit })
      /** Both public option shapes activate the same emitter without changing business values. */
      const probe: IRpcProbe | readonly IRpcProbe[] | undefined =
        mode === 'absent' ? undefined : mode === 'single' ? handle : [handle]
      for (const transport of channel.transports) Object.assign(transport, { observe })
      /**
       * Construct both real callable owners concurrently so their genuine describe exchange
       * completes.
       */
      const [client, server] = await Promise.all([
        createRuntimePeer({ connect: channel.sources[0], probe }),
        createRuntimePeer({
          connect: channel.sources[1],
          probe,
          provide: { double: (value: number) => value * 2 }
        })
      ])
      try {
        expect(await client.request('double', 21)).toBe(42)
        if (mode === 'absent') {
          expect(emit).not.toHaveBeenCalled()
          expect(observe).not.toHaveBeenCalled()
        } else {
          expect(emit).toHaveBeenCalled()
          expect(observe).toHaveBeenCalledTimes(2)
        }
      } finally {
        await Promise.all([client.close(), server.close()])
        channel.close()
      }
      if (mode === 'absent') {
        expect(emit).not.toHaveBeenCalled()
        expect(observe).not.toHaveBeenCalled()
      } else {
        expect(observe).toHaveBeenCalledTimes(2)
        for (const receipt of observe.mock.results) expect(receipt.value).toHaveBeenCalledTimes(1)
      }
    }
  )

  it('publishes the port name while an endpoint ignores an optional observe capability', async () => {
    expect(RpcPortName.probe).toBe('probe')
    /** Both original reference transports carry the optional capability without activating it. */
    const [leftWire, rightWire] = createMemoryTransportPair()
    /** Returning a disposer makes the fixture conform to the new carrier capability type. */
    const observe = vi.fn(() => vi.fn())
    /** The public transport shape, rather than an internal observation hook, reaches Core. */
    const leftTransport: IRpcTransport = Object.assign(leftWire, { observe })
    /** Each canonical endpoint retains its usual connect middleware and provider owner. */
    const left = await createRuntimeEndpointComposition(
      {
        id: 'probe-slot-left',
        transport: leftTransport,
        middlewares: [connect()]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    /** The receiving endpoint returns the unmodified application payload. */
    const right = await createRuntimeEndpointComposition(
      {
        id: 'probe-slot-right',
        transport: rightWire,
        middlewares: [connect()],
        provider: { echo: (context) => context.success(context.data) }
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    try {
      expect(await left.send('probe-slot-right', 'echo', 'unchanged')).toBe('unchanged')
      expect(observe).not.toHaveBeenCalled()
    } finally {
      await Promise.all([left.dispose(), right.dispose()])
    }
    expect(observe).not.toHaveBeenCalled()
  })
})
