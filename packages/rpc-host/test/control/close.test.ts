import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcControl } from '@migaia/rpc-contract'

import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { hooks } from '../../dist/core/middleware/hooks.js'
import type { IRpcHookEvent } from '../../dist/core/typing.js'
import type { IRpcTransport } from '../../dist/core/transport.js'

describe('close control intention', () => {
  it('delivers one peer-close event and rejects invalid duration before sending', async () => {
    const [firstWire, secondWire] = createMemoryTransportPair()
    const sent: unknown[] = []
    const capture: IRpcTransport = {
      ...firstWire,
      send(message, options) {
        sent.push(message)
        return firstWire.send(message, options)
      }
    }
    const events: IRpcHookEvent[] = []
    const first = await createRuntimeEndpointComposition(
      {
        id: 'a',
        transport: capture,
        middlewares: [connect({ transport: capture })]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    const second = await createRuntimeEndpointComposition(
      {
        id: 'b',
        transport: secondWire,
        middlewares: [
          connect({ transport: secondWire }),
          hooks({ listeners: [(event) => void events.push(event)] })
        ]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    try {
      expect(first.announceClose).toBeTypeOf('function')
      await first.announceClose!('b', { drainMs: 500 })
      expect(events.filter((event) => event.name === 'control.close')).toEqual([
        expect.objectContaining({ name: 'control.close', requesterId: 'a', durationMs: 500 })
      ])
      const control = sent
        .map((message) => normalizeRpcEnvelope(message))
        .find(
          (message) =>
            message.kind === 'variation' && message.data.route.variation === RpcControl.close
        )
      expect(control).toMatchObject({ kind: 'variation', data: { payload: { drainMs: 500 } } })
      const count = sent.length
      expect(() => first.announceClose!('b', { drainMs: -1 })).toThrow(
        expect.objectContaining({ code: 'CONTRACT_INVALID' })
      )
      expect(() => first.announceClose!('b', { drainMs: 2 ** 31 })).toThrow(
        expect.objectContaining({ code: 'CONTRACT_INVALID' })
      )
      expect(sent).toHaveLength(count)
      expect(control?.kind).toBe('variation')
      if (control?.kind !== 'variation') return
      await firstWire.send({
        ...control,
        id: 'invalid-close-1',
        data: { route: control.data.route, payload: { drainMs: 'x' } }
      })
      await vi.waitFor(() => {
        expect(events.filter((event) => event.name === 'failure')).toEqual([
          expect.objectContaining({ name: 'failure', code: 'PROTOCOL_INVALID' })
        ])
      })
      expect(events.filter((event) => event.name === 'control.close')).toHaveLength(1)
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })
})
