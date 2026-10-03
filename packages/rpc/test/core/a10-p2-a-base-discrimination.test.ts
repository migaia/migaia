import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { createEndpoint } from '../../src/core/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { connect } from '../../src/core/middleware/connect.js'

describe('P2-A successful request completion', () => {
  it('[A16] both real initiators release success without aborting native signals', async () => {
    /** Canonical endpoints exercise the actual caller and provider owners in both directions. */
    const [leftTransport, rightTransport] = createMemoryTransportPair()
    /** Left endpoint remains unchanged while the host constructor is observed during calls. */
    const left = await createEndpoint({
      id: 'p2-a-left',
      transport: leftTransport,
      middlewares: [connect()],
      provider: { echo: (context) => context.success(context.data) }
    })
    /** Right endpoint is also an initiator, avoiding an inactive caller-side positive control. */
    const right = await createEndpoint({
      id: 'p2-a-right',
      transport: rightTransport,
      middlewares: [connect()],
      provider: { echo: (context) => context.success(context.data) }
    })
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
      assert.equal(await left.send('p2-a-right', 'echo', 'one'), 'one')
      assert.equal(await right.send('p2-a-left', 'echo', 'two'), 'two')
      assert.equal(
        constructions,
        4,
        '[A16] two caller and two provider controllers really constructed'
      )
      assert.equal(aborts, 0, '[A16] ordinary success must not invoke native abort')
    } finally {
      vi.unstubAllGlobals()
      await left.dispose()
      await right.dispose()
    }
  })
})
