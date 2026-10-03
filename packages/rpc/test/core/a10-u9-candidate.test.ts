import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { describe, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile } from '../../src/contract/index.js'
import { remoteProcessJsonCodec } from '../../src/process/pipeline.js'
import { jsonObjectCodec } from '../../src/bridge/jsonrpc/object-pipeline.js'

/**
 * Selects the existing baseline owner before the candidate exists; import failures never count as
 * red.
 */
async function outboundFactory(): Promise<
  (value: unknown) => ReturnType<typeof normalizeRpcEnvelope>
> {
  if (!existsSync(new URL('../../src/core/internal/outbound-envelope.ts', import.meta.url)))
    return normalizeRpcEnvelope
  /** Explicit ESM suffix resolves the package-private candidate without publishing a public brand. */
  const path = '../../src/core/internal/outbound-envelope.js'
  return (await import(path)).createOutboundEnvelope
}

/** Produces a first-user graph with bytes, negative zero, Unicode order and safe own prototype data. */
function request() {
  /** JSON parsing creates **proto** as an own data field, not a setter invocation. */
  const payload = JSON.parse('{"z":1,"__proto__":{"value":2},"é":"ok"}') as Record<string, unknown>
  payload.zero = -0
  payload.bytes = new Uint8Array([0, 255])
  return {
    kind: 'request',
    id: 'task',
    method: 'echo',
    data: {
      route: {
        profile: RpcRouteProfile,
        type: 'request',
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        sentAt: 0
      },
      payload
    }
  }
}

describe('U9 package-created outbound proof', () => {
  it('[A17] canonical JSON string codec skips repeated admission only after actual construction', async () => {
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
        '[A17] owned JSON string must skip duplicate admission'
      )
    } finally {
      admissions.mockRestore()
    }
  })

  it('[A17] frozen public inputs and invalid payloads retain original codec admission', () => {
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

  it('[A17] bridge JSON object codec uses the same private proof and exact materialized value', async () => {
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
    assert.equal(repeats, 0, '[A17] owned bridge object must skip duplicate admission')
  })
})
