import { describe, expect, it } from 'vitest'
import { timeout } from '../../../src/core/middleware/timeout.js'
import { installPlugin } from './helpers.js'

describe('timeout middleware', () => {
  it('resolves per-call override before middleware default', () => {
    const values = installPlugin(timeout({ timeoutMs: 10 }))
    const capability = values.get('timeoutCapability') as {
      resolveTimeout(override?: number | false): number | false | undefined
    }
    expect(capability.resolveTimeout()).toBe(10)
    expect(capability.resolveTimeout(25)).toBe(25)
  })
})
