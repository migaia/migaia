import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { codecContext, request } from '../core/fixtures/outbound-proof-candidate.js'

/** Observe the same canonical JSON codec under its runtime-neutral owner. */
const remoteProcessJsonCodec = new RpcJsonCarrierCodec()

describe('package-created outbound proof', () => {
  it('canonical JSON string codec skips repeated admission only after actual construction', async () => {
    /** Baseline JSON bytes remain the contract oracle for every observable payload detail. */
    const baseline = remoteProcessJsonCodec.encode(
      await remoteProcessJsonCodec.prepare(request(), codecContext),
      codecContext
    )
    /** User graph admission precedes observation, so only repeated codec work is counted. */
    const envelope = await remoteProcessJsonCodec.prepare(request(), codecContext)
    /** Count actual repeated prototype admission without changing its native behavior. */
    const admissions = vi.spyOn(Object, 'getPrototypeOf')
    try {
      assert.equal(remoteProcessJsonCodec.encode(envelope, codecContext).data, baseline.data)
      assert.equal(
        admissions.mock.calls.length,
        0,
        'owned JSON string must skip duplicate admission'
      )
    } finally {
      admissions.mockRestore()
    }
  })

  it('frozen public inputs and invalid payloads retain original codec admission', async () => {
    /** Public normalization/freezing cannot confer the package-private construction proof. */
    const envelope = Object.freeze(request())
    /** Actual public codec admission must remain observable. */
    const admissions = vi.spyOn(Object, 'getPrototypeOf')
    try {
      await remoteProcessJsonCodec.prepare(envelope, codecContext)
      assert.ok(admissions.mock.calls.length > 0)
    } finally {
      admissions.mockRestore()
    }
    await assert.rejects(() =>
      remoteProcessJsonCodec.prepare(Object.freeze({ value: Number.NaN }) as never, codecContext)
    )
  })
})
