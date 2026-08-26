import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/** Proves the final B12c05 boundary has no legacy outbound bridge producer. */
describe('canonical attachment boundary', () => {
  it('removes legacy bridge constructors from source and package internals', async () => {
    const source = await readFile(
      new URL('../src/internal/outbound-attachment.ts', import.meta.url),
      'utf8'
    )
    expect(source).not.toContain('createOutboundCompatibilityPort')
    expect(source).not.toContain('normalizeOutboundCompatibilityPort')
    expect(source).not.toContain('IWebRpcOutboundCompatibilityPort')
  })
})
