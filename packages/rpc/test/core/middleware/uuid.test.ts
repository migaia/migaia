import { describe, expect, it } from 'vitest'
import { uuid } from '../../../src/core/middleware/uuid.js'
import { installPlugin } from './helpers.js'

describe('uuid middleware', () => {
  it('publishes the injected generator', () => {
    const generate = () => 'id'
    const values = installPlugin(uuid({ generate }))
    expect((values.get('uuid') as { generate: typeof generate }).generate()).toBe('id')
  })
})
