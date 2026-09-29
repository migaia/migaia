import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope } from '../../src/contract/index.js'

/** Keep the I5 envelope extension point available for the stream kind in S2. */
describe('streaming S1 inventory', () => {
  it('uses the per-kind field table without a stream-specific normalizer branch', () => {
    /** The normalizer is the control-owned extension point frozen before this leaf. */
    const source = readFileSync(
      fileURLToPath(new URL('../../src/contract/v1/normalize.ts', import.meta.url)),
      'utf8'
    )
    expect(source).toContain('const TOP_LEVEL_FIELDS = {')
    expect(source).toContain('TOP_LEVEL_FIELDS[kind as RpcEnvelopeKind]')
    expect(source).not.toMatch(/(?:kind\s*===|case)\s*['"]stream['"]/)
  })

  it('retains the unknown-kind result for unregistered future kinds', () => {
    expect(() => normalizeRpcEnvelope({ kind: 'future-kind' })).toThrow(
      expect.objectContaining({ code: 'INVALID_ENVELOPE', violation: 'unknownKind' })
    )
  })
})
