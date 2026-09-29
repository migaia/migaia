import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('A2 abort reason uses the guarded property read export', () => {
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
    for (const name of ['README.md', 'USEGUIDE.md']) {
      const guide = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
      const example = guide.indexOf("tryReadProperty(signal, 'reason')")
      expect(example, name).toBeGreaterThanOrEqual(0)
      expect(guide.slice(example, example + 500), name).toMatch(/失败.*调用方|调用方.*失败/)
    }
  })
})
