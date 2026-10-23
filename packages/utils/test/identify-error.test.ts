import { describe, expect, expectTypeOf, it } from 'vitest'
import { attachErrorIdentity, IdentifyError, type IIdentifiedError } from '../src/error.js'

describe('IdentifyError', () => {
  it('wraps a native error without replacing its type, stack or cause', () => {
    /** Original failure whose identity and stack must survive wrapping. */
    const original = new RangeError('too big')
    /** Wrapped error carrying a semantic identity. */
    const error = IdentifyError.from(original, { source: '@app/x', code: 'TOO_BIG' })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('IdentifyError')
    expect(error.message).toBe('too big')
    expect(error.cause).toBe(original)
    expect(error.native()).toBe(original)
    expect(original.stack).toContain('too big')
    expect(error.stack).toBeTypeOf('string')
    expectTypeOf(error.code).toEqualTypeOf<'TOO_BIG'>()
    expectTypeOf(error.source).toEqualTypeOf<'@app/x'>()
  })

  it('returns the same instance when wrapping an error that already has the identity', () => {
    /** First wrap. */
    const first = IdentifyError.from(new Error('x'), { source: '@app/x', code: 'A' })
    expect(IdentifyError.from(first, { source: '@app/x', code: 'A' })).toBe(first)
    /** Different identity wraps again, keeping the native root reachable. */
    const second = IdentifyError.from(first, { source: '@app/y', code: 'B' })
    expect(second).not.toBe(first)
    expect(second.cause).toBe(first)
    expect(second.native()).toBe(first.native())
  })

  it('converts non-error causes into a NON_ERROR_VALUE native and keeps the raw value', () => {
    /** Wrapped string throw. */
    const error = IdentifyError.from('boom', { source: '@app/x', code: 'RAW' })
    expect(error.cause).toBe('boom')
    expect(error.native()).toMatchObject({ code: 'NON_ERROR_VALUE', cause: 'boom' })
    expect(new IdentifyError({ source: 's', code: 'C' }).native()).toBeInstanceOf(IdentifyError)
  })

  it('attaches identity as readonly own properties and freezes methods', () => {
    /** Instance whose identity must not be writable. */
    const error = new IdentifyError({ source: 's', code: 'C', phase: 'open', detail: { id: 1 } })
    expect(Object.getOwnPropertyDescriptor(error, 'code')).toMatchObject({
      writable: false,
      configurable: false,
      value: 'C'
    })
    expect(() => {
      ;(error as { code: string }).code = 'X'
    }).toThrow(TypeError)
    expect(() => {
      ;(error as unknown as { equal: unknown }).equal = () => true
    }).toThrow(TypeError)
    expect(Object.isFrozen(IdentifyError.prototype)).toBe(true)
    expect(Object.isFrozen(error.detail)).toBe(true)
    expect(error.identity()).toEqual({ source: 's', code: 'C', phase: 'open', detail: { id: 1 } })
  })

  it('rejects invalid identities with INVALID_ARGUMENT TypeErrors', () => {
    for (const identity of [
      { source: '', code: 'C' },
      { source: 's', code: 1 },
      { source: 's', code: 'C', phase: 2 },
      { source: 's', code: 'C', detail: [] }
    ])
      expect(() => new IdentifyError(identity as never)).toThrowError(
        expect.objectContaining({
          name: 'TypeError',
          code: 'INVALID_ARGUMENT',
          source: 'foundation.utils'
        })
      )
  })

  it('brands instances so spoofed shapes fail is()', () => {
    /** Real instance. */
    const error = new IdentifyError({ source: 's', code: 'C' })
    expect(IdentifyError.is(error)).toBe(true)
    expect(IdentifyError.is(error, { code: 'C' })).toBe(true)
    expect(IdentifyError.is(error, { code: 'D' })).toBe(false)
    expect(IdentifyError.is(Object.create(IdentifyError.prototype))).toBe(false)
    expect(IdentifyError.is({ source: 's', code: 'C' })).toBe(false)
  })

  it('defines package factories with narrowing helpers', () => {
    /** Package-scoped factory. */
    const OrderError = IdentifyError.define('@app/orders', {
      notFound: 'NOT_FOUND',
      conflict: 'CONFLICT'
    })
    /** Cause carried by the factory error. */
    const cause = new Error('missing row')
    /** Factory-built error. */
    const error = OrderError.notFound({ cause, detail: { id: 7 } })
    expectTypeOf(error).toEqualTypeOf<IdentifyError<'@app/orders', 'NOT_FOUND'>>()
    expect(error).toMatchObject({ source: '@app/orders', code: 'NOT_FOUND', detail: { id: 7 } })
    expect(error.cause).toBe(cause)
    expect(OrderError.is(error, 'notFound')).toBe(true)
    expect(OrderError.is(error, 'conflict')).toBe(false)
    expect(OrderError.is(error, 'missing' as never)).toBe(false)
    expect(OrderError.find(new Error('outer', { cause: error }), 'notFound')).toBe(error)
    expect(OrderError.codes).toEqual({ notFound: 'NOT_FOUND', conflict: 'CONFLICT' })
    expect(() => IdentifyError.define('@app/x', { is: 'IS' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('asserts conditions and wraps sync and async failures', async () => {
    /** Identity used by the assertion and wrappers. */
    const identity = { source: '@app/x', code: 'FAIL' } as const
    expect(() => IdentifyError.assert(0, identity, 'nope')).toThrowError(
      expect.objectContaining({ code: 'FAIL', message: 'nope' })
    )
    expect(() => IdentifyError.assert(1, identity)).not.toThrow()
    /** Synchronous failure source. */
    const syncError = new Error('sync')
    /** Wrapped sync thrower. */
    const syncFn = IdentifyError.wrap((value: number) => {
      if (value > 0) throw syncError
      return value
    }, identity)
    expect(syncFn(0)).toBe(0)
    expect(() => syncFn(1)).toThrowError(
      expect.objectContaining({ code: 'FAIL', cause: syncError })
    )
    /** Asynchronous failure source. */
    const asyncError = new Error('async')
    /** Wrapped async rejection. */
    const asyncFn = IdentifyError.wrap(async () => {
      throw asyncError
    }, identity)
    await expect(asyncFn()).rejects.toMatchObject({ code: 'FAIL', cause: asyncError })
  })

  it('finds, matches and tests identities through cause and AggregateError chains', () => {
    /** Coded native error that is not an IdentifyError. */
    const coded = attachErrorIdentity(new TypeError('bad'), { source: '@lib/a', code: 'BAD' })
    /** Aggregate wrapping the coded error. */
    const aggregate = new AggregateError([new Error('first'), coded], 'many')
    /** Top-level error whose chain contains both. */
    const top = new IdentifyError({ source: '@app/x', code: 'TOP' }, { cause: aggregate })
    /** Found link, typed as an identified error. */
    const found = IdentifyError.find(top, { source: '@lib/a', code: 'BAD' })
    expectTypeOf(found).toEqualTypeOf<IIdentifiedError<'@lib/a', 'BAD'> | undefined>()
    expect(found).toBe(coded)
    expect(top.has({ code: 'BAD' })).toBe(true)
    expect(top.has({ code: 'NONE' })).toBe(false)
    expect(top.causes()).toContain(coded)
    expect(IdentifyError.match(top, { BAD: (error) => error.message, _: () => 'other' })).toBe(
      'bad'
    )
    // A source filter skips links from other packages; without a fallback the original rethrows.
    expect(() => IdentifyError.match(top, { BAD: () => 'lib' }, { source: '@app/x' })).toThrow(top)
    expect(IdentifyError.match(top, { TOP: () => 'top' }, { source: '@app/x' })).toBe('top')
  })

  it('rethrows unmatched errors when match has no fallback', () => {
    /** Original value that must be rethrown by identity. */
    const original = new Error('plain')
    expect(() => IdentifyError.match(original, { X: () => 1 })).toThrow(original)
    expect(IdentifyError.match(original, { toString: () => 2, _: () => 3 })).toBe(3)
  })

  it('compares, clones and derives without mutating the source instance', () => {
    /** Base error. */
    const base = new IdentifyError(
      { source: 's', code: 'C', phase: 'run', detail: { a: 1 } },
      { cause: new Error('root') }
    )
    expect(base.equal({ source: 's', code: 'C', phase: 'run' })).toBe(true)
    expect(base.equal(new IdentifyError({ source: 's', code: 'C' }))).toBe(false)
    expect(base.compare(base.withDetail({ b: 2 }))).toEqual({
      source: true,
      code: true,
      phase: true,
      detail: false
    })
    /** Clone shares message and native root. */
    const clone = base.clone()
    expect(clone).not.toBe(base)
    expect(clone.native()).toBe(base.native())
    expect(clone.equal(base)).toBe(true)
    /** Mutable draft is detached from the instance. */
    const draft = base.mutable()
    draft.code = 'D'
    draft.detail!.a = 2
    expect(base.code).toBe('C')
    expect(base.detail).toEqual({ a: 1 })
    expect(IdentifyError.from(base.native(), draft).code).toBe('D')
    expect(base.withPhase('close').phase).toBe('close')
    expect(base.phase).toBe('run')
  })

  it('never throws when reading hostile values', () => {
    /** Proxy whose every getter throws. */
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        }
      }
    )
    /** Instance compared against hostile values. */
    const error = new IdentifyError({ source: 's', code: 'C' })
    expect(IdentifyError.identityOf(hostile)).toBeUndefined()
    expect(error.equal(hostile)).toBe(false)
    expect(error.compare(null)).toEqual({ source: false, code: false, phase: false, detail: false })
  })

  it('combines and attaches secondary failures with the primary first', () => {
    /** Primary failure. */
    const primary = new IdentifyError({ source: 's', code: 'PRIMARY' })
    /** Secondary rollback failure. */
    const rollback = new Error('rollback')
    /** Combined error. */
    const combined = primary.combine(rollback)
    expect((combined as unknown as { errors: unknown[] }).errors).toEqual([primary, rollback])
    expect(combined.cause).toBe(primary)
    expect(combined.has({ code: 'PRIMARY' })).toBe(true)
    /** Additional cleanup failure appended in place. */
    const cleanup = new Error('cleanup')
    expect(primary.attachSecondary(cleanup)).toBe(primary)
    expect((primary as unknown as { errors: unknown[] }).errors).toEqual([cleanup])
    /** Frozen instances cannot accept secondaries; the aggregate fallback is thrown. */
    const frozen = Object.freeze(new IdentifyError({ source: 's', code: 'F' }))
    expect(() => frozen.attachSecondary(cleanup)).toThrow(AggregateError)
  })

  it('serializes the chain and formats a readable string', () => {
    /** Error with a native cause. */
    const error = new IdentifyError(
      { source: '@app/x', code: 'SER' },
      { message: 'serialize me', cause: new TypeError('inner') }
    )
    expect(String(error)).toBe('[@app/x:SER] serialize me')
    /** Restored error from JSON text. */
    const restored = IdentifyError.deserialize(JSON.parse(JSON.stringify(error)))
    expect(restored).toMatchObject({ source: '@app/x', code: 'SER', message: 'serialize me' })
    expect((restored.cause as Error).message).toBe('inner')
  })
})
