import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { codecContext, request } from '../core/fixtures/outbound-proof-candidate.js'

/** Observe the moved canonical codec with a one-off non-string diagnostic fixture. */
const jsonObjectCodec = new RpcJsonCarrierCodec()

describe('package-created outbound proof', () => {
  it('bridge JSON object codec uses the same private proof and exact materialized value', async () => {
    /** Ordinary normalized input defines original materialization, key order and byte tagging. */
    const baselineFrame = jsonObjectCodec.encode(
      await jsonObjectCodec.prepare(request(), codecContext),
      codecContext
    )
    /** Current whole-message media exposes JSON text; materialization reads that real output. */
    const baseline = JSON.parse(baselineFrame.data as string)
    /** First admission finishes before counting duplicate bridge codec work. */
    const envelope = await jsonObjectCodec.prepare(request(), codecContext)
    /** Deep equality may inspect prototypes itself, so capture and restore before asserting it. */
    const admissions = vi.spyOn(Object, 'getPrototypeOf')
    /** Encoded result is retained separately from the mechanism count. */
    let encoded: unknown
    /** Count only calls originating from the codec invocation under observation. */
    let repeats = -1
    try {
      encoded = JSON.parse(jsonObjectCodec.encode(envelope, codecContext).data as string)
      repeats = admissions.mock.calls.length
    } finally {
      admissions.mockRestore()
    }
    assert.deepEqual(encoded, baseline)
    assert.equal(JSON.stringify(encoded), JSON.stringify(baseline))
    assert.equal(repeats, 0, 'owned bridge object must skip duplicate admission')
  })
})
