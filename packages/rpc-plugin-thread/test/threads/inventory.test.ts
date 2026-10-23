import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Missing entry is the base discriminant before any platform module can load. */
const entry = fileURLToPath(new URL('../../src/threads/index.ts', import.meta.url))

describe('threads base inventory', () => {
  it('has its assembly entry', () => {
    expect(existsSync(entry), 'threads assembly entry').toBe(true)
  })
})
