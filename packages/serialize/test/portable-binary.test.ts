import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { assertPortableValue } from '../src/codec.ts'
import { rpcPortableWalker } from './fixtures/rpc-portable-strategy.ts'

import { codecValue, expectByteBound } from './fixtures/portable-oracle.ts'

describe('serialize portable convergence oracle', () => {
  it('retains array map getter order and inherited index behavior', () => {
    /** Array map reads each present element before normalizing that child. */
    const reads: string[] = []
    /** Accessors distinguish array traversal from parent-record field capture. */
    const input: unknown[] = []
    input.length = 2
    Object.defineProperty(input, '0', {
      enumerable: true,
      get() {
        reads.push('array.0')
        return {
          get value() {
            reads.push('child.value')
            return 1
          }
        }
      }
    })
    Object.defineProperty(input, '1', {
      enumerable: true,
      get() {
        reads.push('array.1')
        return 2
      }
    })
    expect(rpcPortableWalker(input).value).toEqual([{ value: 1 }, 2])
    expect(reads).toEqual(['array.0', 'child.value', 'array.1'])
    reads.length = 0
    expect(codecValue(input)).toEqual([{ value: 1 }, 2])
    expect(reads).toEqual(['array.0', 'child.value', 'array.1'])
    /** Local inherited index avoids modifying the process-wide Array prototype. */
    const inherited = Object.create(Array.prototype) as unknown[]
    inherited[0] = 9
    /** Legacy map behavior consumes inherited present indices. */
    const sparse: unknown[] = []
    sparse.length = 1
    Object.setPrototypeOf(sparse, inherited)
    expect(rpcPortableWalker(sparse).value).toEqual([9])
    expect(codecValue(sparse)).toEqual([9])
  })

  it('snapshots U8, Buffer, foreign views and SharedArrayBuffer-backed bytes', () => {
    /** Fixtures cover each supported brand and every base64url remainder. */
    const inputs = [
      new Uint8Array(),
      new Uint8Array([0]),
      new Uint8Array([0, 1]),
      new Uint8Array([0, 127, 255]),
      Buffer.from([0, 127, 255]),
      runInNewContext('new Uint8Array([0, 127, 255])') as Uint8Array,
      new Uint8Array(new SharedArrayBuffer(3))
    ]
    inputs[6]!.set([0, 127, 255])
    for (const input of inputs) {
      /** Host base64url is test-only expected data, never a production dependency. */
      const expected = { $rpc: 'bytes', base64url: Buffer.from(input).toString('base64url') }
      /** Fixture policy converts real brands while the kernel propagates metadata. */
      const result = rpcPortableWalker(input)
      expect(result.value).toEqual(expected)
      expect(result.hasBinary).toBe(true)
      expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype)
      expect(Object.isFrozen(result.value)).toBe(true)
      expectByteBound(result)
      expect(codecValue(input)).toEqual(expected)
      expect(() => assertPortableValue(input)).toThrow()
    }
    /** Changing caller bytes cannot mutate completed tagged output. */
    const source = new Uint8Array([0, 127, 255])
    /** Original spelling survives source mutation after normalization. */
    const result = rpcPortableWalker(source)
    source.fill(1)
    expect(result.value).toEqual({ $rpc: 'bytes', base64url: 'AH__' })
  })

  it('rejects non-U8 views and preserves legacy retagged-view codec projection', () => {
    for (const input of [new Uint16Array([1]), new Uint8ClampedArray([1])]) {
      expect(() => rpcPortableWalker(input)).toThrow()
      expect(() => codecValue(input)).toThrow()
    }
    /** A record's public tag cannot grant typed-array slots. */
    const forged = { [Symbol.toStringTag]: 'Uint8Array', value: 2 }
    expect(rpcPortableWalker(forged).value).toEqual({ value: 2 })
    expect(rpcPortableWalker(forged).hasBinary).toBe(false)
    /** Old codec conversion trusts a real view's public tag; keep that existing result. */
    const retagged = new Uint16Array([258])
    Object.defineProperty(retagged, Symbol.toStringTag, { value: 'Uint8Array' })
    expect(() => rpcPortableWalker(retagged)).toThrow()
    expect(codecValue(retagged)).toEqual({ $rpc: 'bytes', base64url: 'Ag' })
    expect(() => assertPortableValue(retagged)).toThrow()
  })

  it('snapshots visible bytes without invoking shadowed view length properties', () => {
    /** Only the view's visible two bytes belong to portable payload data. */
    const input = new Uint8Array(new Uint8Array([9, 0, 255, 9]).buffer, 1, 2)
    /** Access counters distinguish true slots from mutable application properties. */
    const reads = { length: 0, byteLength: 0, buffer: 0 }
    for (const key of ['length', 'byteLength', 'buffer'] as const)
      Object.defineProperty(input, key, {
        get() {
          reads[key] += 1
          return undefined
        }
      })
    /** Fixture binary callback copies bytes before invoking the generic base64url helper. */
    const result = rpcPortableWalker(input)
    expect(result.value).toEqual({ $rpc: 'bytes', base64url: 'AP8' })
    expect(result.hasBinary).toBe(true)
    expect(reads).toEqual({ length: 0, byteLength: 0, buffer: 0 })
    expectByteBound(result)
  })

  it('validates canonical RPC tag bits while preserving regex-only existing codec tags', () => {
    for (const base64url of ['', 'AA', 'AAE', 'AH__', '-_8']) {
      /** Existing tagged values participate in binary metadata without native bytes. */
      const input = { $rpc: 'bytes', base64url }
      /** Canonical admission policy lives in fixture rather than factory source. */
      const result = rpcPortableWalker(input)
      expect(result.value).toEqual(input)
      expect(result.hasBinary).toBe(true)
      expectByteBound(result)
      expect(codecValue(input)).toEqual(input)
    }
    for (const base64url of ['A', 'AB', 'AAB', '-_', 'AA=']) {
      /** RPC rejects impossible lengths, unused bits and padding. */
      const input = { $rpc: 'bytes', base64url }
      expect(() => rpcPortableWalker(input)).toThrow()
      if (base64url !== 'AA=') {
        expect(codecValue(input)).toEqual(input)
        expect(() => assertPortableValue(input)).not.toThrow()
      } else {
        expect(() => codecValue(input)).toThrow()
        expect(() => assertPortableValue(input)).toThrow()
      }
    }
  })

  it('lets caller strategy reject reserved keys, tag extras and nonstring payloads', () => {
    for (const input of [
      { $rpc: 'reserved' },
      { $rpc: 'bytes', base64url: 'AA', extra: 1 },
      { $rpc: 'bytes', base64url: 1 },
      { $rpc: 'bytes' }
    ]) {
      expect(() => rpcPortableWalker(input)).toThrow()
      expect(() => codecValue(input)).toThrow()
      expect(() => assertPortableValue(input)).toThrow()
    }
    /** Ordinary records preserve insertion order; a recognized tag has canonical output order. */
    const reversed = { base64url: 'AA', $rpc: 'bytes' }
    expect(Object.keys(rpcPortableWalker(reversed).value as object)).toEqual(['$rpc', 'base64url'])
  })

  it('computes conservative byte bounds and binary flags in one getter traversal', () => {
    /** Scalars exercise UTF-8, JSON escapes, lone surrogates and numeric spelling. */
    const scalarValues = [null, false, true, -0, 1e30, '文😀', '\ud800', '"\\\n\u0000']
    for (const value of scalarValues) expectByteBound(rpcPortableWalker(value))
    /** Own fields are captured once despite returning nested values and metadata. */
    const reads = { ordinary: 0, bytes: 0, child: 0 }
    /** One graph contains native bytes and caller-owned tagged bytes. */
    const input = {
      get ordinary() {
        reads.ordinary += 1
        return {
          get child() {
            reads.child += 1
            return ['文😀', { $rpc: 'bytes', base64url: 'AA' }]
          }
        }
      },
      get bytes() {
        reads.bytes += 1
        return new Uint8Array([0, 1, 2])
      }
    }
    /** This invocation is the only consumer of the caller graph. */
    const result = rpcPortableWalker(input)
    expect(reads).toEqual({ ordinary: 1, bytes: 1, child: 1 })
    expect(result.hasBinary).toBe(true)
    expectByteBound(result)
    expect(rpcPortableWalker({ child: ['ordinary', 1] }).hasBinary).toBe(false)
  })
})
