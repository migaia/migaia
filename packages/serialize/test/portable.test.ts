import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  assertPortableValue,
  createPortableWalker,
  toPortableValue,
  type ICodecValue
} from '../src/codec.js'
import { defineJsonCodec } from '../src/codecs/json.js'
import { SerializeErrorCode } from '../src/error-code.js'
import { base64ToBytes, bytesToBase64 } from '../src/base64.js'
import { rpcPortableStrategy, rpcPortableWalker } from './fixtures/rpc-portable-strategy.js'

/** Package-owned copy of the RPC portable data; no RPC implementation participates in this oracle. */
type IPortableVectors = {
  cases: { id: string; value: unknown }[]
  invalid: string[]
}

/** Error identity remains observable independently from the native TypeError class. */
type IPortableFailure = Error & { readonly source?: string; readonly code?: string }

/** Copied values retain the original schema metadata only as fixture provenance. */
const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/portable-values.json', import.meta.url), 'utf8')
) as IPortableVectors

/** Existing JSON consumer verifies compatibility through its ordinary public codec boundary. */
const jsonCodec = defineJsonCodec({ version: 1 })

/** Use the actual format consumer so compatibility assertions do not expose a policy preset. */
function codecValue(value: unknown): unknown {
  return jsonCodec.decode(jsonCodec.encode(value as ICodecValue))
}

/** Capture one rejection so tests can inspect identity, stack and exact cause references. */
function captureFailure(action: () => unknown): IPortableFailure {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return error as IPortableFailure
  }
  return expect.unreachable('portable input must reject')
}

/** Reconstruct non-JSON forbidden cases from the copied RPC case names. */
function forbiddenValue(id: string): unknown {
  switch (id) {
    case 'Date':
      return new Date(0)
    case 'Map':
      return new Map()
    case 'Set':
      return new Set()
    case 'cycle': {
      /** The repeated edge is an ancestor, unlike accepted shared references. */
      const cycle: Record<string, unknown> = {}
      cycle.self = cycle
      return cycle
    }
    case 'function':
      return () => undefined
    case 'symbol':
      return Symbol('invalid')
    case 'bigint':
      return 1n
    case 'nonfinite':
      return Number.NaN
    case 'malformed-bytes':
      return { $rpc: 'bytes', base64url: 'A' }
    case 'reserved-key-collision':
      return { $rpc: 'reserved', value: 'invalid' }
    default:
      return expect.unreachable('unknown copied portable case: ' + id)
  }
}

/** Root depth is zero; each record edge increments the accepted recursion depth. */
function nestedValue(depth: number): unknown {
  /** Start with a scalar so the deepest value occupies exactly the requested depth. */
  let value: unknown = null
  for (let index = 0; index < depth; index++) value = { child: value }
  return value
}

