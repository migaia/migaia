import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'
import { nativeWorkerFor } from '../threads/fixture.js'

/** The original native fixture observer exposes termination without a production diagnostic port. */
const entry = fileURLToPath(new URL('./fixtures/worker-faults.mjs', import.meta.url))
for (const mode of ['bad-ack', 'overflow', 'exit', 'abort'] as const) {
  it(`[A3] genuine Worker ${mode} reclaims only its original incomplete candidate`, async () => {
    /** Actual launch cancellation and source preparation share the same native signal. */
    const controller = new AbortController()
    /** This real native reason must survive cancellation without a replacement bootstrap wrapper. */
    const reason = new Error('c3-worker-construction-cancelled')
    /** The source's real compiled offer is carried in library-owned workerData. */
    const launcher = createNodeThreadLauncher({
      runtimeApi: {
        self: { name: 'parent', instanceId: 'fault-parent' },
        capabilities: [RpcCapability.stream, RpcCapability.batch, RpcCapability.runtimeApi]
      }
    })
    /** Native exit remains separate from preparation failure and termination request. */
    const handle = await launcher.launch({ entry, data: { mode } }, { signal: controller.signal })
    /** Observe the original native method rather than constructing a replacement termination owner. */
    const terminate = vi.spyOn(nativeWorkerFor(handle), 'terminate')
    /** The genuine channel factory, rather than a test ACK Promise, consumes preparation. */
    const opening = createNodeThreadChannelFactory({ scheduler: systemScheduler })
      .open(handle, controller.signal)
      .catch((error: unknown) => error)
    try {
      if (mode === 'abort') controller.abort(reason)
      else handle.port.postMessage('start-fixture')
      /** A native actual exit is mandatory even when the private capability ACK never completed. */
      const failure = await opening
      if (mode === 'abort')
        assert.equal(failure, reason, '[A3] cancellation keeps the exact native reason')
      else
        assert.equal(
          (failure as { code?: string }).code,
          'INVALID_CONFIG',
          '[A3] failed private preparation never publishes a channel'
        )
      const status = await handle.exited
      if (mode === 'exit')
        assert.equal(status.code, 0, '[A3] actual voluntary exit code is retained')
      assert.equal(
        terminate.mock.calls.length,
        1,
        '[A3] the original native candidate is reclaimed once'
      )
      handle.terminate()
      assert.equal(terminate.mock.calls.length, 1, '[A3] repeated cleanup cannot terminate twice')
    } finally {
      handle.terminate()
      await handle.exited
      terminate.mockRestore()
    }
  })
}
