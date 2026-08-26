import { describe, expect, it } from 'vitest'
import { ping } from '../../src/middleware/ping'
import { installPlugin } from './helpers'

describe('ping middleware', () => {
  it('publishes an enabled ping capability', () => {
    const values = installPlugin(ping())
    expect(values.get('pingCapability')).toEqual({ enabled: true })
  })
})