/** Bound checks inspect completed output rather than reading the caller graph a second time. */
function expectByteBound(result: ReturnType<typeof rpcPortableWalker>): void {
  expect(result.byteUpperBound).toBeGreaterThanOrEqual(
    Buffer.byteLength(JSON.stringify(result.value), 'utf8')
  )
}

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
        source: '@migaia/rpc/contract',
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
        expect.objectContaining({ source: '@migaia/rpc/contract', code: 'INVALID_ENVELOPE' })
      )
      expect(() => codecValue(value)).toThrowError(
        expect.objectContaining({
          source: '@migaia/serialize',
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

  it('preserves sorted public projection and property-order codec getters', () => {
    /** Codec projection recurses before reading the next sorted parent field. */
    const reads: string[] = []
    /** Repeated child references remain independent copies in the legacy codec path. */
    const shared = {
      get value() {
        reads.push('shared.value')
        return 7
      }
    }
    /** Reverse insertion order distinguishes codec sorting from snapshot enumeration. */
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
    expect(reads).toEqual(['a', 'shared.value', 'z', 'shared.value'])
    expect(Object.keys(output)).toEqual(['a', 'z'])
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

  it('wraps getter and reflection failures once with original cause identity intact', () => {
    /** Original application errors remain reachable with the original stack. */
    const original = new Error('portable getter failure')
    /** The parent accessor fails before any child graph can be consumed. */
    let reads = 0
    /** Generic catch delegates domain error construction to caller strategy. */
    const input = {
      get value(): never {
        reads += 1
        throw original
      }
    }
    /** A direct application cause preserves the existing RPC error-chain shape. */
    const error = captureFailure(() => rpcPortableWalker(input))
    expect(reads).toBe(1)
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toMatchObject({
      source: '@migaia/rpc/contract',
      code: 'INVALID_ENVELOPE',
      cause: original
    })
    expect((error.cause as Error).stack).toBe(original.stack)
    /** Reflection traps follow the same caller boundary instead of escaping bare. */
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw original
        }
      }
    )
    expect(captureFailure(() => rpcPortableWalker(hostile)).cause).toBe(original)
  })

  it('invokes caller violation once and preserves the exact caller-thrown error', () => {
    /** An application trap is distinct from policy rejection and must survive on cause. */
    const original = new Error('strategy application trap')
    /** One caller-owned error object is returned through every recursion frame unchanged. */
    const mapped = new TypeError('caller portable rejection', { cause: original })
    Object.defineProperty(mapped, 'source', { value: '@caller/portable', enumerable: true })
    Object.defineProperty(mapped, 'code', { value: 'CALLER_REJECTION', enumerable: true })
    /** Count boundary callbacks and capture the exact cause supplied by the kernel. */
    const causes: unknown[] = []
    /** Caller specialization remains independent of RPC or serialize error policy. */
    const walker = createPortableWalker({
      ...rpcPortableStrategy,
      violation(_reason, cause): never {
        causes.push(cause)
        throw mapped
      }
    })
    /** Nested getter exercises catch propagation through several kernel frames. */
    const input = {
      nested: [
        {
          get child(): never {
            throw original
          }
        }
      ]
    }
    expect(captureFailure(() => walker(input))).toBe(mapped)
    expect(causes).toEqual([original])
    expect(mapped.cause).toBe(original)
    expect(walker(null).value).toBeNull()
    expect(causes).toHaveLength(1)
    /** A policy callback rejection must also bypass all ancestor catch remapping. */
    const policyCauses: unknown[] = []
    /** Reserved-key policy uses context.reject rather than throwing a second package wrapper. */
    const policyWalker = createPortableWalker({
      ...rpcPortableStrategy,
      violation(_reason, cause): never {
        policyCauses.push(cause)
        throw mapped
      }
    })
    expect(captureFailure(() => policyWalker({ nested: { $rpc: 'reserved' } }))).toBe(mapped)
    expect(policyCauses).toEqual([undefined])
  })

  it('retains legacy assertion return value and caller record identity', () => {
    /** Assertion validates caller data without changing identity or descriptors. */
    const input = { z: 1, a: { value: 2 } }
    /** Child identity distinguishes validation from normalization. */
    const child = input.a
    expect(assertPortableValue(input)).toBeUndefined()
    expect(input.a).toBe(child)
    expect(Object.keys(input)).toEqual(['z', 'a'])
    expect(Object.isFrozen(input)).toBe(false)
    /** Old intermediate projection remains independent and lexically ordered. */
    const projected = toPortableValue(input) as Record<string, unknown>
    expect(projected).not.toBe(input)
    expect(Object.keys(projected)).toEqual(['a', 'z'])
    expect(projected.a).not.toBe(child)
  })

  it('snapshots tag getters once and retains legacy assertion getter counts', () => {
    /** Source insertion puts payload before discriminator to expose key policy. */
    const reads: string[] = []
    /** Valid tag accessors exercise capture and assertion as separate existing contracts. */
    const input = {
      get base64url() {
        reads.push('base64url')
        return 'AA'
      },
      get $rpc() {
        reads.push('$rpc')
        return 'bytes'
      }
    }
    expect(rpcPortableWalker(input).value).toEqual({ $rpc: 'bytes', base64url: 'AA' })
    expect(reads).toEqual(['base64url', '$rpc'])
    reads.length = 0
    expect(codecValue(input)).toEqual({ $rpc: 'bytes', base64url: 'AA' })
    expect(reads).toEqual(['base64url', '$rpc'])
    reads.length = 0
    expect(assertPortableValue(input)).toBeUndefined()
    expect(reads).toEqual(['$rpc', 'base64url', 'base64url'])
  })

  it('keeps padded base64 and portable unpadded base64url as distinct spellings', () => {
    /** The shared bytes use padding in base64 and omit padding in caller wire-tag policy. */
    const bytes = new Uint8Array([0, 255])
    expect(bytesToBase64(bytes)).toBe('AP8=')
    expect(base64ToBytes('AP8=')).toEqual(bytes)
    expect(rpcPortableWalker(bytes).value).toEqual({ $rpc: 'bytes', base64url: 'AP8' })
    expect(() => base64ToBytes('AP8')).toThrowError(
      expect.objectContaining({
        source: '@migaia/serialize',
        code: SerializeErrorCode.invalidOption
      })
    )
    expect(() => rpcPortableWalker({ $rpc: 'bytes', base64url: 'AP8=' })).toThrow()
    expect(() => rpcPortableWalker({ $rpc: 'bytes', base64url: '+/8' })).toThrow()
  })

  it('preserves base64 rejection identity for malformed padding and unused bits', () => {
    for (const input of ['A', 'AAAA=', 'AAAA===', 'AB==', 'A===', 'AA=A']) {
      /** Public base64 keeps its existing invalid-option identity and text. */
      const error = captureFailure(() => base64ToBytes(input))
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: '@migaia/serialize',
        code: SerializeErrorCode.invalidOption,
        message: 'invalid base64 input'
      })
      expect(error.stack).toBeTruthy()
    }
  })

  it('owns dense arrays and records while caller finish selects freeze policy', () => {
    /** Array and child-record ownership remain independent from record key policy. */
    const input = [{ value: 1 }, [true, null]]
    /** The fixture's finish callback applies RPC's immutable ownership policy. */
    const result = rpcPortableWalker(input)
    /** Array narrowing is confined to ownership inspection. */
    const output = result.value as unknown[]
    expect(output).toEqual(input)
    expect(output).not.toBe(input)
    expect(output[0]).not.toBe(input[0])
    expect(output[1]).not.toBe(input[1])
    expect(Object.isFrozen(output)).toBe(true)
    expect(Object.isFrozen(output[0])).toBe(true)
    expect(Object.isFrozen(output[1])).toBe(true)
    expect(result.hasBinary).toBe(false)
    expectByteBound(result)
    /** Existing projection owns mutable outputs rather than RPC's frozen output policy. */
    const projected = toPortableValue(input) as unknown[]
    expect(projected).toEqual(input)
    expect(projected).not.toBe(input)
    expect(projected[0]).not.toBe(input[0])
    expect(projected[1]).not.toBe(input[1])
    expect(Object.isFrozen(projected)).toBe(false)
    expect(Object.isFrozen(projected[0])).toBe(false)
    expect(Object.isFrozen(projected[1])).toBe(false)
  })

  it('keeps codec projection errors ahead of later portable assertion failures', () => {
    /** Old projection copies NaN unchanged, then a later getter supplies the primary error. */
    const original = new Error('codec projection getter failure')
    /** Sorted a precedes b; rejecting a too early would hide the observable b getter failure. */
    const input = {
      a: Number.NaN,
      get b(): never {
        throw original
      }
    }
    /** Existing encode boundary classifies the projection trap instead of the later NaN check. */
    const error = captureFailure(() => jsonCodec.encode(input as never))
    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: SerializeErrorCode.encodeFailed,
      cause: original
    })
    expect(error.cause).toBe(original)
  })

  it('preserves own-tag array codec projection while RPC map ignores extra fields', () => {
    /** Existing projection checks an own discriminator before choosing array traversal. */
    const input: unknown[] = []
    Object.defineProperties(input, {
      $rpc: { value: 'bytes', enumerable: true },
      base64url: { value: 'AA', enumerable: true }
    })
    expect(toPortableValue(input)).toEqual({ $rpc: 'bytes', base64url: 'AA' })
    expect(codecValue(input)).toEqual({ $rpc: 'bytes', base64url: 'AA' })
    expect(assertPortableValue(input)).toBeUndefined()
    /** RPC wire map ignores array extras and therefore produces no binary metadata. */
    const result = rpcPortableWalker(input)
    expect(result.value).toEqual([])
    expect(result.hasBinary).toBe(false)
    expectByteBound(result)
  })

  it('preserves one own-key reflection for legacy tagged-value assertion', () => {
    /** Proxy reflection count is part of the existing assertion's caller-observable behavior. */
    let reads = 0
    /** A valid caller-owned tag exercises Object.keys without projection or copy. */
    const input = new Proxy(
      { $rpc: 'bytes', base64url: 'AA' },
      {
        ownKeys(target) {
          reads += 1
          return Reflect.ownKeys(target)
        }
      }
    )
    expect(assertPortableValue(input)).toBeUndefined()
    expect(reads).toBe(1)
  })
})

