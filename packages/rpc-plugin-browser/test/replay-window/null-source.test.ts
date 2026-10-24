import { createComposedEndpoint } from '../../../rpc-host/dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../../rpc-host/dist/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../../rpc-host/dist/core/features/outbound.js'
import { createProviderFeature } from '../../../rpc-host/dist/core/internal/provider-feature.js'
import { createDiscoveryFeature } from '../../../rpc-host/dist/core/features/discovery.js'
import { createControlFeature } from '../../../rpc-host/dist/core/features/control.js'
import assert from 'node:assert/strict'
import { MessageChannel } from 'node:worker_threads'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { describe, it } from 'vitest'
import { createNodeMessagePortTransport } from '../../../rpc-host/dist/core/adapters/message-port.js'
import { authentication } from '../../../rpc-host/dist/core/middleware/authentication.js'
import { connect } from '../../../rpc-host/dist/core/middleware/connect.js'
import type { IRpcTransport } from '../../../rpc-host/dist/core/transport.js'

describe('replay-window r12 absent browser message source', () => {
  it('accepts null source and still rejects captured signed replay', async () => {
    /** Real ports deliver frames; null models the browser BroadcastChannel source value. */
    const { port1, port2 } = new MessageChannel()
    /** Keeps each native transport's cleanup while selecting the generic receive path. */
    const sourceLess = (transport: IRpcTransport): IRpcTransport => ({
      ...transport,
      subscribe: (listener) =>
        transport.subscribe((message) => listener({ ...message, source: null }))
    })
    /** Each endpoint has its own physical authentication lifetime and nonce. */
    const clientTransport = sourceLess(createNodeMessagePortTransport(port1))
    /** Server-side source absence must not bypass verification or replay admission. */
    const serverTransport = sourceLess(createNodeMessagePortTransport(port2))
    /** Retains the actual protected request for physical replay after the first result. */
    let captured: unknown
    /** Counts real business effects rather than treating transport delivery as execution. */
    let providers = 0
    /** Original authentication failures stay observable through the canonical hook. */
    const failures: unknown[] = []
    /** Identity transforms isolate binding behavior without introducing another auth owner. */
    const signed = () => authentication({ sign: (value) => value, verify: (value) => value })
    /** Preserves the original sender and its physical completion semantics. */
    const send = clientTransport.send
    clientTransport.send = (frame, options) => {
      captured = frame
      return send(frame, options)
    }
    /** Registers one provider using the same production endpoint as browser E2E. */
    /**
     * This physical endpoint owns one outbound and discovery graph for its original business
     * assertions.
     */
    const serverOutbound = createOutboundFeature(createCanonicalChunkFeature())
    /** Discovery shares the same sender and accepted target directory. */
    const serverDiscovery = createDiscoveryFeature(serverOutbound)
    const server = await createComposedEndpoint(
      {
        id: 'null-source-server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), signed()],
        provider: {
          echo: (context) => {
            providers++
            return context.success(context.data)
          }
        }
      },
      {
        'first-party-outbound': serverOutbound,
        'first-party-provider': createProviderFeature(serverOutbound),
        'first-party-discovery': serverDiscovery,
        'first-party-control': createControlFeature(serverOutbound, serverDiscovery)
      }
    )
    /** Caller performs real target discovery before sending its business request. */
    /**
     * This physical endpoint owns one outbound and discovery graph for its original business
     * assertions.
     */
    const clientOutbound = createOutboundFeature(createCanonicalChunkFeature())
    /** Discovery shares the same sender and accepted target directory. */
    const clientDiscovery = createDiscoveryFeature(clientOutbound)
    const client = await createComposedEndpoint(
      {
        id: 'null-source-client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), signed()]
      },
      {
        'first-party-outbound': clientOutbound,
        'first-party-provider': createProviderFeature(clientOutbound),
        'first-party-discovery': clientDiscovery,
        'first-party-control': createControlFeature(clientOutbound, clientDiscovery)
      }
    )
    /** Releases only this test's failure subscription at teardown. */
    const release = server.hooks.on((event) => {
      if (event.name === 'failure') failures.push(event.error)
    })
    try {
      /** Converts the prior discovery failure into a decisive marked business assertion. */
      const outcome = await client
        .send('null-source-server', 'echo', 'source-null')
        .catch((error: unknown) => error)
      assert.equal(outcome, 'source-null', 'null means an absent physical source')
      assert.equal(providers, 1)
      assert.equal(failures.length, 0)
      port1.postMessage(captured)
      for (let turn = 0; turn < 20 && failures.length === 0; turn++) await nextTurn()
      assert.equal(failures.length, 1, 'captured signed replay is still rejected')
      assert.equal((failures[0] as { code: string }).code, 'AUTHENTICATION_FAILED')
      assert.equal(providers, 1, 'replay never repeats the business effect')
    } finally {
      release()
      await client.dispose()
      await server.dispose()
      port1.close()
      port2.close()
    }
  })
})
