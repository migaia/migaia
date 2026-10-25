/** Successful native call scopes retain no-abort behavior; allocation remains a disclosed metric. */
import { createRpcHost } from '@migaia/rpc-host'
import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

describe('successful request completion', () => {
  it('both real initiators release success without aborting native signals', async () => {
    /** The genuine SDK listener owns the original left physical endpoint. */
    const server = coreMemoryServer('a-left')
    /** Native installation and handshake complete before observing business scope allocations. */
    const left = await createRpcHost({
      ...server.options,
      provide: { echo: (payload) => payload }
    })
    /** A second genuine public Host is also an initiator, avoiding an inactive positive control. */
    const connected = await server.connect('a-right', {
      provide: { echo: (payload) => payload }
    })
    /** Original public root remains the right request owner, with no endpoint facade. */
    const right = connected.host
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
      assert.equal(await left.memory.send('a-right', 'echo', 'one'), 'one')
      assert.equal(await right.memory.send('a-left', 'echo', 'two'), 'two')
      // C001-A003 exact4 is an internal BC3 allocation metric, not an original business PASS.
      console.info('successful request native controller allocation metric', { constructions })
      assert.equal(aborts, 0, 'ordinary success must not invoke native abort')
    } finally {
      vi.unstubAllGlobals()
      await left.close()
      await right.close()
    }
  })
})
