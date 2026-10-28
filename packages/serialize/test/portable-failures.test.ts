import { describe, expect, it } from 'vitest'
import { assertPortableValue, createPortableWalker, toPortableValue } from '../src/codec.ts'
import { SerializeErrorCode } from '../src/error-code.ts'
import { base64ToBytes, bytesToBase64 } from '../src/base64.ts'
import { rpcPortableStrategy, rpcPortableWalker } from './fixtures/rpc-portable-strategy.ts'

import {
  jsonCodec,
  codecValue,
  captureFailure,
  expectByteBound,
  type IPortableFailure
} from './fixtures/portable-oracle.ts'

describe('serialize portable convergence oracle', () => {
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
      source: 'rpc.contract',
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
    /** Intermediate projection remains independent and preserves property enumeration order. */
    const projected = toPortableValue(input) as Record<string, unknown>
    expect(projected).not.toBe(input)
    expect(Object.keys(projected)).toEqual(['z', 'a'])
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
        source: 'serialization',
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
        source: 'serialization',
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
    /** Enumerated a precedes b; rejecting a too early would hide the observable b getter failure. */
    const input = {
      a: Number.NaN,
      get b(): never {
        throw original
      }
    }
    /** Existing encode boundary classifies the projection trap instead of the later NaN check. */
    const error = captureFailure(() => jsonCodec.encode(input as never))
    expect(error).toMatchObject({
      source: 'serialization',
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
  Object.defineProperty(original, 'source', { value: 'rpc.contract' })
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
    expect(nested).toMatchObject({ source: 'rpc.contract', code: 'INVALID_ENVELOPE' })
    expect(nested.cause).toBeInstanceOf(TypeError)
    expect((nested.cause as IPortableFailure).source).toBeUndefined()
    expect((nested.cause as Error).message).toBe(root.message)
    expect((nested.cause as Error).stack).toContain('binary')
  }
})
