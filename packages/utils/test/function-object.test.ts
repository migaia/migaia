import { describe, expect, it } from 'vitest'
import { assimilateCapturedThen, once, onceAsync, probeThenable } from '../src/function.js'
import {
  diagnosticSnapshot,
  immutableSnapshot,
  isPlainObject,
  probeProperty,
  snapshotOwnDescriptors
} from '../src/object.js'

describe('function and object primitives', () => {
  it('memoizes sync and async calls', async () => {
    let calls = 0
    const value = once(() => ++calls)
    expect(value()).toBe(1)
    expect(value()).toBe(1)
    const asyncValue = onceAsync(async () => ++calls)
    const first = asyncValue()
    expect(await first).toBe(2)
    expect(asyncValue()).toBe(first)
    const invalid = onceAsync(() => 1 as never)
    const invalidFirst = invalid()
    expect(invalid()).toBe(invalidFirst)
    await expect(invalidFirst).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('exposes hostile getter failure and diagnostics', () => {
    const value = {
      get x(): never {
        throw new Error('hostile')
      }
    }
    expect(probeProperty(value, 'x').kind).toBe('failed')
    expect(diagnosticSnapshot(value).diagnostics).toHaveLength(1)
  })

  it('isolates plain graphs while preserving cycles, sharing, and unsupported leaf diagnostics', () => {
    const shared = { value: 1 }
    const root: { left: typeof shared; right: typeof shared; self?: unknown; fn: () => void } = {
      left: shared,
      right: shared,
      fn: () => undefined
    }
    root.self = root
    const snapshot = diagnosticSnapshot(root)
    expect(snapshot.value).not.toBe(root)
    expect(snapshot.value.left).toBe(snapshot.value.right)
    expect(snapshot.value.self).toBe(snapshot.value)
    expect(snapshot.diagnostics).toEqual([{ path: ['fn'], reason: 'unsupported', cause: root.fn }])
  })

  it('rethrows undefined failures and rejects synchronous reentrancy', () => {
    let fail = true
    const value = once(() => {
      if (fail) {
        fail = false
        throw undefined
      }
      return 1
    })
    expect(() => value()).toThrow()
    expect(() => value()).toThrow()
    let recursive!: () => unknown
    recursive = once(() => recursive())
    expect(() => recursive()).toThrow(/reentrant/)
  })

  it('keeps hostile proxy failures inside diagnostic results', () => {
    const cause = new Error('prototype trap')
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw cause
        }
      }
    )
    const snapshot = diagnosticSnapshot({ hostile })
    expect(snapshot.value.hostile).toBe(hostile)
    expect(snapshot.diagnostics).toHaveLength(1)
    expect(snapshot.diagnostics[0].path).toEqual(['hostile'])
    expect(snapshot.diagnostics[0].reason).toBe('read-failed')
    expect(snapshot.diagnostics[0].cause).toBe(cause)
  })

  it('classifies ordinary and hostile shapes without admitting arrays or custom prototypes', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject(Object.create(null))).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(Object.create({ inherited: true }))).toBe(false)
    expect(
      isPlainObject(
        new Proxy(
          {},
          {
            getPrototypeOf: () => {
              throw new Error('trap')
            }
          }
        )
      )
    ).toBe(false)
  })

  it('reads accessor diagnostics once and preserves successful returned values', () => {
    let reads = 0
    const nested = { value: 1 }
    const source = Object.defineProperty({}, 'nested', {
      enumerable: true,
      get: () => {
        reads += 1
        return nested
      }
    })
    const snapshot = diagnosticSnapshot(source)
    expect(reads).toBe(1)
    expect((snapshot.value as { nested: unknown }).nested).not.toBe(nested)
    expect(snapshot.diagnostics[0]).toMatchObject({
      path: ['nested'],
      reason: 'accessor',
      cause: nested
    })
  })

  it('tags missing structuredClone as an environment capability failure', () => {
    const original = globalThis.structuredClone
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined })
    try {
      expect(() => immutableSnapshot({ value: 1 })).toThrow(/host capability is unavailable/)
      expect(() => immutableSnapshot({ value: 1 })).toThrow(/structuredClone/)
    } finally {
      Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: original })
    }
  })

  it('reads then once and assimilates with the original receiver', async () => {
    let reads = 0
    let calls = 0
    const thenable: object = {}
    const thenProperty = String.fromCharCode(116, 104, 101, 110)
    Object.defineProperty(thenable, thenProperty, {
      get() {
        reads += 1
        return (resolve: (value: number) => void) => {
          calls += 1
          resolve(7)
        }
      }
    })
    const probe = probeThenable(thenable)
    expect(probe.kind).toBe('thenable')
    if (probe.kind !== 'thenable') throw new Error('test probe classification')
    await expect(assimilateCapturedThen(probe.thenFn, thenable)).resolves.toBe(7)
    expect(reads).toBe(1)
    expect(calls).toBe(1)
  })

  it('contains descriptor snapshot failures without rereading a revoked proxy', () => {
    const target = Proxy.revocable({}, {})
    target.revoke()
    const snapshot = snapshotOwnDescriptors(target.proxy)
    expect(snapshot.ok).toBe(false)
    if (snapshot.ok) throw new Error('test descriptor snapshot classification')
    expect(snapshot.kind).toBe('failed')
    expect(snapshot.error).toBeInstanceOf(TypeError)
  })
})
