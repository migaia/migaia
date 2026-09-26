import { describe, expect, it } from 'vitest'
import { abort } from '../../../src/core/middleware/abort.js'
import { installPlugin } from './helpers.js'

describe('abort middleware', () => {
  it('publishes an enabled abort capability', () => {
    const values = installPlugin(abort())
    expect(values.get('abortCapability')).toEqual({ enabled: true })
  })
})
