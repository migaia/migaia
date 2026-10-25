/** Pure guarded diagnostics belong to the canonical Contract error owner. */
import { describe, expect, it } from 'vitest'
import { safeRead } from '@migaia/rpc-contract/errors'

describe('safeRead guarded property policy', () => {
  it('skips primitives and returns a successful read unchanged', () => {
    expect(safeRead(null, 'value')).toBeUndefined()
    expect(safeRead(1, 'value')).toBeUndefined()
    /** A successful property read preserves exact caller value identity. */
    const value = {}
    expect(safeRead({ value }, 'value')).toBe(value)
  })

  it('reports one getter failure or throws with its original cause', () => {
    /** Getter failure identity is independent from its coded diagnostic wrapper. */
    const failure = new Error('read failed')
    /** Each requested property is read once, including the throwing path. */
    let reads = 0
    /** This real accessor supplies the supported hostile property boundary. */
    const target = {
      get value(): never {
        reads += 1
        throw failure
      }
    }
    /** A caller-selected reporter observes the exact original property failure. */
    const reported: unknown[] = []
    expect(
      safeRead(target, 'value', (event) => {
        reported.push(event)
        return undefined
      })
    ).toBeUndefined()
    expect(reported).toEqual([{ key: 'value', error: failure }])
    expect(reads).toBe(1)

    /** The uncaught boundary exposes a native coded TypeError with the original cause. */
    let thrown: unknown
    try {
      safeRead(target, 'value')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      source: 'rpc.endpoint',
      code: 'PROPERTY_READ_FAILED',
      cause: failure
    })
    expect(thrown).toBeInstanceOf(TypeError)
    expect(reads).toBe(2)
  })

  it('keeps read and reporter failures in their original order', () => {
    /** Primary and secondary errors retain their independent identities and order. */
    const readFailure = new Error('read failed')
    /** Reporter failure cannot replace the property failure. */
    const reportFailure = new Error('report failed')
    /** Native property traps prove the diagnostic path does not retry the getter. */
    const traps: PropertyKey[] = []
    /** The original proxy exercises a real native getter failure rather than a fabricated result. */
    const target = new Proxy(
      {},
      {
        get(_object, key): never {
          traps.push(key)
          throw readFailure
        }
      }
    )
    /** Standard error edges must preserve the primary and reporting errors together. */
    let thrown: unknown
    try {
      safeRead(target, 'value', () => {
        throw reportFailure
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ source: 'rpc.endpoint', code: 'PROPERTY_READ_FAILED' })
    expect(thrown).toBeInstanceOf(TypeError)
    expect((thrown as Error).cause).toBeInstanceOf(AggregateError)
    expect(((thrown as Error).cause as AggregateError).errors).toEqual([readFailure, reportFailure])
    expect(traps).toEqual(['value'])
  })
})

// RPC-TEST-CCDBF0994A49-C001: original supported atoms received at their canonical owner; old alias/key facets stay NoPASS.
it('contains hostile property getters', () => {
  const failure = new Error('getter')
  const reported: unknown[] = []
  const hostile = new Proxy(
    {},
    {
      get() {
        throw failure
      }
    }
  )
  expect(
    safeRead(hostile, 'value', (failure) => {
      reported.push(failure)
      return undefined
    })
  ).toBeUndefined()
  expect(reported).toEqual([{ key: 'value', error: failure }])
})

// RPC-TEST-CCDBF0994A49-C005: original supported atoms received at their canonical owner; old alias/key facets stay NoPASS.
it('keeps inherited getter receivers and performs no has or descriptor trap', () => {
  /** Each trap is observable at this untrusted property boundary. */
  const operations: string[] = []
  /** A prototype getter exercises inherited reads without a descriptor snapshot. */
  const prototype = {
    get value() {
      expect(this).toBe(proxy)
      return 3
    }
  }
  /** The proxy exposes any additional lookup operation introduced by convergence. */
  const proxy = new Proxy(Object.create(prototype) as object, {
    get(target, key, originalReceiver) {
      operations.push('get')
      return Reflect.get(target, key, originalReceiver)
    },
    has() {
      operations.push('has')
      return true
    },
    getOwnPropertyDescriptor() {
      operations.push('descriptor')
      return undefined
    },
    ownKeys() {
      operations.push('keys')
      return []
    }
  })
  expect(safeRead(proxy, 'value')).toBe(3)
  expect(operations).toEqual(['get'])
})
