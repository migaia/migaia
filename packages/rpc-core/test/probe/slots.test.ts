import { describe, expect, it, vi } from 'vitest'
import { createEndpoint, connect } from '../../dist/core/index.js'
import { createMemoryTransportPair } from '../../dist/core/adapters/memory.js'
import { defineProbe, type IRpcProbe } from '../../dist/core/probe/index.js'
import { RpcPortName } from '../../dist/core/internal/plugin-shared-keys.js'
import type { IRpcTransport } from '../../dist/core/transport.js'
import { createRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import { runtimeSources } from '../runtime-api/fixture.js'

describe('inert probe slots A2', () => {
  it.each(['absent', 'single', 'array'] as const)(
    'preserves real Peer results with %s probe options',
    async (mode) => {
      /** The existing fixture reaches the genuine Peer assembly and independent channel agreement. */
      const channel = runtimeSources()
      /** The contract must never call either the sink or the transport observation slot. */
      const emit = vi.fn(),
        observe = vi.fn(() => vi.fn())
      /** One immutable handle is passed unchanged in either supported option shape. */
      const handle = defineProbe({ stages: ['peer', 'message', 'carrier'], emit })
      /** The selected public option shape must remain inert on both actual Peer endpoints. */
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
        expect(emit).not.toHaveBeenCalled()
        expect(observe).not.toHaveBeenCalled()
      } finally {
        await Promise.all([client.close(), server.close()])
        channel.close()
      }
      expect(emit).not.toHaveBeenCalled()
      expect(observe).not.toHaveBeenCalled()
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
    const left = await createEndpoint({
      id: 'probe-slot-left',
      transport: leftTransport,
      middlewares: [connect()]
    })
    /** The receiving endpoint returns the unmodified application payload. */
    const right = await createEndpoint({
      id: 'probe-slot-right',
      transport: rightWire,
      middlewares: [connect()],
      provider: { echo: (context) => context.success(context.data) }
    })
    try {
      expect(await left.send('probe-slot-right', 'echo', 'unchanged')).toBe('unchanged')
      expect(observe).not.toHaveBeenCalled()
    } finally {
      await Promise.all([left.dispose(), right.dispose()])
    }
    expect(observe).not.toHaveBeenCalled()
  })
})
