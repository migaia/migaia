import { describe, expect, it } from 'vitest'
import { safeRead } from '../../src/core/transport-kit.js'

describe('public safeRead failure channel', () => {
  it('does not touch primitives and reads a normal object once', () => {
    expect(safeRead(null, 'value')).toBeUndefined()
    expect(safeRead(1, 'value')).toBeUndefined()
    const identity = {}
    let reads = 0
    const object = {
      get value() {
        reads += 1
        return identity
      }
    }
    expect(safeRead(object, 'value')).toBe(identity)
    expect(reads).toBe(1)
  })

  it('reports the original getter failure once through a synchronous callback', () => {
    const failure = new Error('getter failed')
    const observed: { key: PropertyKey; error: unknown }[] = []
    const object = {
      get value(): never {
        throw failure
      }
    }
    expect(
      safeRead(object, 'value', (failure) => {
        observed.push(failure)
        return undefined
      })
    ).toBeUndefined()
    expect(observed).toEqual([{ key: 'value', error: failure }])
  })

  it('throws a coded TypeError with the original value when no sink exists', () => {
    const failure = new Error('getter failed')
    const object = {
      get value(): never {
        throw failure
      }
    }
    let received: unknown
    try {
      safeRead(object, 'value')
    } catch (error) {
      received = error
    }
    expect(received).toBeInstanceOf(TypeError)
    expect(received).toMatchObject({
      source: '@migaia/rpc/core',
      code: 'PROPERTY_READ_FAILED',
      message: 'rpc property read failed',
      cause: failure
    })
    expect((received as Error).stack).toBeTruthy()
  })

  it('keeps read and reporter failures together in original order', () => {
    const readFailure = new Error('read')
    const reportFailure = new Error('report')
    const object = {
      get value(): never {
        throw readFailure
      }
    }
    let received: unknown
    try {
      safeRead(object, 'value', () => {
        throw reportFailure
      })
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({ code: 'PROPERTY_READ_FAILED' })
    expect((received as Error).cause).toBeInstanceOf(AggregateError)
    expect(((received as Error).cause as AggregateError).errors).toEqual([
      readFailure,
      reportFailure
    ])
  })
})

// @ts-expect-error A report callback must finish synchronously.
safeRead({}, 'value', async () => undefined)
