import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { assertPortableValue, createPortableWalker, toPortableValue } from '../src/codec.ts'
import { SerializeErrorCode } from '../src/error-code.ts'
import { rpcPortableStrategy, rpcPortableWalker } from './fixtures/rpc-portable-strategy.ts'

import {
  vectors,
  codecValue,
  captureFailure,
  forbiddenValue,
  nestedValue,
  expectByteBound
} from './fixtures/portable-oracle.ts'

describe('serialize portable convergence oracle', () => {
  it('owns values through a caller strategy and existing codec consumer', () => {
    for (const vector of vectors.cases) {
      /** The factory reports metadata while fixture callbacks own RPC wire policy. */
      const result = rpcPortableWalker(vector.value)
      expect(result.value, vector.id).toEqual(vector.value)
      expect(result.hasBinary, vector.id).toBe(vector.id === 'bytes')
      expectByteBound(result)
      expect(codecValue(vector.value), vector.id).toEqual(vector.value)
    }
  })

  it('owns the complete forbidden matrix and caller-owned error identity', () => {
    for (const id of vectors.invalid) {
      /** Domain identity originates in the fixture callback, never serialize production policy. */
      const error = captureFailure(() => rpcPortableWalker(forbiddenValue(id)))
      expect(error, id).toBeInstanceOf(TypeError)
      expect(error, id).toMatchObject({
        source: 'rpc.contract',
        code: 'INVALID_ENVELOPE',
        message: 'rpc envelope is invalid'
      })
      expect(error.stack, id).toBeTruthy()
    }
  })

  it('preserves finite scalars and negative zero; rejects undefined and nonfinite inputs', () => {
    /** The kernel retains the scalar selected by caller strategy rather than JSON coercing it. */
    const negativeZero = rpcPortableWalker(-0)
    expect(Object.is(negativeZero.value, -0)).toBe(true)
    expect(negativeZero.hasBinary).toBe(false)
    expectByteBound(negativeZero)
    expect(Object.is(toPortableValue(-0), -0)).toBe(true)
    for (const value of [undefined, Number.NaN, Infinity, -Infinity, 1n, Symbol(), () => {}]) {
      expect(() => rpcPortableWalker(value)).toThrowError(
        expect.objectContaining({ source: 'rpc.contract', code: 'INVALID_ENVELOPE' })
      )
      expect(() => codecValue(value)).toThrowError(
        expect.objectContaining({
          source: 'serialization',
          code: SerializeErrorCode.invalidOption
        })
      )
    }
    expect(toPortableValue(undefined)).toBeUndefined()
    expect(toPortableValue(Number.NaN)).toBeNaN()
    expect(() => assertPortableValue(undefined)).toThrow()
  })

  it('copies parent capture order, frozen null prototypes and repeated references', () => {
    /** Reads record the complete copied getter order. */
    const reads: string[] = []
    /** One caller object receives an independent snapshot at every accepted occurrence. */
    const shared = {
      get value() {
        reads.push('shared.value')
        return 7
      }
    }
    /** Two independent graphs reuse the same child without creating an ancestor cycle. */
    const inputs = [
      {
        get z() {
          reads.push('first.z')
          return shared
        },
        get a() {
          reads.push('first.a')
          return shared
        }
      },
      {
        get second() {
          reads.push('second.second')
          return {
            get child() {
              reads.push('second.child')
              return shared
            }
          }
        },
        get first() {
          reads.push('second.first')
          return shared
        }
      }
    ]
    /** Inspect only admitted values, never re-read caller getters while checking results. */
    const outputs = inputs.map((input) => rpcPortableWalker(input).value) as Record<
      string,
      unknown
    >[]
    expect(reads).toEqual([
      'first.z',
      'first.a',
      'shared.value',
      'shared.value',
      'second.second',
      'second.first',
      'second.child',
      'shared.value',
      'shared.value'
    ])
    for (const output of outputs) {
      expect(Object.getPrototypeOf(output)).toBeNull()
      expect(Object.isFrozen(output)).toBe(true)
      expect(Object.hasOwn(output, 'toString')).toBe(false)
      for (const child of Object.values(output)) {
        expect(Object.getPrototypeOf(child)).toBeNull()
        expect(Object.isFrozen(child)).toBe(true)
      }
    }
    expect(Object.keys(outputs[0]!)).toEqual(['z', 'a'])
    expect(outputs[0]!.z).not.toBe(shared)
    expect(outputs[0]!.z).not.toBe(outputs[0]!.a)
    expect(Object.isFrozen((outputs[1]!.second as Record<string, unknown>).child)).toBe(true)
  })

  it('preserves property enumeration order for public projection and codec getters', () => {
    /** Public and codec projections recurse before reading the next enumerated parent field. */
    const reads: string[] = []
    /** Repeated child references remain independent copies in the legacy codec path. */
    const shared = {
      get value() {
        reads.push('shared.value')
        return 7
      }
    }
    /** Reverse alphabetical insertion order distinguishes enumeration from comparison sorting. */
    const input = {
      get z() {
        reads.push('z')
        return shared
      },
      get a() {
        reads.push('a')
        return shared
      }
    }
    /** Inspect the existing public projection without introducing an exported codec strategy. */
    const output = toPortableValue(input) as Record<string, unknown>
    expect(reads).toEqual(['z', 'shared.value', 'a', 'shared.value'])
    expect(Object.keys(output)).toEqual(['z', 'a'])
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
    expect(Object.isFrozen(output)).toBe(false)
    expect(output.a).not.toBe(output.z)
    expect(Object.getPrototypeOf(output.a)).toBe(Object.prototype)
    expect(Object.isFrozen(output.a)).toBe(false)
    reads.length = 0
    expect(codecValue(input)).toEqual(output)
    expect(reads).toEqual(['z', 'shared.value', 'a', 'shared.value'])
  })

  it('retains integer-key enumeration and ignores nonenumerable and symbol properties', () => {
    /** Own string enumeration precedes non-integer insertion order exactly as Object.keys. */
    const input = { z: 1, '10': 10, a: 2, '2': 2 }
    Object.defineProperty(input, 'hidden', { value: undefined })
    Object.defineProperty(input, Symbol('ignored'), { value: undefined, enumerable: true })
    /** Caller strategy preserves insertion order after integer-key enumeration. */
    const snapshot = rpcPortableWalker(input).value as Record<string, unknown>
    /** Format codecs retain integer enumeration followed by inserted string fields. */
    const codec = codecValue(input) as Record<string, unknown>
    expect(Object.keys(snapshot)).toEqual(['2', '10', 'z', 'a'])
    expect(Object.keys(codec)).toEqual(['2', '10', 'z', 'a'])
    expect(Reflect.ownKeys(snapshot)).toHaveLength(4)
    expect(Reflect.ownKeys(codec)).toHaveLength(4)
  })

  it('accepts null prototypes and own __proto__ data without publishing caller objects', () => {
    /** Null-prototype input includes an own spelling that cannot mutate output prototypes. */
    const input = Object.create(null) as Record<string, unknown>
    input.__proto__ = { safe: true }
    Object.defineProperty(input, 'toString', { value: 'owned', enumerable: true })
    for (const output of [
      rpcPortableWalker(input).value as Record<string, unknown>,
      codecValue(input) as Record<string, unknown>
    ]) {
      expect(output).not.toBe(input)
      expect(Object.hasOwn(output, '__proto__')).toBe(true)
      expect(output.__proto__).toEqual({ safe: true })
      expect(output.toString).toBe('owned')
    }
    expect(Object.getPrototypeOf(rpcPortableWalker(input).value)).toBeNull()
    expect(Object.getPrototypeOf(codecValue(input))).toBe(Object.prototype)
  })

  it('rejects nonplain RPC snapshots while retaining legacy codec own-key projection', () => {
    /** Class data has a nonplain prototype but legacy projection consumes its own fields. */
    class OwnedRecord {
      /** Own caller data becomes a plain codec record. */
      value = 3
    }
    for (const { input, expected } of [
      { input: new OwnedRecord(), expected: { value: 3 } },
      { input: Object.create({ inherited: true }) as unknown, expected: {} },
      { input: new ArrayBuffer(3), expected: {} },
      { input: new SharedArrayBuffer(3), expected: {} },
      { input: runInNewContext('({ value: 4 })') as unknown, expected: { value: 4 } },
      { input: new Proxy(new Uint8Array([1, 2]), {}), expected: { '0': 1, '1': 2 } }
    ]) {
      expect(() => rpcPortableWalker(input)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ENVELOPE' })
      )
      expect(toPortableValue(input)).toEqual(expected)
      expect(codecValue(input)).toEqual(expected)
    }
    for (const input of [new Date(0), new Map(), new Set(), new DataView(new ArrayBuffer(2))]) {
      expect(() => rpcPortableWalker(input)).toThrow()
      expect(() => codecValue(input)).toThrow()
    }
  })

  it('rejects ancestor cycles while allowing repeated siblings in both consumers', () => {
    /** Repeating a completed child is accepted; referencing the active root is not. */
    const shared = { value: 1 }
    /** A cycle can occur through an array as well as a record field. */
    const arrayCycle: unknown[] = []
    arrayCycle.push(arrayCycle)
    for (const output of [
      rpcPortableWalker([shared, shared]).value as unknown[],
      toPortableValue([shared, shared]) as unknown[]
    ]) {
      expect(output[0]).not.toBe(output[1])
      expect(output[0]).not.toBe(shared)
    }
    for (const value of [forbiddenValue('cycle'), arrayCycle]) {
      expect(() => rpcPortableWalker(value)).toThrow()
      expect(() => codecValue(value)).toThrow()
    }
  })

  it('takes depth from caller strategy and preserves unlimited existing codec depth', () => {
    expect(() => rpcPortableWalker(nestedValue(64))).not.toThrow()
    expect(() => rpcPortableWalker(nestedValue(65))).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENVELOPE' })
    )
    expect(() => codecValue(nestedValue(65))).not.toThrow()
    expect(() => assertPortableValue(toPortableValue(nestedValue(65)))).not.toThrow()
    /** A separate factory instance owns its depth policy without a per-node profile switch. */
    const rootOnly = createPortableWalker({ ...rpcPortableStrategy, maxDepth: 0 })
    expect(() => rootOnly(null)).not.toThrow()
    expect(() => rootOnly({})).not.toThrow()
    expect(() => rootOnly({ child: null })).toThrow()
    /** A caller can choose a larger supported budget while reusing the same recursion kernel. */
    const largerBudget = createPortableWalker({ ...rpcPortableStrategy, maxDepth: 65 })
    expect(() => largerBudget(nestedValue(65))).not.toThrow()
  })

  it('preserves sparse RPC arrays and rejects them in the existing codec consumer', () => {
    /** A hole remains absent in a snapshot; its JSON byte contribution is null. */
    const sparse: unknown[] = []
    sparse.length = 3
    sparse[1] = 'middle'
    Object.defineProperty(sparse, 'extra', { value: undefined, enumerable: true })
    /** Default kernel map retains hole behavior; the caller finish policy freezes output. */
    const result = rpcPortableWalker(sparse)
    /** Array narrowing is confined to shape inspection. */
    const output = result.value as unknown[]
    expect(output).toHaveLength(3)
    expect(Object.hasOwn(output, 0)).toBe(false)
    expect(Object.hasOwn(output, 1)).toBe(true)
    expect(Object.hasOwn(output, 2)).toBe(false)
    expect(Object.hasOwn(output, 'extra')).toBe(false)
    expect(Object.isFrozen(output)).toBe(true)
    expectByteBound(result)
    expect(() => codecValue(sparse)).toThrow()
    /** The old projection stays sparse even though its subsequent assertion rejects. */
    const projected = toPortableValue(sparse) as unknown[]
    expect(Object.hasOwn(projected, 0)).toBe(false)
    expect(() => assertPortableValue(projected)).toThrow()
    expect(() => rpcPortableWalker([undefined])).toThrow()
    expect(() => codecValue([undefined])).toThrow()
  })
})
