import { expect, it } from 'vitest'
import { createEndpoint, connect, authentication } from '../../dist/core/index.js'
import { createMemoryTransportPair } from '../../dist/core/adapters/memory.js'
import { defineProbe, probePlugin, type IRpcProbeDescriptor } from '../../dist/core/probe/index.js'
import { readEndpointDebugSnapshot } from '../../dist/core/internal/test-observer.js'

it('[closure A4] keeps the canonical fast endpoint proof and unchanged business/debug state', async () => {
  /** Baseline and observed endpoints exercise the same public middleware and carrier owners. */
  const snapshots: unknown[] = []
  for (const observed of [false, true]) {
    /** Descriptor facts are construction-owned rather than inferred from emitted events. */
    const descriptors: IRpcProbeDescriptor[] = []
    /** The observer adds no interceptors to this canonical factory path. */
    const probe = defineProbe({
      stages: ['message', 'frame'],
      emit: () => undefined,
      describe: (descriptor) => {
        descriptors.push(descriptor)
      }
    })
    /** Paired native-reference carriers keep component/path choices equal in both arms. */
    const [left, right] = createMemoryTransportPair()
    /** The provider returns the exact same business response in both configurations. */
    const server = await createEndpoint({
      id: 'fast-provider',
      transport: right,
      middlewares: [connect()],
      provider: { echo: (context) => context.success(context.data) }
    })
    /** Only the probe plugin differs; its genuine factory proof must preserve fast eligibility. */
    const client = await createEndpoint({
      id: 'fast-caller',
      transport: left,
      middlewares: observed ? [connect(), probePlugin(probe)] : [connect()]
    })
    try {
      expect(await client.send('fast-provider', 'echo', 42)).toBe(42)
      /** Existing debug state covers settled pending work and framer-owned chunk retention. */
      const state = readEndpointDebugSnapshot(client)!
      snapshots.push({
        pending: state.pending,
        chunks: state.chunks,
        activeControllers: state.activeControllers
      })
      if (observed) {
        expect(descriptors).toHaveLength(1)
        expect(descriptors[0]!.fastPath).toBe(true)
        expect(descriptors[0]!.stageMask & 16).toBe(16)
      }
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
    }
  }
  expect(snapshots[1]).toEqual(snapshots[0])
})

it('[closure A4] describes plugin-only encryption from the authentication configuration owner', async () => {
  /** Plugin-only installation must report the same mode as a Peer option installation. */
  const descriptors: IRpcProbeDescriptor[] = []
  /** This cold callback observes only the successfully activated endpoint configuration. */
  const probe = defineProbe({
    stages: ['frame', 'protected'],
    emit: () => undefined,
    describe: (descriptor) => {
      descriptors.push(descriptor)
    }
  })
  /** No business traffic is required to prove the canonical immutable authentication fact. */
  const [left, right] = createMemoryTransportPair()
  /** Valid transforms keep the existing any-encoded contract and enable signing plus encryption. */
  const endpoint = await createEndpoint({
    id: 'auth-descriptor',
    transport: left,
    middlewares: [
      connect(),
      authentication({
        encrypt: (value) => value,
        decrypt: (value) => value,
        sign: () => 'fixture-signature',
        verify: () => true
      }),
      probePlugin(probe)
    ]
  })
  try {
    expect(descriptors[0]!.authentication).toBe('encrypt-sign')
  } finally {
    await endpoint.dispose()
    right.close()
  }
})
