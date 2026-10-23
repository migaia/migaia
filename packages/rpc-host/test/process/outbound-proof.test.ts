import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { createRuntimeBytePipeline } from '../../dist/runtime-adapter/byte/pipeline.js'
import { outboundFactory, request } from '../core/fixtures/outbound-proof-candidate.js'

/** Observe the same canonical JSON codec under its runtime-neutral owner. */
const remoteProcessJsonCodec = createRuntimeBytePipeline('json-codec-fixture').codec

describe('package-created outbound proof', () => {
  it('canonical JSON string codec skips repeated admission only after actual construction', async () => {
    /** Baseline JSON bytes remain the contract oracle for every observable payload detail. */
    const baseline = remoteProcessJsonCodec.encode(normalizeRpcEnvelope(request()))
    /** Before implementation this returns the baseline owner, keeping the red executable. */
    const create = await outboundFactory()
    /** User graph admission precedes observation, so only repeated codec work is counted. */
    const envelope = create(request())
    /** Count actual repeated prototype admission without changing its native behavior. */
    const admissions = vi.spyOn(Object, 'getPrototypeOf')
    try {
      assert.equal(remoteProcessJsonCodec.encode(envelope), baseline)
      assert.equal(
        admissions.mock.calls.length,
        0,
        'owned JSON string must skip duplicate admission'
      )
    } finally {
      admissions.mockRestore()
    }
  })

  it('frozen public inputs and invalid payloads retain original codec admission', () => {
    /** Public normalization/freezing cannot confer the package-private construction proof. */
    const envelope = normalizeRpcEnvelope(request())
    /** Actual public codec admission must remain observable. */
    const admissions = vi.spyOn(Object, 'getPrototypeOf')
    try {
      remoteProcessJsonCodec.encode(envelope)
      assert.ok(admissions.mock.calls.length > 0)
    } finally {
      admissions.mockRestore()
    }
    assert.throws(() => remoteProcessJsonCodec.encode(Object.freeze({ value: Number.NaN })))
  })
})
