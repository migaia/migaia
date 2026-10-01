import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Missing entry is the base discriminant before any platform module can load. */
const entry = fileURLToPath(new URL('../../src/threads/index.ts', import.meta.url))

describe('threads base inventory', () => {
  it.each(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'])(
    '[%s] has its assembly entry',
    (id) => {
      expect(existsSync(entry), `SDD_BASE_RED_CONTRACT:${id}`).toBe(true)
    }
  )
})
