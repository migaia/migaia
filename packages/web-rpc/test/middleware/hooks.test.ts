import { describe, expect, it } from 'vitest'
import { hooks } from '../../src/middleware/hooks'
import { installPlugin } from './helpers'

describe('hooks middleware', () => {
  it('publishes hook configuration', () => {
    const values = installPlugin(hooks())
    expect(values.has('hooks')).toBe(true)
  })
  it('normalizes hostile listener containers into INVALID_CONFIG', () => {
    const revoked = Proxy.revocable([], {})
    revoked.revoke()
    expect(() => installPlugin(hooks({ listeners: revoked.proxy as never }))).toThrow(
      'hooks descriptor is invalid'
    )
  })
})
