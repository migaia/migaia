import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { createNodeThreadLauncher } from '../../src/threads/adapters/node.js'
import { nativeWorkerFor } from '../threads/fixture.js'

/** Built public entry imports execute in a real native Worker, independently from source Vitest. */
const entry = fileURLToPath(new URL('./fixtures/worker-source-faults.mjs', import.meta.url))
for (const mode of ['missing', 'conflict'] as const) {
  it(`[A3] genuine parentPort ${mode} source rejects before attaching a receiver`, async () => {
    /** The original launcher remains the only owner of this native candidate. */
    const launcher = createNodeThreadLauncher(
      mode === 'conflict'
        ? {
            runtimeApi: { self: { name: 'parent', instanceId: 'source-parent' }, capabilities: [] }
          }
        : {}
    )
    /** Fixture mode is carried through existing business data, outside private metadata. */
    const handle = await launcher.launch(
      { entry, data: { mode } },
      { signal: new AbortController().signal }
    )
    /** The existing test-native observer receives classification without activating an endpoint. */
    const receipt = await new Promise<{
      code?: string
      sourceCalls: number
      before: number
      after: number
    }>((resolve) => nativeWorkerFor(handle).once('message', resolve))
    try {
      assert.equal(
        receipt.code,
        'INVALID_CONFIG',
        '[A3] parentPort alone and automatic-plus-explicit are invalid sources'
      )
      assert.equal(
        receipt.sourceCalls,
        0,
        '[A3] invalid configuration never calls its explicit source'
      )
      assert.equal(receipt.before, 0)
      assert.equal(receipt.after, 0, '[A3] no source receiver survives configuration rejection')
      await handle.exited
    } finally {
      handle.terminate()
      await handle.exited
    }
  })
}
