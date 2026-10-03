import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { normalizeRpcEnvelope, RpcCapability, RpcBatchPhysical } from '../../src/contract/index.js'
import { readRpcBatchMembers } from '../../src/contract/batch-frame.js'

/** Only new active batch vectors are read; frozen protocol vectors remain byte-for-byte unchanged. */
const vectors = JSON.parse(
  readFileSync(new URL('../../schema/vectors/batch.json', import.meta.url), 'utf8')
) as {
  capability: string
  valid: Array<{ id: string; value: unknown }>
  invalid: Array<{ id: string; value: unknown }>
  isolated: Array<{ id: string; value: unknown; validMembers: number[] }>
}

describe('independent physical batch schema vectors', () => {
  it('[A28] keeps physical shape outside the semantic envelope namespace', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../schema/batch.schema.json', import.meta.url), 'utf8')
    )
    assert.equal(vectors.capability, RpcCapability.batch)
    assert.equal(schema.properties.kind.const, RpcBatchPhysical.kind)
    assert.equal(schema['x-migaia-max-physical-bytes'], 16_777_216)
    for (const vector of vectors.valid) {
      const members = readRpcBatchMembers(vector.value)!
      for (const member of members) assert.ok(normalizeRpcEnvelope(member), vector.id)
      assert.throws(
        () => normalizeRpcEnvelope(vector.value),
        (error: unknown) => (error as { code: unknown }).code === 'INVALID_ENVELOPE',
        vector.id
      )
    }
    for (const vector of vectors.invalid)
      assert.throws(
        () => readRpcBatchMembers(vector.value),
        (error: unknown) => (error as { code: unknown }).code === 'INVALID_FRAME',
        vector.id
      )
  })
  it('[A28] semantic failures remain per-member while the physical wrapper remains valid', () => {
    for (const vector of vectors.isolated) {
      const valid: number[] = []
      for (const [index, member] of readRpcBatchMembers(vector.value)!.entries()) {
        try {
          normalizeRpcEnvelope(member)
          valid.push(index)
        } catch (error) {
          assert.equal((error as { code: unknown }).code, 'INVALID_ENVELOPE', vector.id)
        }
      }
      assert.deepEqual(valid, vector.validMembers, vector.id)
    }
  })
})
