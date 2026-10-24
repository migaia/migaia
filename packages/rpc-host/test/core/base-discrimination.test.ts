import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'

import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { systemScheduler } from '@migaia/utils/scheduler'

describe('successful request completion', () => {
  it('both real initiators release success without aborting native signals', async () => {
    /** Canonical endpoints exercise the actual caller and provider owners in both directions. */
    const [leftTransport, rightTransport] = createMemoryTransportPair()
    /**
     * A supported custom scheduler keeps the original eager control independent of the deferred
     * path.
     */
    const scheduler = { ...systemScheduler }
    /** Left endpoint remains unchanged while the host constructor is observed during calls. */
    const left = await createRuntimeEndpointComposition(
      {
        id: 'a-left',
        transport: leftTransport,
        scheduler,
        middlewares: [connect()],
        provider: { echo: (context) => context.success(context.data) }
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    /** Right endpoint is also an initiator, avoiding an inactive caller-side positive control. */
    const right = await createRuntimeEndpointComposition(
      {
        id: 'a-right',
        transport: rightTransport,
        scheduler,
        middlewares: [connect()],
        provider: { echo: (context) => context.success(context.data) }
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    /** Original host constructor preserves native signal identity and behavior. */
    const NativeController = globalThis.AbortController
    /** Actual constructor calls include both ordinary caller scopes and provider scopes. */
    let constructions = 0
    /** Actual native abort calls exclude endpoint initialization and disposal. */
    let aborts = 0
    class ObservedController extends NativeController {
      /** Retains host construction while counting actual supported request scopes. */
      constructor() {
        super()
        constructions++
      }
      /** Observes cancellation without replacing native reason or dispatch behavior. */
      override abort(reason?: unknown): void {
        aborts++
        super.abort(reason)
      }
    }
    vi.stubGlobal('AbortController', ObservedController)
    try {
      assert.equal(await left.send('a-right', 'echo', 'one'), 'one')
      assert.equal(await right.send('a-left', 'echo', 'two'), 'two')
      assert.equal(constructions, 4, 'two caller and two provider controllers really constructed')
      assert.equal(aborts, 0, 'ordinary success must not invoke native abort')
    } finally {
      vi.unstubAllGlobals()
      await left.dispose()
      await right.dispose()
    }
  })
})
