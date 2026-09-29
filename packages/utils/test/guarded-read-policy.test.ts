import { describe, expect, it } from 'vitest'
import { inspectThenable, probeThenable, ThenableProbeKind } from '../src/function.js'

describe('thenable guarded-read policy', () => {
  it('skips primitives and preserves non-function and function results', () => {
    for (const value of [null, 42, 'text']) {
      expect(probeThenable(value)).toEqual({ kind: ThenableProbeKind.notThenable })
      expect(inspectThenable(value)).toEqual({})
    }

    let reads = 0
    const functionValue = () => undefined
    const object = Object.defineProperty({}, String.fromCharCode(116, 104, 101, 110), {
      get: () => {
        reads += 1
        return functionValue
      }
    })
    expect(probeThenable(object)).toEqual({
      kind: ThenableProbeKind.thenable,
      thenFn: functionValue
    })
    expect(inspectThenable(object)).toHaveProperty('then', functionValue)
    expect(reads).toBe(2)

    const nonFunction = Object.defineProperty({}, String.fromCharCode(116, 104, 101, 110), {
      value: 7
    })
    expect(probeThenable(nonFunction)).toEqual({ kind: ThenableProbeKind.notThenable })
    expect(inspectThenable(nonFunction)).toEqual({})
  })

  it('collects the original getter failure after one read', () => {
    const failure = new Error('getter failed')
    let reads = 0
    const object = Object.defineProperty({}, String.fromCharCode(116, 104, 101, 110), {
      get: () => {
        reads += 1
        throw failure
      }
    })
    expect(probeThenable(object)).toEqual({ kind: ThenableProbeKind.failed, error: failure })
    expect(inspectThenable(object)).toEqual({ error: failure })
    expect(reads).toBe(2)

    const traps: PropertyKey[] = []
    const proxy = new Proxy(
      {},
      {
        get(_target, key) {
          traps.push(key)
          throw failure
        }
      }
    )
    expect(probeThenable(proxy)).toEqual({ kind: ThenableProbeKind.failed, error: failure })
    expect(inspectThenable(proxy)).toEqual({ error: failure })
    expect(traps).toEqual(['then', 'then'])
  })
})
