import { describe, expect, it } from 'vitest'
import { createClientEndpoint } from '../src/client.js'
import { createProviderEndpoint } from '../src/provider.js'
import { createComposedEndpoint } from '../src/core.js'
import {
  createFirstPartyRoots,
  type IWebRpcFirstPartyRootName
} from '../src/internal/first-party-roots.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { connect } from '../src/middleware/connect.js'
import { ping } from '../src/middleware/ping.js'
import { WebRpcLifecycleError } from '../src/errors.js'

/**
 * Regression gate for `SOL-CB-R8-P2-003`: `sendAll`/`pingAll` must key their fulfilled/rejected
 * records with the canonical tagged `fanoutDeliveryKey` shape (`["target", id]`) inside a
 * `createSafeRecord` (null-prototype) accumulator, exactly like legacy `src/endpoint.ts`'s
 * `#fanoutDeliveryKey`/`createSafeRecord` pair — so an attacker-controlled `__proto__`-shaped
 * target id cannot be silently dropped or misread as a prototype mutation — and `pingAll` must
 * rethrow a `WebRpcLifecycleError` raised by any individual `ping()` instead of folding it into the
 * per-target result.
 */
describe('composed sendAll/pingAll fanout contract', () => {
  it('sendAll keys results by the tagged fanoutDeliveryKey shape and tolerates a __proto__ target', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: '__proto__',
      transport: serverTransport,
      targetIds: ['client'],
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: clientTransport,
      targetIds: ['__proto__'],
      middlewares: [connect({ transport: clientTransport })]
    })
    try {
      const { fulfilled, rejected } = await client.sendAll('echo', 'value')
      expect(Object.getPrototypeOf(fulfilled)).toBeNull()
      expect(Object.getPrototypeOf(rejected)).toBeNull()
      const key = JSON.stringify(['target', '__proto__'])
      expect(Object.keys(fulfilled)).toEqual([key])
      expect(fulfilled[key]).toBe('value')
      // The hostile target id must never have mutated the accumulator's own prototype.
      expect(Object.getPrototypeOf(fulfilled)).toBeNull()
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('pingAll keys results by the tagged fanoutDeliveryKey shape and tolerates a __proto__ target', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createComposedEndpoint(
      {
        id: '__proto__',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), ping()]
      },
      createFirstPartyRoots(new Set<IWebRpcFirstPartyRootName>(['first-party-control']))
    )
    const client = await createComposedEndpoint(
      {
        id: 'client-ping-fanout',
        transport: clientTransport,
        targetIds: ['__proto__'],
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      createFirstPartyRoots(new Set<IWebRpcFirstPartyRootName>(['first-party-control']))
    )
    try {
      const { fulfilled, rejected } = await client.pingAll!()
      expect(Object.getPrototypeOf(fulfilled)).toBeNull()
      expect(Object.getPrototypeOf(rejected)).toBeNull()
      const key = JSON.stringify(['target', '__proto__'])
      expect(Object.keys(fulfilled)).toEqual([key])
      expect(fulfilled[key]).toBe(true)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('pingAll rethrows a WebRpcLifecycleError instead of folding it into the per-target result', async () => {
    const [clientTransport] = createMemoryTransportPair()
    const client = await createComposedEndpoint(
      {
        id: 'client-disposed-fanout',
        transport: clientTransport,
        targetIds: ['unreachable'],
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      createFirstPartyRoots(new Set<IWebRpcFirstPartyRootName>(['first-party-control']))
    )
    await client.dispose()
    await expect(client.pingAll!()).rejects.toBeInstanceOf(WebRpcLifecycleError)
  })

  it('sendAll rethrows a WebRpcLifecycleError instead of resolving with per-target rejections (SOL-CB-R9-P2-003)', async () => {
    const [clientTransport] = createMemoryTransportPair()
    const client = await createClientEndpoint({
      id: 'client-disposed-send-fanout',
      transport: clientTransport,
      targetIds: ['unreachable'],
      middlewares: [connect({ transport: clientTransport })]
    })
    await client.dispose()
    await expect(client.sendAll('echo', 'value')).rejects.toBeInstanceOf(WebRpcLifecycleError)
  })
})
