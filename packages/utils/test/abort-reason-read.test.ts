import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('abort reason uses the guarded property read export', () => {
  it('keeps the removed special-purpose API absent and documents caller policy', async () => {
    const [error, root, promise] = await Promise.all([
      import('../dist/error.js'),
      import('../dist/index.js'),
      import('../dist/promise.js')
    ])
    for (const entry of [error, root, promise])
      expect(Object.hasOwn(entry, 'tryReadAbortReason')).toBe(false)
    expect(readFileSync(new URL('../dist/error.d.ts', import.meta.url), 'utf8')).not.toContain(
      'IAbortReasonRead'
    )
    // The README is the reader-first introduction; the usage guides own this contract detail.
    for (const [name, policy] of [
      ['USEGUIDE.md', /失败.*调用方|调用方.*失败/],
      ['USEGUIDE.en.md', /failure.*caller|caller.*failure/]
    ] as const) {
      const guide = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
      const example = guide.indexOf("tryReadProperty(signal, 'reason')")
      expect(example, name).toBeGreaterThanOrEqual(0)
      expect(guide.slice(example, example + 500), name).toMatch(policy)
    }
  })
})
