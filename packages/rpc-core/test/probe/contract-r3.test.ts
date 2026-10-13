import { expect, it, vi } from 'vitest'
import { createEndpoint, connect } from '../../dist/core/index.js'
import { createMemoryTransportPair } from '../../dist/core/adapters/memory.js'
import { defineProbe, readProbeStages, subscribeProbeStages } from '../../dist/core/probe/index.js'

it('[closure A1] reads frozen host stages and releases one notification per change', () => {
  /** Host-form public fields remain initial while the canonical state tracks active stages. */
  const probe = defineProbe({ stages: ['message'], emit: () => undefined }, {})
  /** Cold notifications must fire only for actual changes and stop after release. */
  const changed = vi.fn()
  /** Subscription release is idempotent and owns no business-path work. */
  const release = subscribeProbeStages(probe, changed)
  probe.setStages(['message', 'frame'])
  probe.setStages(['message', 'frame'])
  expect(probe.stageMask).toBe(2)
  expect(readProbeStages(probe)).toBe(18)
  expect(changed).toHaveBeenCalledTimes(1)
  release()
  release()
  probe.setStages([])
  expect(readProbeStages(probe)).toBe(0)
  expect(changed).toHaveBeenCalledTimes(1)
})

it('[closure A1] provides the actual serving endpoint identity', async () => {
  /** Existing memory transport exercises the provider context through the public endpoint. */
  const [left, right] = createMemoryTransportPair()
  /** Provider identity comes from its executor rather than the request sender. */
  const server = await createEndpoint({
    id: 'r3-server',
    transport: right,
    middlewares: [connect()],
    provider: { identity: (context) => context.success(context.localEndpointId) }
  })
  /** Caller retains a distinct identity to detect accidental sender-id forwarding. */
  const client = await createEndpoint({
    id: 'r3-client',
    transport: left,
    middlewares: [connect()]
  })
  try {
    expect(await client.send('r3-server', 'identity')).toBe('r3-server')
  } finally {
    await Promise.all([client.dispose(), server.dispose()])
  }
})
