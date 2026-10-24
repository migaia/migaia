import { describe, expect, it } from 'vitest'
import { connect } from '../../dist/core/middleware/connect.js'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { createComposedEndpoint } from '../../dist/core/composed.js'
import { createOutboundFeature } from '../../dist/core/features/outbound.js'
import { createProviderFeature } from '../../dist/core/internal/provider-feature.js'
import { createCanonicalChunkFeature, createStreamFeature } from '../../dist/core/stream/index.js'

/** Proves a package consumer can build both stream peers using published subpaths. */
function publicRoots() {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const provider = createProviderFeature(outbound)
  const stream = createStreamFeature(outbound, provider)
  return {
    'first-party-chunk': chunk,
    'first-party-outbound': outbound,
    'first-party-provider': provider,
    'first-party-stream': stream
  }
}

describe('streaming public subpath', () => {
  it('exposes the complete composition path without the core root stream runtime', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport })]
      },
      publicRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport })]
      },
      publicRoots()
    )
    server.stream.provide('one', function* () {
      yield 'value'
    })
    try {
      const values = client.stream.open('server', 'one', null)
      expect(await values.next()).toEqual({ done: false, value: 'value' })
      expect(await values.next()).toEqual({ done: true, value: undefined })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
