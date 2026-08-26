import { describe, expect, it } from 'vitest'
import { timeout } from '../../src/middleware/timeout'
import { installPlugin } from './helpers'

describe('timeout middleware', () => {
  it('resolves per-call override before middleware default', () => {
    const values = installPlugin(timeout({ timeoutMs: 10 }))
    const capability = values.get('timeoutCapability') as {
      resolveTimeout(override?: number | false): number | false | undefined
    }
    expect(capability.resolveTimeout()).toBe(10)
    expect(capability.resolveTimeout(25)).toBe(25)
  })
  it('rejects a revoked retry descriptor during installation', () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(() => installPlugin(timeout({ retry: revoked.proxy as never }))).toThrow(
      'timeout.retry descriptor is unreadable'
    )
  })
})
