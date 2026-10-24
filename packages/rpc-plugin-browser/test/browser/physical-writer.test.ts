import { createComposedEndpoint } from '../../../rpc-host/dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../../rpc-host/dist/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../../rpc-host/dist/core/features/outbound.js'
import { createProviderFeature } from '../../../rpc-host/dist/core/internal/provider-feature.js'
import { createDiscoveryFeature } from '../../../rpc-host/dist/core/features/discovery.js'
import { createControlFeature } from '../../../rpc-host/dist/core/features/control.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { connect } from '../../../rpc-host/dist/core/middleware/connect.js'
import { createWebWorkerTransport } from '@migaia/rpc-host/plugin'
import { envelope } from '../../../rpc-host/test/core/fixtures/physical-batch-envelope.js'

describe('optimal physical writer', () => {
  it('one bad member cannot block valid siblings or serialize provider execution', async () => {
    /** Both canonical factories belong to the same explicit static deployment. */
    const listeners = [
      new Set<(event: MessageEvent) => void>(),
      new Set<(event: MessageEvent) => void>()
    ]
    /** Physical frames and delivery are visible without replacing the core receiver. */
    const ports = [0, 1].map((side) => ({
      postMessage(value: unknown) {
        queueMicrotask(() => {
          for (const listener of listeners[1 - side]!) listener({ data: value } as MessageEvent)
        })
      },
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === 'message') listeners[side]!.add(listener)
      },
      removeEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === 'message') listeners[side]!.delete(listener)
      }
    }))
    /** The actual canonical transport grants source/identity behavior on each endpoint. */
    const transport = createWebWorkerTransport(ports[1] as never, { peerId: 'a' })
    /** Provider work is held to distinguish admission order from completion order. */
    /**
     * This physical endpoint owns one outbound and discovery graph for its original business
     * assertions.
     */
    const endpointOutbound = createOutboundFeature(createCanonicalChunkFeature())
    /** Discovery shares the same sender and accepted target directory. */
    const endpointDiscovery = createDiscoveryFeature(endpointOutbound)
    const endpoint = await createComposedEndpoint(
      {
        id: 'b',
        transport,
        middlewares: [connect({ transport })]
      },
      {
        'first-party-outbound': endpointOutbound,
        'first-party-provider': createProviderFeature(endpointOutbound),
        'first-party-discovery': endpointDiscovery,
        'first-party-control': createControlFeature(endpointOutbound, endpointDiscovery)
      }
    )
    /** Concurrent entries must be observable before either provider completes. */
    const seen: string[] = []
    /** One business hold is released only after both semantic admissions are checked. */
    let release!: () => void
    /** Ordinary asynchronous provider execution uses the existing provider owner. */
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    endpoint.provide('echo', async (context) => {
      seen.push(context.data as string)
      await held
      return context.success(context.data)
    })
    try {
      ports[0]!.postMessage({
        kind: 'batch',
        envelopes: [envelope('good-one'), { kind: 'request', id: 'bad' }, envelope('good-two')]
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      assert.deepEqual(
        seen,
        ['good-one', 'good-two'],
        'valid siblings enter before either provider completes'
      )
    } finally {
      release()
      await endpoint.dispose()
    }
  })
})
