import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { createRuntimeObjectPipeline } from '../../dist/runtime-adapter/object/pipeline.js'
import { outboundFactory, request } from '../core/fixtures/outbound-proof-candidate.js'

/** Observe the moved canonical codec with a one-off non-string diagnostic fixture. */
const jsonObjectCodec = createRuntimeObjectPipeline('object-codec-fixture').codec

describe('package-created outbound proof', () => {
  it('bridge JSON object codec uses the same private proof and exact materialized value', async () => {
    /** Ordinary normalized input defines original materialization, key order and byte tagging. */
    const baseline = jsonObjectCodec.encode(normalizeRpcEnvelope(request()))
    /** Only the actual canonical constructor may admit this optimized output. */
    const create = await outboundFactory()
    /** First admission finishes before counting duplicate bridge codec work. */
    const envelope = create(request())
    /** Deep equality may inspect prototypes itself, so capture and restore before asserting it. */
    const admissions = vi.spyOn(Object, 'getPrototypeOf')
    /** Encoded result is retained separately from the mechanism count. */
    let encoded: unknown
    /** Count only calls originating from the codec invocation under observation. */
    let repeats = -1
    try {
      encoded = jsonObjectCodec.encode(envelope)
      repeats = admissions.mock.calls.length
    } finally {
      admissions.mockRestore()
    }
    assert.deepEqual(encoded, baseline)
    assert.equal(JSON.stringify(encoded), JSON.stringify(baseline))
    assert.equal(repeats, 0, 'owned bridge object must skip duplicate admission')
  })
})
