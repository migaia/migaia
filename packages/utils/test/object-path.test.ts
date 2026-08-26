import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  createPathAccessor,
  get,
  parseObjectPath,
  probeObjectPath,
  set,
  type IObjectPath,
  type IObjectPathTupleFor,
  type IObjectPathWriteValue
} from '../src/object.js'

type IFixture = {
  readonly user: {
    readonly name: string
    readonly age: number
    readonly addresses: readonly { readonly city: string }[]
    readonly optional?: { readonly enabled: boolean }
  }
}

const fixture: IFixture = {
  user: { name: 'Ada', age: 36, addresses: [{ city: 'London' }] }
}

describe('object path primitives', () => {
  it('parses strict string paths and snapshots tuple paths', () => {
    expect(parseObjectPath('user.addresses.[0].city')).toEqual(['user', 'addresses', 0, 'city'])
    const tuple = ['user', 'name'] as const
    const parsed = parseObjectPath(tuple)
    expect(parsed).toEqual(tuple)
    expect(parsed).not.toBe(tuple)
    expect(Object.isFrozen(parsed)).toBe(true)
    for (const invalid of ['', 'user..name', 'user[0]', 'user.__proto__.name', 'user.[-1]']) {
      expect(() => parseObjectPath(invalid)).toThrowError(
        expect.objectContaining({ code: 'OBJECT_PATH_INVALID', source: '@migaia/utils' })
      )
    }
  })

  it('infers string and tuple values while distinguishing present undefined', () => {
    const name = get(fixture, 'user.name')
    const city = get(fixture, ['user', 'addresses', 0, 'city'] as const)
    expectTypeOf(name).toEqualTypeOf<string | undefined>()
    expectTypeOf(city).toEqualTypeOf<string | undefined>()
    expectTypeOf<'user.addresses.[0].city'>().toMatchTypeOf<IObjectPath<IFixture>>()
    expectTypeOf<'user.unknown'>().not.toMatchTypeOf<IObjectPath<IFixture>>()
    expectTypeOf<readonly ['user', 'addresses', 0, 'city']>().toMatchTypeOf<
      IObjectPathTupleFor<IFixture>
    >()
    expectTypeOf<readonly ['user', 'unknown']>().not.toMatchTypeOf<IObjectPathTupleFor<IFixture>>()
    expectTypeOf<IObjectPathWriteValue<IFixture, 'user.age'>>().toEqualTypeOf<number>()
    expect(name).toBe('Ada')
    expect(city).toBe('London')
    const value = { present: undefined as string | undefined }
    expect(probeObjectPath(value, 'present')).toMatchObject({ kind: 'value', value: undefined })
    expect(probeObjectPath(value, ['missing'] as never)).toMatchObject({
      kind: 'missing',
      failedAt: 0,
      failedKey: 'missing'
    })
  })

  it('reports the first blocked segment and hostile proxy/getter failures', () => {
    expect(probeObjectPath({ a: null }, 'a.b' as never)).toMatchObject({
      kind: 'blocked',
      failedAt: 1,
      failedKey: 'b',
      resolvedPath: ['a'],
      parent: null
    })
    const cause = new Error('hostile getter')
    const hostile = Object.defineProperty({}, 'value', {
      get: () => {
        throw cause
      }
    })
    expect(probeObjectPath(hostile, ['value'] as never)).toMatchObject({
      kind: 'failed',
      failedAt: 0,
      error: cause
    })
    expect(() => get(hostile, ['value'] as never)).toThrow(cause)
  })

  it('sets immutably with structural sharing and creates missing arrays/records', () => {
    const updated = set(fixture, 'user.addresses.[0].city', 'Paris')
    expect(updated).not.toBe(fixture)
    expect(updated.user).not.toBe(fixture.user)
    expect(updated.user.addresses).not.toBe(fixture.user.addresses)
    expect(updated.user.addresses[0].city).toBe('Paris')
    expect(fixture.user.addresses[0].city).toBe('London')
    expect(set(fixture, 'user.name', 'Ada')).toBe(fixture)
    const frozen = Object.freeze({ nested: Object.freeze({ value: 1 }) })
    expect(set(frozen, 'nested.value', 2)).toEqual({ nested: { value: 2 } })
    const withOptional = set(fixture, ['user', 'optional', 'enabled'] as const, true)
    expect(withOptional.user.optional).toEqual({ enabled: true })
    expect(() => set({ a: 1 }, ['a', 'b'] as never, 2 as never)).toThrowError(
      expect.objectContaining({ code: 'OBJECT_PATH_INVALID' })
    )
    expect(() => set({ a: null }, ['a', 'b'] as never, 2 as never)).toThrowError(
      expect.objectContaining({ code: 'OBJECT_PATH_INVALID' })
    )
    expect(() => set({ a: new Date(0) }, ['a', 'label'] as never, 'x' as never)).toThrowError(
      expect.objectContaining({ code: 'OBJECT_PATH_INVALID' })
    )
  })

  it('runs correlated get/set transforms and advances the accessor root', () => {
    const failures: string[] = []
    const accessor = createPathAccessor(fixture, {
      ifMissing: (probe) => failures.push(`${probe.kind}:${String(probe.failedKey)}`),
      onGet: (event) => {
        if (event.originKey === 'user.name') {
          expectTypeOf(event.value).toEqualTypeOf<string>()
          event.replace(event.value.toUpperCase())
        }
      },
      onSet: (event) => {
        if (event.originKey === 'user.age') {
          expectTypeOf(event.value).toEqualTypeOf<number>()
          event.replace(Math.max(0, event.value))
        }
      }
    })
    expect(accessor.get('user.name')).toBe('ADA')
    const next = accessor.set('user.age', -1)
    expect(next.user.age).toBe(0)
    expect(accessor.value).toBe(next)
    expect(accessor.get(['user', 'optional', 'enabled'] as const)).toBeUndefined()
    expect(failures).toEqual(['missing:optional'])
  })

  it('keeps the accessor root atomic across blocked, failed, and hook failures', () => {
    const cause = new Error('hostile')
    const root = {
      blocked: null,
      get failed(): never {
        throw cause
      },
      value: 1
    }
    const observed: string[] = []
    const accessor = createPathAccessor(root, {
      ifBlocked: () => observed.push('blocked'),
      ifFailed: () => observed.push('failed'),
      onSet: () => {
        throw cause
      }
    })
    expect(() => accessor.get(['failed'] as never)).toThrow(cause)
    expect(() => accessor.set(['blocked', 'value'] as never, 2 as never)).toThrowError(
      expect.objectContaining({ code: 'OBJECT_PATH_INVALID' })
    )
    expect(() => accessor.set('value', 2)).toThrow(cause)
    expect(accessor.value).toBe(root)
    expect(observed).toEqual(['failed', 'blocked'])
  })
})
