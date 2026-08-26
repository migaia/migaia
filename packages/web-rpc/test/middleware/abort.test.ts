import { describe, expect, it } from 'vitest'
import { abort } from '../../src/middleware/abort'
import { installPlugin } from './helpers'

describe('abort middleware', () => {
  it('publishes an enabled abort capability', () => {
    const values = installPlugin(abort())
    expect(values.get('abortCapability')).toEqual({ enabled: true })
  })
})
