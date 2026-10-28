import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  MICRO_HUB_SOURCE,
  MicroHubErrorCode,
  MicroResourceStatus,
  createMicroHubError,
  createMicroHubTypeError,
  defineContract,
  event,
  keyed,
  request,
  resource,
  type IContractView,
  type IOwnedContract
} from '../src/index.ts'

describe('contract definitions', () => {
  it('copies and freezes contract sections and writer permissions', () => {
    /** Mutable caller-owned definitions must not mutate the published contract. */
    const spec = {
      version: 2,
      state: { count: 0 },
      computed: { doubled: (state: { readonly count: number }) => state.count * 2 },
      commands: {
        add: (state: { readonly count: number }, amount: number) => ({
          count: state.count + amount
        })
      },
      writers: ['shell'],
      events: { changed: event<number>() },
      requests: { query: request<string, number>() },
      resources: { profile: resource<{ name: string }>() }
    }
    /** Contract shared by independently loaded applications. */
    const contract = defineContract('counter', spec)
    spec.state.count = 9
    spec.writers.push('outsider')
    expect(contract.name).toBe('counter')
    expect(contract.version).toBe(2)
    expect(contract.state.count).toBe(0)
    expect(contract.writers).toEqual(['shell'])
    expect(Object.isFrozen(contract)).toBe(true)
    for (const section of [
      'state',
      'computed',
      'commands',
      'writers',
      'events',
      'requests',
      'resources'
    ] as const) {
      expect(Object.isFrozen(contract[section])).toBe(true)
    }
  })

  it('provides frozen empty sections and immutable markers', () => {
    /** Empty contracts can be used with no capabilities installed. */
    const contract = defineContract('empty', { version: 1 })
    for (const section of [
      'state',
      'computed',
      'commands',
      'events',
      'requests',
      'resources'
    ] as const) {
      expect(contract[section]).toEqual({})
      expect(Object.isFrozen(contract[section])).toBe(true)
    }
    expect(contract.writers).toEqual([])
    for (const marker of [event(), request(), keyed(), resource()]) {
      expect(Object.isFrozen(marker)).toBe(true)
    }
    expect(MicroResourceStatus).toEqual({
      idle: 'idle',
      pending: 'pending',
      success: 'success',
      error: 'error',
      cancelled: 'cancelled'
    })
  })

  it.each(['', 'cart.v2', null, 3])('rejects invalid contract name %s', (name) => {
    expect(() => defineContract(name as string, { version: 1 })).toThrowError(
      expect.objectContaining({
        name: 'TypeError',
        source: MICRO_HUB_SOURCE,
        code: 'INVALID_OPTION'
      })
    )
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid version %s',
    (version) => {
      expect(() => defineContract('cart', { version })).toThrowError(
        expect.objectContaining({ name: 'TypeError', code: 'INVALID_OPTION' })
      )
    }
  )

  it.each(['', 'app.name'])('rejects invalid writer name %s', (writer) => {
    expect(() => defineContract('cart', { version: 1, writers: [writer] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
  })

  it.each([
    { state: null },
    { computed: 1 },
    { commands: 'add' },
    { events: false },
    { requests: null },
    { resources: 1 },
    { state: { wrong: event() } },
    { state: { wrong: request() } },
    { state: { wrong: resource() } },
    { computed: { wrong: null } },
    { commands: { wrong: 1 } },
    { events: { wrong: request() } },
    { requests: { wrong: event() } },
    { resources: { wrong: keyed() } }
  ])('rejects malformed sections: %j', (section) => {
    expect(() => defineContract('invalid', { version: 1, ...section } as never)).toThrowError(
      expect.objectContaining({
        name: 'TypeError',
        source: MICRO_HUB_SOURCE,
        code: 'INVALID_OPTION'
      })
    )
  })

  it('infers state, keyed entities, computed values, commands, events, requests and resources', () => {
    /** Public types inferred from one shared contract definition. */
    const contract = defineContract('typed', {
      version: 1,
      state: { count: 0, entries: keyed<{ label: string }>() },
      computed: { doubled: (state) => state.count * 2 },
      commands: { add: (state, amount: number) => ({ count: state.count + amount }) },
      events: { changed: event<number>() },
      requests: { query: request<string, number>() },
      resources: { profile: resource<{ name: string }>() }
    })
    expectTypeOf<
      IContractView<typeof contract>['state']['count']['get']
    >().returns.toEqualTypeOf<number>()
    expectTypeOf<IContractView<typeof contract>['state']['entries']['at']>().returns.toEqualTypeOf<{
      get(): { label: string } | undefined
      subscribe(listener: () => void): () => void
    }>()
    expectTypeOf<
      IContractView<typeof contract>['computed']['doubled']['get']
    >().returns.toEqualTypeOf<number>()
    expectTypeOf<IContractView<typeof contract>['commands']['add']>().parameters.toEqualTypeOf<
      [amount: number]
    >()
    expectTypeOf<IContractView<typeof contract>['requests']['query']>().returns.toEqualTypeOf<
      Promise<number>
    >()
    expectTypeOf<
      IOwnedContract<typeof contract>['events']['changed']['emit']
    >().parameters.toEqualTypeOf<[payload: number]>()
    expectTypeOf<
      IContractView<typeof contract>['resources']['profile']['read']
    >().returns.toEqualTypeOf<Promise<{ name: string }>>()
  })
})

describe('public error identity', () => {
  it.each(Object.values(MicroHubErrorCode))(
    'tags %s without replacing the native Error',
    (code) => {
      /** Original failure retained on the native cause chain. */
      const cause = new Error('original')
      /** Error factories attach the public identity to the original native instance. */
      const error = createMicroHubError(code, 'operation failed', { cause })
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({
        source: MICRO_HUB_SOURCE,
        code,
        message: 'operation failed',
        cause
      })
      expect(error.cause).toBe(cause)
      expect(error.stack).toBeTruthy()
      expect(cause.stack).toBeTruthy()
    }
  )

  it('preserves native TypeError and distinguishes absent and explicit undefined cause', () => {
    /** Invalid input keeps its native error type for caller branching. */
    const plain = createMicroHubTypeError(MicroHubErrorCode.invalidOption, 'invalid')
    /** Explicit options without a cause must not add a cause property. */
    const empty = createMicroHubError(MicroHubErrorCode.invalidOption, 'invalid', {})
    /** An explicitly undefined cause still follows native ErrorOptions semantics. */
    const explicit = createMicroHubTypeError(MicroHubErrorCode.invalidOption, 'invalid', {
      cause: undefined
    })
    expect(plain).toBeInstanceOf(TypeError)
    expect(Object.hasOwn(plain, 'cause')).toBe(false)
    expect(Object.hasOwn(empty, 'cause')).toBe(false)
    expect(Object.hasOwn(explicit, 'cause')).toBe(true)
  })
})
