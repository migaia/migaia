import { describe, expect, it } from 'vitest'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { createEndpoint } from '../src/index.js'
import { authentication } from '../src/middleware/authentication.js'
import { codec } from '../src/middleware/codec.js'
import { connect } from '../src/middleware/connect.js'
import { framer } from '../src/middleware/framer.js'

describe('contract endpoint pipeline', () => {
  it('uses paired public endpoints for request-response, codec/framer work, frame protection, and disposal', async () => {
    const [clientBaseTransport, serverBaseTransport] = createMemoryTransportPair()
    /** Counts actual codec work on both public endpoints. */
    const codecCalls = { encode: 0, decode: 0 }
    /** Captures protection at the physical-frame boundary. */
    const physicalEvents: string[] = []
    /** Wraps production codec behavior without bypassing its descriptor. */
    const observedCodec = () => {
      const json = defineJsonCodec({ version: 1 })
      return {
        ...json,
        encode: (...args: Parameters<typeof json.encode>) => {
          codecCalls.encode += 1
          return json.encode(...args)
        },
        decode: (...args: Parameters<typeof json.decode>) => {
          codecCalls.decode += 1
          return json.decode(...args)
        }
      }
    }
    /** Uses the installed authentication path rather than the removed endpoint facade. */
    const observedAuthentication = (side: 'client' | 'server') =>
      authentication({
        sign: (frame) => {
          physicalEvents.push(`${side}:protect`)
          return frame
        },
        verify: (frame) => {
          physicalEvents.push(`${side}:unprotect`)
          return frame
        }
      })
    /** Records physical sends while preserving each paired transport's lifecycle identity. */
    const clientTransport = {
      ...clientBaseTransport,
      send: (...args: Parameters<typeof clientBaseTransport.send>) => {
        physicalEvents.push('client:send')
        return clientBaseTransport.send(...args)
      }
    }
    /** Records reverse physical sends without introducing a second transport owner. */
    const serverTransport = {
      ...serverBaseTransport,
      send: (...args: Parameters<typeof serverBaseTransport.send>) => {
        physicalEvents.push('server:send')
        return serverBaseTransport.send(...args)
      }
    }
    const server = await createEndpoint({
      id: 'contract-server',
      transport: serverTransport,
      provider: { echo: (context) => context.success(context.data) },
      middlewares: [
        codec(observedCodec()),
        framer(createStringFramer({ chunkBytes: 4 })),
        observedAuthentication('server'),
        connect({ transport: serverTransport })
      ]
    })
    const client = await createEndpoint({
      id: 'contract-client',
      transport: clientTransport,
      middlewares: [
        codec(observedCodec()),
        framer(createStringFramer({ chunkBytes: 4 })),
        observedAuthentication('client'),
        connect({ transport: clientTransport })
      ]
    })
    try {
      await expect(client.send('contract-server', 'echo', 'warm')).resolves.toBe('warm')
      codecCalls.encode = 0
      codecCalls.decode = 0
      physicalEvents.length = 0
      await expect(client.send('contract-server', 'echo', { value: 'hello' })).resolves.toEqual({
        value: 'hello'
      })
      expect(codecCalls).toEqual({ encode: 2, decode: 2 })
      for (const side of ['client', 'server'] as const) {
        const protects = physicalEvents.filter((event) => event === `${side}:protect`).length
        const sends = physicalEvents.filter((event) => event === `${side}:send`).length
        const unprotects = physicalEvents.filter((event) => event === `${side}:unprotect`).length
        expect(protects).toBeGreaterThan(1)
        expect(sends).toBe(protects)
        expect(unprotects).toBe(
          physicalEvents.filter(
            (event) => event === `${side === 'client' ? 'server' : 'client'}:send`
          ).length
        )
        expect(physicalEvents.indexOf(`${side}:send`)).toBeGreaterThan(
          physicalEvents.lastIndexOf(`${side}:protect`)
        )
      }
    } finally {
      await client.dispose()
      await server.dispose()
    }
    await expect(client.send('contract-server', 'echo', null)).rejects.toMatchObject({
      code: 'ENDPOINT_DISPOSED'
    })
  })
})
