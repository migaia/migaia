import { createRuntimeEndpointComposition } from '../../../dist/core/runtime-api-endpoint.js'

import { describe, expect, it } from 'vitest'

import { createMemoryTransportPair } from '../../fixtures/memory-transport.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { defineFeature } from '../../../dist/core/feature.js'

/** Mapped import paths retain the original path based test titles. */

/** Feature imports use the new layer while their frozen titles keep the old paths. */

/** Contracts become green as static composition entries land. */
describe('static composition contracts', () => {
  it('rejects forged module token before transport side effects', async () => {
    const coreEntrypoint = '../../../dist/core/composed.js'
    const core = await import(coreEntrypoint)
    const forged = {}
    const [transport] = createMemoryTransportPair()
    await expect(
      core.createComposedEndpoint({ id: 'forged', transport, middlewares: [] }, [forged])
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('rejects duplicate native public identity before transport side effects', async () => {
    const coreEntrypoint = '../../../dist/core/composed.js'
    const core = await import(coreEntrypoint)
    const first = defineFeature({
      install: () => ({ duplicate: () => 'first' }),
      publicKeys: ['duplicate']
    })
    const second = defineFeature({
      install: () => ({ duplicate: () => 'second' }),
      publicKeys: ['duplicate']
    })
    const [transport] = createMemoryTransportPair()
    await expect(
      core.createComposedEndpoint(
        {
          id: 'duplicate',
          transport,
          middlewares: [connect({ transport })],
          features: [first, second] as const
        },
        Object.create(null)
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('preserves the projected provider surface through chained provide calls', async () => {
    const [transport] = createMemoryTransportPair()
    const endpoint = await createRuntimeEndpointComposition(
      {
        id: 'provider-chain',
        transport,
        middlewares: [connect({ transport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const chained = endpoint.provide('echo', (context) => context.success(context.data))
    expect(chained).toBe(endpoint)
    expect('discovery' in chained).toBe(false)
    await chained.dispose()
  })

  it('executes a recursive provider request through distinct slim runtimes', async () => {
    const [clientTransport, providerTransport] = createMemoryTransportPair()
    const providerEndpoint = await createRuntimeEndpointComposition(
      {
        id: 'provider-runtime',
        transport: providerTransport,
        middlewares: [connect({ transport: providerTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    providerEndpoint.provide('echo', (context) => context.success(context.data))
    const clientEndpoint = await createRuntimeEndpointComposition(
      {
        id: 'client-runtime',
        targetIds: ['provider-runtime'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    await expect(clientEndpoint.send('provider-runtime', 'echo', { value: 1 })).resolves.toEqual({
      value: 1
    })
    await Promise.all([clientEndpoint.dispose(), providerEndpoint.dispose()])
  })
})
