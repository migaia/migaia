import { describe, expect, expectTypeOf, it } from 'vitest'
import { collect, type ICollector, type IFieldCollector } from '../src/collector.js'

type IUser = {
  readonly id: number
  readonly group?: string
  readonly profile?: {
    readonly 'name-zh'?: string
    readonly 'name-en'?: string
    readonly rank?: number
  }
}

/** Shared identities prove that filtering never projects or clones source items. */
const users: readonly IUser[] = [
  { id: 1, group: 'a', profile: { 'name-zh': '世界', 'name-en': 'Hello World', rank: 1 } },
  { id: 2, group: 'a', profile: { 'name-en': 'Ada', rank: 2 } },
  { id: 3, group: 'b', profile: { 'name-zh': undefined, rank: 2 } },
  { id: 4 }
]

describe('collector public contract', () => {
  it('borrows the readonly source and preserves its reference when no source is rejected', () => {
    expect(collect(users).result).toBe(users)
    expect(collect(users).where(() => true).result).toBe(users)
  })

  it('makes fieldBy an effective defined-field filter and preserves source identity', () => {
    const result = collect(users).fieldBy('profile.name-zh', 'profile.name-en').result

    expect(result).toEqual([users[0], users[1]])
    expect(result[0]).toBe(users[0])
    expect(result[1]).toBe(users[1])
  })

  it('supports hyphenated and tuple paths while collapsing missing, blocked, and undefined', () => {
    const blocked = { id: 2, profile: null }
    const missing = { id: 3 }
    const explicitUndefined = { id: 4, profile: { 'name-zh': undefined } }
    const source = [users[0], blocked, missing, explicitUndefined] as const

    expect(collect(source).fieldBy('profile.name-zh' as never).result).toEqual([users[0]])
    expect(collect(source).fieldBy(['profile', 'name-zh'] as never).result).toEqual([users[0]])
  })

  it('matches strings case-insensitively across fields and ignores non-string values', () => {
    const result = collect(users)
      .fieldBy('profile.name-zh', 'profile.name-en', 'profile.rank')
      .like('  WORLD  ').result

    expect(result).toEqual([users[0]])
  })

  it('treats a trimmed empty like query as a cache-preserving no-op', () => {
    const collector = collect(users).fieldBy('profile.name-en')
    const before = collector.result

    expect(collector.like(' \n\t ').result).toBe(before)
  })

  it('applies equals and oneOf with field OR and action AND semantics', () => {
    expect(
      collect(users).fieldBy('profile.name-zh', 'profile.name-en').equals('Ada').result
    ).toEqual([users[1]])
    expect(
      collect(users)
        .fieldBy('profile.name-zh', 'profile.name-en')
        .oneOf('世界', 'Ada')
        .where((source) => source.id > 1).result
    ).toEqual([users[1]])
  })

  it('fuses adjacent field predicates without conflating field presence and undefined equality', () => {
    const source = [
      { first: undefined, second: 'defined' },
      { first: undefined, second: undefined }
    ] as const

    expect(collect(source).fieldBy('first', 'second').equals(undefined).result).toEqual([source[0]])
    expect(
      collect(source)
        .where(() => true)
        .fieldBy('first', 'second')
        .oneOf(undefined).result
    ).toEqual([source[0]])
  })

  it('reads an adjacent fieldBy and like path only once per source', () => {
    let reads = 0
    const source = [
      {
        get profile() {
          reads++
          return { name: 'World' }
        }
      }
    ]

    expect(collect(source).fieldBy('profile.name').like('world').result).toBe(source)
    expect(reads).toBe(1)
  })

  it('replaces the active field scope while retaining every prior field filter stage', () => {
    const result = collect(users)
      .fieldBy('profile.name-en')
      .fieldBy('profile.rank')
      .equals(2).result

    expect(result).toEqual([users[1]])
  })

  it('preserves ordered take, skip, and where semantics', () => {
    const source = [1, 2, 3, 4] as const

    expect(
      collect(source)
        .take(2)
        .where((value) => value % 2 === 0).result
    ).toEqual([2])
    expect(
      collect(source)
        .where((value) => value % 2 === 0)
        .take(2).result
    ).toEqual([2, 4])
    expect(collect(source).skip(1).take(2).result).toEqual([2, 3])
  })

  it('deduplicates defined keys while preserving every undefined or missing key', () => {
    const firstMissing = { value: 'first missing' }
    const secondMissing = { value: 'second missing' }
    const source = [
      { key: 'a', value: 1 },
      { key: 'a', value: 2 },
      firstMissing,
      { key: undefined, value: 'explicit undefined' },
      secondMissing
    ] as const

    expect(collect(source).distinctBy('key').result).toEqual([
      source[0],
      firstMissing,
      source[3],
      secondMissing
    ])
  })

  it('caches one revision and leaves its previous materialized snapshot stable', () => {
    const collector = collect([1, 2, 3, 4] as const).where((value) => value > 1)
    const first = collector.result

    expect(collector.result).toBe(first)
    collector.take(1)
    const second = collector.result

    expect(second).toEqual([2])
    expect(second).not.toBe(first)
    expect(first).toEqual([2, 3, 4])
    expect(collector.result).toBe(second)
  })

  it('propagates exact getter and Proxy failures without caching them', () => {
    const getterFailure = new Error('getter failed')
    let getterReads = 0
    const source = [
      {
        get profile() {
          getterReads++
          throw getterFailure
        }
      }
    ]
    const collector = collect(source).fieldBy('profile.name' as never)

    expect(() => collector.result).toThrow(getterFailure)
    expect(() => collector.result).toThrow(getterFailure)
    expect(getterReads).toBe(2)

    const proxyFailure = new Error('has failed')
    const hostile = new Proxy(
      {},
      {
        has: () => {
          throw proxyFailure
        }
      }
    )
    expect(() => collect([hostile]).fieldBy('name' as never).result).toThrow(proxyFailure)
  })

  it('rejects result reads and mutations re-entered by a predicate', () => {
    let reading!: ICollector<number>
    reading = collect([1]).where(() => {
      void reading.result
      return true
    })

    expect(() => reading.result).toThrowError(
      expect.objectContaining({ code: 'REENTRANT_CALL', source: '@migaia/utils' })
    )

    let mutating!: ICollector<number>
    mutating = collect([1]).where(() => {
      mutating.take(1)
      return true
    })
    expect(() => mutating.result).toThrowError(
      expect.objectContaining({ code: 'REENTRANT_CALL', source: '@migaia/utils' })
    )
  })

  it('rejects invalid source and window sizes with native coded errors', () => {
    expect(() => collect(null as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT', source: '@migaia/utils' })
    )
    for (const count of [-1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => collect(users).skip(count)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT', source: '@migaia/utils' })
      )
      expect(() => collect(users).take(count)).toThrow(RangeError)
    }
  })

  it('guards required typestate and path inputs for JavaScript callers', () => {
    const unsafe = collect(users) as unknown as {
      fieldBy(...paths: unknown[]): unknown
      like(query: string): unknown
      equals(value?: unknown): unknown
      oneOf(...values: unknown[]): unknown
      distinctBy(path?: unknown): unknown
    }

    for (const run of [
      () => unsafe.fieldBy(),
      () => unsafe.like(''),
      () => unsafe.equals(),
      () => unsafe.oneOf(),
      () => unsafe.distinctBy(),
      () => unsafe.distinctBy(null)
    ])
      expect(run).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT', source: '@migaia/utils' })
      )
  })
})

it('exposes field predicates only after fieldBy and preserves their inferred value type', () => {
  const collector = collect(users)
  expectTypeOf(collector).toMatchTypeOf<ICollector<IUser>>()
  expectTypeOf<'like'>().not.toMatchTypeOf<keyof typeof collector>()

  const fieldCollector = collector.fieldBy('profile.name-en')
  expectTypeOf(fieldCollector).toMatchTypeOf<IFieldCollector<IUser, 'profile.name-en'>>()
  expectTypeOf<'like'>().toMatchTypeOf<keyof typeof fieldCollector>()
  fieldCollector.equals('Ada')
  expectTypeOf<number>().not.toMatchTypeOf<Parameters<typeof fieldCollector.equals>[0]>()
})
