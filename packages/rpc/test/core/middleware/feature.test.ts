import { describe, expect, it } from 'vitest'
import { abort } from '../../../src/core/middleware/abort.js'
import { ping } from '../../../src/core/middleware/ping.js'
import { installPlugin } from './helpers.js'

describe('feature middleware', () => {
  it('publishes explicit abort and ping capabilities', () => {
    const values = new Map([...installPlugin(abort()), ...installPlugin(ping())])
    expect(values.get('abortCapability')).toEqual({ enabled: true })
    expect(values.get('pingCapability')).toEqual({ enabled: true })
  })
})
