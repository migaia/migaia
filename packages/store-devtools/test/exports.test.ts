import { describe, expect, it } from 'vitest'
import { getDependencyTree } from '../src/index.ts'

describe('store-devtools exports', () => {
  it('exposes dependency inspection', () => {
    expect(typeof getDependencyTree).toBe('function')
  })
})
