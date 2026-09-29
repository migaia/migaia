import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcControl } from '../../src/contract/index.js'
import { createEndpoint } from '../../src/core/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { connect } from '../../src/core/middleware/connect.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import type { IRpcHookEvent } from '../../src/core/typing.js'
import type { IRpcTransport } from '../../src/core/transport.js'

describe('close control intention (A10)', () => {
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
    const first = await createEndpoint({
      id: 'a',
      transport: capture,
      middlewares: [connect({ transport: capture })]
    })
    const second = await createEndpoint({
      id: 'b',
      transport: secondWire,
      middlewares: [
        connect({ transport: secondWire }),
        hooks({ listeners: [(event) => void events.push(event)] })
      ]
    })
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
