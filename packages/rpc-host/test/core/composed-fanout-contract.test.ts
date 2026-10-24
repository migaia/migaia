import { RpcCapability } from '@migaia/rpc-contract'
import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { describe, expect, it } from 'vitest'

import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { ping } from '../../dist/core/middleware/ping.js'
import {
  RpcCoreErrorCode,
  RpcLifecycleError,
  RPC_CORE_ERROR_SOURCE
} from '../../dist/core/errors.js'
import { deserializeRpcError } from '../../dist/core/internal/error-wire-metadata.js'
import { attachErrorIdentity } from '@migaia/utils/error'

/**
 * Regression gate: `sendAll`/`pingAll` must key their fulfilled/rejected records with the canonical
 * tagged `fanoutDeliveryKey` shape (`["target", id]`) inside a `createSafeRecord` (null-prototype)
 * accumulator, exactly like legacy `src/endpoint.ts`'s `#fanoutDeliveryKey`/`createSafeRecord` pair
 * — so an attacker-controlled `__proto__`-shaped target id cannot be silently dropped or misread as
 * a prototype mutation — and `pingAll` must rethrow a `WebRpcLifecycleError` raised by any
 * individual `ping()` instead of folding it into the per-target result.
 */
describe('composed sendAll/pingAll fanout contract', () => {
  it('sendAll keys results by the tagged fanoutDeliveryKey shape and tolerates a __proto__ target', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRuntimeEndpointComposition(
      {
        id: '__proto__',
        transport: serverTransport,
        targetIds: ['client'],
        middlewares: [connect({ transport: serverTransport })],
        provider: { echo: (context) => context.success(context.data) }
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: clientTransport,
        targetIds: ['__proto__'],
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
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
    const server = await createRuntimeEndpointComposition(
      {
        id: '__proto__',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), ping()]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client-ping-fanout',
        transport: clientTransport,
        targetIds: ['__proto__'],
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
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

  it('pingAll rethrows a RpcLifecycleError instead of folding it into the per-target result', async () => {
    const [clientTransport] = createMemoryTransportPair()
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client-disposed-fanout',
        transport: clientTransport,
        targetIds: ['unreachable'],
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    await client.dispose()
    await expect(client.pingAll!()).rejects.toBeInstanceOf(RpcLifecycleError)
  })

  it('sendAll rethrows a RpcLifecycleError instead of resolving with per-target rejections', async () => {
    const [clientTransport] = createMemoryTransportPair()
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client-disposed-send-fanout',
        transport: clientTransport,
        targetIds: ['unreachable'],
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    await client.dispose()
    await expect(client.sendAll('echo', 'value')).rejects.toBeInstanceOf(RpcLifecycleError)
  })

  it.each(['class', 'constructor', 'tag', 'decode'] as const)(
    '%s forged lifecycle failure cannot close the endpoint or escape fanout as its own lifecycle decision',
    async (kind) => {
      /**
       * This public constructor legitimately describes caller-owned lifecycle errors, without
       * minting Core authority.
       */
      const example = new RpcLifecycleError('external lifecycle fixture')
      /** The constructor remains reachable through ordinary error observation too. */
      const Constructor = example.constructor as typeof RpcLifecycleError
      /** Public fields remain diagnostic data for the tag/decode variants. */
      const wire = {
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.endpointDisposed,
        name: 'RpcLifecycleError',
        message: 'external lifecycle fixture',
        stack: 'external lifecycle stack'
      }
      /** These are all public construction paths; none calls Core's private factory. */
      const forged =
        kind === 'class'
          ? example
          : kind === 'constructor'
            ? new Constructor(wire.message)
            : kind === 'decode'
              ? deserializeRpcError(wire)
              : attachErrorIdentity(new Error(wire.message), {
                  source: wire.source,
                  code: wire.code
                })
      /** The actual transport reports this failure during a real endpoint send. */
      const [transport] = createMemoryTransportPair()
      let sends = 0
      transport.send = () => {
        sends++
        throw forged
      }
      const client = await createRuntimeEndpointComposition(
        {
          id: 'forged-lifecycle-client',
          transport,
          targetIds: ['provider'],
          middlewares: [connect({ transport })]
        },
        { agreement: { capabilities: [] }, peerId: '' }
      ).installing
      try {
        /** A caller-owned lifecycle diagnostic cannot become a Core close decision. */
        const result = await client.sendAll('value', null)
        const failure = result.rejected[JSON.stringify(['target', 'provider'])] as Error
        expect(failure).toMatchObject({ code: RpcCoreErrorCode.transport, cause: forged })
        expect(sends).toBe(1)
        /** The same endpoint remains active and admits another physical send. */
        await client.sendAll('value', null)
        expect(sends).toBe(2)
      } finally {
        await client.dispose()
      }
    }
  )
})
