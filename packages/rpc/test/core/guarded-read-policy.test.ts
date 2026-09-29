import { describe, expect, it } from 'vitest'
import { safeRead } from '../../src/core/transport-kit.js'

describe('safeRead guarded property policy', () => {
  it('skips primitives and returns a successful read unchanged', () => {
    expect(safeRead(null, 'value')).toBeUndefined()
    expect(safeRead(1, 'value')).toBeUndefined()
    const value = {}
    expect(safeRead({ value }, 'value')).toBe(value)
  })

  it('reports one getter failure or throws with its original cause', () => {
    const failure = new Error('read failed')
    let reads = 0
    const target = {
      get value(): never {
        reads += 1
        throw failure
      }
    }
    const reported: unknown[] = []
    expect(
      safeRead(target, 'value', (event) => {
        reported.push(event)
        return undefined
      })
    ).toBeUndefined()
    expect(reported).toEqual([{ key: 'value', error: failure }])
    expect(reads).toBe(1)

    let thrown: unknown
    try {
      safeRead(target, 'value')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      source: '@migaia/rpc/core',
      code: 'PROPERTY_READ_FAILED',
      cause: failure
    })
    expect(thrown).toBeInstanceOf(TypeError)
    expect(reads).toBe(2)
  })

  it('keeps read and reporter failures in their original order', () => {
    const readFailure = new Error('read failed')
    const reportFailure = new Error('report failed')
    const traps: PropertyKey[] = []
    const target = new Proxy(
      {},
      {
        get(_object, key): never {
          traps.push(key)
          throw readFailure
        }
      }
    )
    let thrown: unknown
    try {
      safeRead(target, 'value', () => {
        throw reportFailure
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ source: '@migaia/rpc/core', code: 'PROPERTY_READ_FAILED' })
    expect(thrown).toBeInstanceOf(TypeError)
    expect((thrown as Error).cause).toBeInstanceOf(AggregateError)
    expect(((thrown as Error).cause as AggregateError).errors).toEqual([readFailure, reportFailure])
    expect(traps).toEqual(['value'])
  })
})
