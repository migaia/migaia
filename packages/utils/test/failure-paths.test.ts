import { describe, expect, it, vi } from 'vitest'
import { collect } from '../src/collector.ts'
import { attachErrorIdentity, hasErrorIdentity, identifyBoundaryFailure } from '../src/error.ts'
import { diagnosticSnapshot, snapshotOptionProperties } from '../src/object.ts'
import { asyncTask, coalesce, throttle } from '../src/scheduler.ts'

/** Identity used by the boundary classification cases. */
const identity = { source: 'fixture.boundary', code: 'BOUNDARY_FAILED' } as const

/** Wraps a cause the way a package boundary would. */
function wrap(cause: unknown): Error {
  return new Error('wrapped', { cause })
}

/** Class whose prototype getter and method must be read through the original instance. */
class Options {
  /** Own field read directly. */
  own = 1
  /** Prototype getter; its receiver must be the original object. */
  get derived(): number {
    return this.own + 1
  }
  /** Prototype method copied as a value. */
  method(): string {
    return 'method'
  }
}

describe('snapshotOptionProperties', () => {
  it('copies own and class-prototype members once, skipping constructor and Object.prototype', () => {
    const copy = snapshotOptionProperties(new Options())
    expect(copy.own).toBe(1)
    expect(copy.derived).toBe(2)
    expect(typeof copy.method).toBe('function')
    expect(Object.hasOwn(copy, 'constructor')).toBe(false)
    expect(Object.hasOwn(copy, 'toString')).toBe(false)
  })

  it('lets a nearer key shadow a prototype key and keeps __proto__ as data', () => {
    /** Own key named like the prototype getter. */
    const value = new Options()
    Object.defineProperty(value, 'derived', { value: 10, enumerable: true })
    Object.defineProperty(value, '__proto__', { value: 'data', enumerable: true })
    const copy = snapshotOptionProperties(value)
    expect(copy.derived).toBe(10)
    expect(Object.getOwnPropertyDescriptor(copy, '__proto__')?.value).toBe('data')
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
  })
})

describe('identifyBoundaryFailure', () => {
  it('wraps a non-error value', () => {
    const result = identifyBoundaryFailure('text', identity, wrap) as Error
    expect(result.cause).toBe('text')
  })

  it('keeps an already coded error', () => {
    const coded = attachErrorIdentity(new Error('coded'), { source: 'other', code: 'OTHER' })
    expect(identifyBoundaryFailure(coded, identity, wrap)).toBe(coded)
  })

  it('codes an uncoded extensible error in place', () => {
    const plain = new Error('plain')
    expect(identifyBoundaryFailure(plain, identity, wrap)).toBe(plain)
    expect(plain).toMatchObject(identity)
  })

  it('wraps a frozen uncoded error and a partly coded error', () => {
    const frozen = Object.freeze(new Error('frozen'))
    expect((identifyBoundaryFailure(frozen, identity, wrap) as Error).cause).toBe(frozen)
    const partial = Object.assign(new Error('partial'), { code: 'ONLY_CODE' })
    expect((identifyBoundaryFailure(partial, identity, wrap) as Error).cause).toBe(partial)
  })

  it('wraps an error whose descriptors cannot be read and keeps the read failure', () => {
    /** Failure thrown by the descriptor trap. */
    const readFailure = new Error('descriptor read failed')
    const hostile = new Proxy(new Error('hostile'), {
      getOwnPropertyDescriptor() {
        throw readFailure
      }
    })
    const result = identifyBoundaryFailure(hostile, identity, wrap) as Error & {
      errors?: unknown[]
    }
    expect(result.cause).toBe(hostile)
    expect(result.errors).toContain(readFailure)
  })
})

describe('diagnosticSnapshot reflective failures', () => {
  it('records read-failed when keys or descriptors cannot be read', () => {
    /** Failure from the ownKeys trap. */
    const keysFailure = new Error('ownKeys failed')
    const noKeys = new Proxy(
      {},
      {
        ownKeys() {
          throw keysFailure
        }
      }
    )
    expect(diagnosticSnapshot({ noKeys }).diagnostics).toContainEqual({
      path: ['noKeys'],
      reason: 'read-failed',
      cause: keysFailure
    })
    /** Failure from the descriptor trap for one key. */
    const descriptorFailure = new Error('descriptor failed')
    const noDescriptor = new Proxy(
      { key: 1 },
      {
        getOwnPropertyDescriptor() {
          throw descriptorFailure
        }
      }
    )
    expect(diagnosticSnapshot({ noDescriptor }).diagnostics).toContainEqual({
      path: ['noDescriptor', 'key'],
      reason: 'read-failed',
      cause: descriptorFailure
    })
  })

  it('records read-failed when the prototype cannot be read', () => {
    /** Failure from the getPrototypeOf trap. */
    const prototypeFailure = new Error('prototype failed')
    const noPrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw prototypeFailure
        }
      }
    )
    expect(diagnosticSnapshot({ noPrototype }).diagnostics).toContainEqual({
      path: ['noPrototype'],
      reason: 'read-failed',
      cause: prototypeFailure
    })
  })
})

describe('collector oneOf zero handling', () => {
  it('distinguishes +0 and -0 with Object.is', () => {
    const source = [{ value: 0 }, { value: -0 }, { value: 1 }]
    expect(collect(source).fieldBy('value').oneOf(-0).result).toEqual([source[1]])
    expect(collect(source).fieldBy('value').oneOf(0, 1).result).toEqual([source[0], source[2]])
  })
})

describe('scheduling admission failures', () => {
  it('retires a queued task when the abort listener cannot be added', async () => {
    /** Failure from the signal's listener registration. */
    const listenerFailure = new Error('addEventListener failed')
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener() {
        throw listenerFailure
      },
      removeEventListener() {}
    } as unknown as AbortSignal
    const run = vi.fn()
    await expect(asyncTask('timeout', run, { signal })).rejects.toBe(listenerFailure)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(run).not.toHaveBeenCalled()
  })

  it('lets coalesce and throttle schedule again after an unsupported frame strategy', () => {
    const batched = coalesce(() => {}, 'animationFrame')
    expect(() => batched()).toThrowError(expect.objectContaining({ code: 'ENV_UNSUPPORTED' }))
    expect(() => batched()).toThrowError(expect.objectContaining({ code: 'ENV_UNSUPPORTED' }))
    const framed = throttle(() => {}, 'animationFrame')
    expect(() => framed()).toThrowError(expect.objectContaining({ code: 'ENV_UNSUPPORTED' }))
    expect(() => framed()).toThrowError(expect.objectContaining({ code: 'ENV_UNSUPPORTED' }))
  })
})

describe('hasErrorIdentity', () => {
  it('accepts only own string source and code data properties', () => {
    expect(hasErrorIdentity(Object.assign(new Error('x'), { source: 'a', code: 'B' }))).toBe(true)
    expect(hasErrorIdentity({ source: 'a', code: 'B' })).toBe(true)
    expect(hasErrorIdentity(Object.assign(new Error('x'), { code: 'B' }))).toBe(false)
    expect(hasErrorIdentity(Object.assign(new Error('x'), { source: 'a', code: 1 }))).toBe(false)
    const accessor = Object.defineProperty(new Error('x'), 'source', { get: () => 'a' })
    Object.defineProperty(accessor, 'code', { value: 'B' })
    expect(hasErrorIdentity(accessor)).toBe(false)
    expect(hasErrorIdentity('text')).toBe(false)
    expect(hasErrorIdentity(null)).toBe(false)
  })
})

