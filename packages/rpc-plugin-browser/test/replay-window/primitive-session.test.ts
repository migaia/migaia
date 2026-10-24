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

/** Frozen owner-only baseline retains exactly the old authentication acceptance path. */
const owner = process.env.RPC_REPLAY_BASE
  ? (
      (await import(/* @vite-ignore */ process.env.RPC_REPLAY_BASE)) as {
        authentication: typeof authentication
      }
    ).authentication
  : authentication

describe('replay-window r12 physical session authority', () => {
  it('refuses primitive source before provider admission on an actual MessagePort', async () => {
    /** Both resources are real; only the received source is the intentionally unsupported input. */
    const { port1, port2 } = new MessageChannel()
    const clientTransport = createNodeMessagePortTransport(port1)
    const physical = createNodeMessagePortTransport(port2)
    const serverTransport: IRpcTransport = {
      ...physical,
      subscribe: (listener) =>
        physical.subscribe((message) => listener({ ...message, source: 'primitive-r12-source' }))
    }
    /** Completion is recorded at cryptographic verification, not an arbitrary elapsed timeout. */
    let verifies = 0
    let providers = 0
    /** The configured verifier is trusted; it cannot grant physical session authority itself. */
    const plugin = () =>
      owner({
        sign: (value) => value,
        verify: (value) => {
          verifies++
          return value
        }
      })
    /**
     * This physical endpoint owns one outbound and discovery graph for its original business
     * assertions.
     */
    const serverOutbound = createOutboundFeature(createCanonicalChunkFeature())
    /** Discovery shares the same sender and accepted target directory. */
    const serverDiscovery = createDiscoveryFeature(serverOutbound)
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), plugin()],
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
    /**
     * This physical endpoint owns one outbound and discovery graph for its original business
     * assertions.
     */
    const clientOutbound = createOutboundFeature(createCanonicalChunkFeature())
    /** Discovery shares the same sender and accepted target directory. */
    const clientDiscovery = createDiscoveryFeature(clientOutbound)
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), plugin()]
      },
      {
        'first-party-outbound': clientOutbound,
        'first-party-provider': createProviderFeature(clientOutbound),
        'first-party-discovery': clientDiscovery,
        'first-party-control': createControlFeature(clientOutbound, clientDiscovery)
      }
    )
    /** Keep original hook classifications and pending cleanup failure observable. */
    const failures: unknown[] = []
    const release = server.hooks.on((event) => {
      if (event.name === 'failure') failures.push(event.error)
    })
    let pending: Promise<unknown> | undefined
    try {
      pending = client.send('server', 'echo', 'primitive').catch((error: unknown) => error)
      for (let turn = 0; turn < 20 && verifies === 0; turn++) await nextTurn()
      await nextTurn()
      await nextTurn()
      assert.ok(verifies > 0, 'actual physical delivery reached the verifier')
      assert.equal(
        providers,
        0,
        'primitive source cannot establish authenticated session authority'
      )
      assert.equal(failures.length, 1)
      assert.equal((failures[0] as { code: string }).code, 'AUTHENTICATION_FAILED')
    } finally {
      release()
      await client.dispose()
      await server.dispose()
      await pending
      port1.close()
      port2.close()
    }
  })
})
