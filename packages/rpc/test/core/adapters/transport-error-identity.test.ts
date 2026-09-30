import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../../src/core/adapters/memory.js'

describe('memory transport terminal identity', () => {
  it('[A3] sends a tagged native Error with stable text to each side', () => {
    const [left, right] = createMemoryTransportPair()
    const observed: unknown[] = []
    left.onTransportError?.((error) => observed.push(error))
    right.onTransportError?.((error) => observed.push(error))
    left.close()
    expect(observed).toHaveLength(2)
    for (const error of observed) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).constructor).toBe(Error)
      expect(error).toMatchObject({
        name: 'Error',
        message: '[rpc] memory transport is closed',
        source: '@migaia/rpc/core',
        code: 'TRANSPORT'
      })
    }
  })
})
