import { createProbeEmitter, bindInstalledProbe } from '../../dist/core/internal/probe-emitter.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { expect, it } from 'vitest'

import { connect } from '../../dist/core/middleware/connect.js'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { defineProbe, type IRpcProbeDescriptor } from '../../dist/core/probe/index.js'
import { readEndpointDebugSnapshot } from '../../dist/core/internal/test-observer.js'

it('keeps the canonical fast endpoint proof and unchanged business/debug state', async () => {
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
    /** Observation uses the same emitter owner as Host without adding middleware. */
    if (observed)
      bindInstalledProbe(left, createProbeEmitter([probe], systemScheduler.now, 'fast-caller'))
    /** The provider returns the exact same business response in both configurations. */
    const server = await createRuntimeEndpointComposition(
      {
        id: 'fast-provider',
        transport: right,
        middlewares: [connect()],
        provider: { echo: (context) => context.success(context.data) }
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    /** Only the installed observer differs; canonical fast eligibility stays unchanged. */
    const client = await createRuntimeEndpointComposition(
      {
        id: 'fast-caller',
        transport: left,
        middlewares: [connect()]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
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
