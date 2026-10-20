import { expect, it } from 'vitest'
import { createPortableWalker, type IPortableWalkerStrategy } from '../src/codec.js'
import { rpcPortableStrategy } from './fixtures/rpc-portable-strategy.js'

/** Ancestor operations are caller-owned; root failures stay raw while a parent maps child failures. */
const ancestorWalker = createPortableWalker({
  ...rpcPortableStrategy,
  violation(reason, cause) {
    if (reason === 'ancestor') throw cause
    return rpcPortableStrategy.violation(reason, cause)
  }
})

/** Fixture native policy proves generic borrowed results without importing any RPC implementation. */
const nativeStrategy: IPortableWalkerStrategy = {
  ...rpcPortableStrategy,
  binary(value, context) {
    if (context.isUint8Array(value) || value instanceof ArrayBuffer) return value
    return rpcPortableStrategy.binary(value, context)
  },
  nativeByteLength(value) {
    return value.byteLength
  },
  finish(value, native) {
    if (native) nativeParents.add(value as object)
    return Object.freeze(value)
  }
}
/** Fixture proof is test-owned; the generic implementation maintains no global value table. */
const nativeParents = new WeakSet<object>()
/** One module-level native specialization shares the same sole portable traversal. */
const walkNative = createPortableWalker(nativeStrategy)

it('borrows native leaf identity without freezing or allocating a descriptor result', () => {
  /** Exact view/backing identity is the native strategy result, rather than an inline wire tag. */
  const view = new Uint8Array([1, 2])
  const backing = new ArrayBuffer(3)
  for (const value of [view, backing]) {
    const output = walkNative(value)
    expect(output.value).toBe(value)
    expect(output.hasBinary).toBe(true)
    expect(output.byteUpperBound).toBe(value.byteLength)
    expect(Object.isFrozen(value)).toBe(false)
    expect(walkNative.value(value)).toBe(value)
  }
})

it('propagates native presence once while inline tags do not mint native-parent proof', () => {
  /** Mixed native and inline nodes separate generic binary presence from native ownership proof. */
  const view = new Uint8Array([4])
  const output = walkNative({ child: [view], inline: { $rpc: 'bytes', base64url: 'AA' } })
  const record = output.value as Record<string, unknown>
  expect((record.child as unknown[])[0]).toBe(view)
  expect(output.hasBinary).toBe(true)
  expect(nativeParents.has(record)).toBe(true)
  expect(nativeParents.has(record.child as object)).toBe(true)
  expect(nativeParents.has(record.inline as object)).toBe(false)
  expect(Object.isFrozen(record)).toBe(true)
  expect(Object.isFrozen(record.child)).toBe(true)
})

it('keeps invocation depth and native-input guard at the caller boundary', () => {
  /** The fixture uses the existing 64 limit and callback to reject only native input. */
  const original = new Error('native input guard')
  expect(() => walkNative(null, undefined, 65)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ENVELOPE' })
  )
  let guards = 0
  /** Only this test policy adds the invocation guard; the generic factory chooses no protocol rule. */
  const guarded = createPortableWalker({
    ...rpcPortableStrategy,
    binary(value, context) {
      if (context.isUint8Array(value)) context.beforeNativeBinary?.()
      return rpcPortableStrategy.binary(value, context) as string | undefined
    }
  })
  const guard = (): never => {
    guards++
    throw original
  }
  expect(guarded.value('plain', undefined, 0, guard)).toBe('plain')
  expect(guards).toBe(0)
  expect(() => guarded.value(new Uint8Array(), undefined, 0, guard)).toThrowError(
    expect.objectContaining({ cause: original })
  )
  expect(guards).toBe(1)
})

