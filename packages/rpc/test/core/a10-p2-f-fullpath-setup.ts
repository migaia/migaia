import { vi } from 'vitest'

/** Uses the original qualification machinery while exercising every existing core case on full. */
vi.mock('../../src/core/internal/fast-path.js', async (readOriginal) => {
  /** Only the private branch read changes; no user configuration is promoted to fast. */
  const original = await readOriginal<Record<string, unknown>>()
  return { ...original, hasFastEndpoint: () => false }
})