it('RPC scalar rejection precedes nested getters while classified errors keep identity', () => {
  /** Child reads distinguish eager RPC rejection from serialize's deferred codec validation. */
  let reads = 0
  /** The parent pre-captures b, but the rejected a prevents walking b's own fields. */
  const value = {
    a: undefined,
    b: {
      get child() {
        reads++
        return 1
      }
    }
  }
  expect(captureFailure(() => rpcPortableWalker(value)).cause).toBeUndefined()
  expect(reads).toBe(0)
  /** Existing domain errors crossing an accessor retain the original reference and stack. */
  const original = new TypeError('already classified')
  Object.defineProperty(original, 'source', { value: '@migaia/rpc/contract' })
  Object.defineProperty(original, 'code', { value: 'INVALID_ENVELOPE' })
  expect(
    captureFailure(() =>
      rpcPortableWalker({
        get value() {
          throw original
        }
      })
    )
  ).toBe(original)
})

it('legacy iterator-only array assertion adds no caller length reads', () => {
  /** A supported array iterator supplies portable values without consulting its own length. */
  /** Sentinel catches any extra metadata read after the custom iterator completes. */
  const original = new Error('unexpected caller length read')
  const input = new Proxy([1], {
    get(target, key, receiver) {
      if (key === 'length') throw original
      if (key === Symbol.iterator)
        return function* () {
          yield 1
        }
      return Reflect.get(target, key, receiver)
    }
  })
  expect(assertPortableValue(input)).toBeUndefined()
})

it('RPC root byte-copy errors stay raw while enclosing containers retain cause', () => {
  /** Copy the original detached byte-view case without importing RPC or adding wire behavior. */
  const bytes = new Uint8Array([1])
  structuredClone(bytes.buffer, { transfer: [bytes.buffer] })
  /** Root binary conversion predates the original normalizer's array/record catch boundaries. */
  const root = captureFailure(() => rpcPortableWalker(bytes))
  expect(root).toBeInstanceOf(TypeError)
  expect(root.source).toBeUndefined()
  expect(root.code).toBeUndefined()
  for (const value of [{ child: bytes }, [bytes]]) {
    const nested = captureFailure(() => rpcPortableWalker(value))
    expect(nested).toMatchObject({ source: '@migaia/rpc/contract', code: 'INVALID_ENVELOPE' })
    expect(nested.cause).toBeInstanceOf(TypeError)
    expect((nested.cause as IPortableFailure).source).toBeUndefined()
    expect((nested.cause as Error).message).toBe(root.message)
    expect((nested.cause as Error).stack).toContain('binary')
  }
})