it('restores fused accounting after a getter reenters the same owner', () => {
  /** The nested call must not replace the outer binary marker, byte bound or active path. */
  const view = new Uint8Array([1])
  const input = {
    get a() {
      walkNative({ nested: [new Uint8Array([2, 3])] })
      return view
    },
    b: 'tail'
  }
  const output = walkNative(input)
  expect((output.value as Record<string, unknown>).a).toBe(view)
  expect(output.hasBinary).toBe(true)
  expect(output.byteUpperBound).toBeGreaterThanOrEqual(1)
  expect(nativeParents.has(output.value as object)).toBe(true)
})

it('value-only map/species output performs no length read', () => {
  /** A legal species returns an object whose length accessor must remain untouched by freeze. */
  let reads = 0
  /** Exact failure would expose an added output-length observation. */
  const original = new Error('species length read')
  class SpeciesOutput {
    constructor() {
      Object.defineProperty(this, 'length', {
        get() {
          reads++
          throw original
        }
      })
    }
  }
  class InputArray extends Array<unknown> {
    static get [Symbol.species]() {
      return SpeciesOutput as unknown as ArrayConstructor
    }
  }
  /** Caller policy retains original map/species output; value-only kernel skips byte costing. */
  const owner = createPortableWalker({
    ...rpcPortableStrategy,
    arrayValue: undefined,
    array(value, visit) {
      return { value: value.map(visit) }
    }
  })
  const input = new InputArray(1)
  input[0] = 'ok'
  const output = owner.value(input) as Record<string, unknown>
  expect(output['0']).toBe('ok')
  expect(Object.isFrozen(output)).toBe(true)
  expect(reads).toBe(0)
})

it('preserves caller ancestor Set failures at root and enclosing-container boundaries', () => {
  for (const operation of ['has', 'add', 'delete']) {
    /** Public Set subclasses may raise the original native failure during ancestor ownership. */
    const original = new RangeError('caller ancestor failure')
    for (const nested of [false, true]) {
      /** Only the selected node fails, so the nested case reaches its ordinary parent boundary. */
      const target = {}
      class FailingSet extends Set<object> {
        override has(value: object): boolean {
          if (operation === 'has' && value === target) throw original
          return super.has(value)
        }
        override add(value: object): this {
          if (operation === 'add' && value === target) throw original
          return super.add(value)
        }
        override delete(value: object): boolean {
          if (operation === 'delete' && value === target) throw original
          return super.delete(value)
        }
      }
      /** The same factory handles both public result shapes and recursive failure propagation. */
      const invoke = () =>
        ancestorWalker.value(nested ? { child: target } : target, new FailingSet())
      if (nested)
        expect(invoke).toThrowError(
          expect.objectContaining({ code: 'INVALID_ENVELOPE', cause: original })
        )
      else expect(invoke).toThrowError(original)
    }
  }
})

it('raw array policy retains lexical depth and ancestors across map callback reuse', () => {
  /** Wire callbacks own these lexical values even while another array or invocation is active. */
  const owner = createPortableWalker({
    ...rpcPortableStrategy,
    array: undefined,
    arrayValue(value, visit, depth, ancestors, guard, bounds) {
      return value.map((child) => visit(child, depth, ancestors, guard, bounds))
    }
  })
  /** The inner map intentionally calls the callback supplied to its enclosing array. */
  let outerVisit: (child: unknown) => unknown
  const inner: unknown[] = []
  Object.defineProperty(inner, 'map', { value: () => [outerVisit(1)] })
  const outer: unknown[] = []
  Object.defineProperty(outer, 'map', {
    value: (visit: (child: unknown) => unknown) => {
      outerVisit = visit
      return [visit(inner)]
    }
  })
  expect(owner.value(outer, new Set(), 63)).toEqual([[1]])
  expect(outerVisit!(null)).toBeNull()
  /** Reentry changes the active invocation, but the stored callback must still detect its own root. */
  const reentrant: unknown[] = []
  Object.defineProperty(reentrant, 'map', {
    value: (visit: (child: unknown) => unknown) => {
      const nested = {
        get child() {
          return visit(reentrant)
        }
      }
      return [owner.value(nested)]
    }
  })
  expect(() => owner.value(reentrant)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ENVELOPE' })
  )
})
