import { describe, expect, it } from 'vitest'
import { uuid } from '../../src/middleware/uuid'
import { installPlugin } from './helpers'

describe('uuid middleware', () => {
  it('publishes the injected generator', () => {
    const generate = () => 'id'
    const values = installPlugin(uuid({ generate }))
    expect((values.get('uuid') as { generate: typeof generate }).generate()).toBe('id')
  })
})
