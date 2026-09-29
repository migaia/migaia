import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  normalizePortable,
  normalizeRpcSerializedError,
  serializeRpcError
} from '../../src/contract/index.js'

/** Mix graph edges without constructing an exponentially branching source. */
function makeGraph(depth: number, width: number, edge: number, cycle: boolean): Error {
  const root = new Error('root') as Error & { errors?: Error[]; cleanupErrors?: { error: Error }[] }
  let current = root
  for (let index = 0; index < depth; index += 1) {
    const child = new Error('child')
    if (edge === 0) Object.defineProperty(current, 'cause', { value: child, configurable: true })
    else if (edge === 1)
      Object.defineProperty(current, 'errors', { value: [child], configurable: true })
    else
      Object.defineProperty(current, 'cleanupErrors', {
        value: [{ error: child }],
        configurable: true
      })
    current = child
  }
  if (cycle) Object.defineProperty(current, 'cause', { value: root, configurable: true })
  if (width > 0 && edge !== 1)
    root.errors = Array.from({ length: width }, (_, index) => new Error(String(index)))
  return root
}

describe('wire error sendability budget', () => {
  it('always emits a valid payload under randomized supported graph and data shapes', () => {
    fc.assert(
      fc.property(
        fc.record({
          depth: fc.integer({ min: 0, max: 70 }),
          width: fc.integer({ min: 0, max: 40 }),
          edge: fc.integer({ min: 0, max: 2 }),
          cycle: fc.boolean(),
          dataDepth: fc.integer({ min: 0, max: 70 }),
          textLength: fc.integer({ min: 0, max: 200_000 }),
          textKind: fc.integer({ min: 0, max: 2 }),
          nonError: fc.boolean()
        }),
        ({ depth, width, edge, cycle, dataDepth, textLength, textKind, nonError }) => {
          const text = (textKind === 0 ? 'x' : textKind === 1 ? '\ud800' : '😀').repeat(textLength)
          let data: unknown = text
          for (let index = 0; index < dataDepth; index += 1) data = [data]
          const error = makeGraph(depth, width, edge, cycle) as Error & { data?: unknown }
          error.data = data
          const input = nonError ? { data, text } : error
          const wire = serializeRpcError(input, { report: () => {} })
          expect(normalizeRpcSerializedError(wire)).toEqual(wire)
          let embedded: unknown = wire
          for (let index = 0; index < 16; index += 1) embedded = [embedded]
          expect(() => normalizePortable(embedded)).not.toThrow()
          return true
        }
      ),
      { numRuns: 500, seed: 20260929 }
    )
  }, 30_000)

  it('rejects one additional embedding layer at the tight data depth boundary', () => {
    const error = new Error('root') as Error & { data?: unknown }
    let data: unknown = 'leaf'
    for (let index = 0; index < 47; index += 1) data = [data]
    error.data = data
    const wire = serializeRpcError(error, { report: () => {} })
    let embedded: unknown = wire
    for (let index = 0; index < 17; index += 1) embedded = [embedded]
    expect(() => normalizePortable(embedded)).toThrow(
      expect.objectContaining({ code: 'INVALID_ENVELOPE' })
    )
  })
})
