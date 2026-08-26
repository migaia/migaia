import { describe, expect, it } from 'vitest'
import { abort } from '../../src/middleware/abort'
import { ping } from '../../src/middleware/ping'
import { installPlugin } from './helpers'

describe('feature middleware', () => {
  it('publishes explicit abort and ping capabilities', () => {
    const values = new Map([...installPlugin(abort()), ...installPlugin(ping())])
    expect(values.get('abortCapability')).toEqual({ enabled: true })
    expect(values.get('pingCapability')).toEqual({ enabled: true })
  })
})
