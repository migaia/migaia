import assert from 'node:assert/strict'
import { it } from 'vitest'
import vectors from '../../schema/vectors/runtime-description.json'
import { normalizeRuntimeDescription } from '../../src/remote/runtime-api/description.js'

it('[A32] the separate v2 vectors admit generated directories and reject old versions, secret fields and duplicate modes', () => {
  for (const vector of vectors.valid) {
    assert.equal(normalizeRuntimeDescription(vector).schemaVersion, 2)
  }
  for (const vector of vectors.invalid) {
    assert.throws(() => normalizeRuntimeDescription(vector), { code: 'CONTRACT_INVALID' })
  }
})
