import { describe, expect, it } from 'vitest'
import { ping } from '../../../src/core/middleware/ping.js'
import { installPlugin } from './helpers.js'

describe('ping middleware', () => {
  it('publishes an enabled ping capability', () => {
    const values = installPlugin(ping())
    expect(values.get('pingCapability')).toEqual({ enabled: true })
  })
})
