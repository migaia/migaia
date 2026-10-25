import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { ConcurrencyPolicy, lockKey, runWithConcurrency } from '../src/authoring/concurrency.js'
import {
  createTransactionBuilder,
  createTransactionOwner,
  resolveConcurrencyPolicy
} from '../src/authoring/transaction.js'
import {
  type IStorageBase,
  type ITransactionOptions,
  type ILockedTransactionBuilder,
  type IOptimisticTransactionBuilder
} from '@migaia/storage-contract'

/** A store with native scope/options proves delegation rather than implementing a second executor. */
function fixture() {
  /** The terminal receives the actual native extension instead of a narrowed record scope. */
  const nativeScope = { read: () => 1, sql: (query: 'native') => query }
  /** Calls capture the original callback, receiver and complete option record. */
  const calls: { receiver: unknown; run: unknown; options: unknown; promise: unknown }[] = []
  /** Private backend options remain part of the actual transaction's public parameter domain. */
  type IOptions = ITransactionOptions & { readonly nativeTag?: { readonly value: string } }
  const store = {
    backend: 'builder-fixture',
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: true,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      opaqueEntries: false,
      maxValueBytes: undefined
    },
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
    transaction<TResult>(
      run: (scope: typeof nativeScope) => TResult,
      options?: IOptions
    ): Promise<Awaited<TResult>> {
      const promise = Promise.resolve(run(nativeScope))
      calls.push({ receiver: this, run, options, promise })
      return promise
    }
  } satisfies IStorageBase & { transaction: (...args: never[]) => Promise<unknown> }
  createTransactionOwner(store, (error) =>
    Object.assign(new Error('fixture failed', { cause: error }), {
      source: 'builder-fixture',
      code: 'TRANSACTION_FAILED'
    })
  )
  return { store, calls, scope: nativeScope }
}

describe('immutable transaction builder', () => {
  it('delegates native unlocked run with exact scope, options, original Promise', async () => {
    const { store, calls, scope } = fixture()
    const nativeTag = { value: 'native' }
    const policy = ConcurrencyPolicy.optimistic({ retries: 1 })
    const hint = () => 'kept' as const
    const root = createTransactionBuilder(
      store,
      {
        nativeTag: nativeTag
      },
      { hint },
      {
        mode: 'optimistic' as const
      }
    )
    expect(root.hint).toBe(hint)
    expect('lock' in root).toBe(false)
    expect('run' in root).toBe(true)
    expect(calls).toHaveLength(0)
    const run = (current: typeof scope) => {
      expectTypeOf(current).toEqualTypeOf<typeof scope>()
      return Promise.resolve(current.sql('native'))
    }
    const pending = root.concurrency(policy).timeout(1000).run(run)
    expect(pending).toBe(calls[0]!.promise)
    expect(await pending).toBe('native')
    expect(calls[0]!.receiver).toBe(store)
    expect(calls[0]!.run).toBe(run)
    expect(calls[0]!.options).toMatchObject({ nativeTag, concurrency: policy, timeoutMs: 1000 })
    expect(Object.hasOwn(calls[0]!.options as object, 'lock')).toBe(false)
    expect(root.hint()).toBe('kept')

    expectTypeOf(root).toMatchTypeOf<
      IOptimisticTransactionBuilder<typeof scope, { hint: typeof hint }>
    >()
  })

  it('rejects unsupported native locking policies and keys before the original transaction starts', () => {
    const { store, calls } = fixture()
    const mode = { mode: 'optimistic' } as const
    const root = createTransactionBuilder(store, undefined, undefined, mode)
    for (const policy of [ConcurrencyPolicy.wait(), ConcurrencyPolicy.fail()]) {
      expect(() => root.concurrency(policy as never)).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
      )
      expect(() =>
        createTransactionBuilder(store, { concurrency: policy } as never, undefined, mode)
      ).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' }))
    }
    expect(() => root.concurrency({ name: 'copy', locking: 'optimistic' } as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() =>
      createTransactionBuilder(store, { lock: [] } as never, undefined, mode)
    ).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' }))
    expect(() => root.run(undefined as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(calls).toHaveLength(0)
    function invalidTypes() {
      // @ts-expect-error Native unlocked builders have no key-lock transition.
      root.lock(lockKey.text('a'))
      // @ts-expect-error Native unlocked builders accept only optimistic policies.
      root.concurrency(ConcurrencyPolicy.wait())
      // @ts-expect-error Native author mode rejects explicit keys before native invocation.
      createTransactionBuilder(store, { lock: [] }, undefined, mode)
      // @ts-expect-error Backend-native option extensions stay precise in this mode.
      createTransactionBuilder(store, { nativeTag: 'wrong' }, undefined, mode)
    }
    void invalidTypes
  })

  it('uses the original optimistic loop and returns its native Promise without a second runner', async () => {
    const { store, scope } = fixture()
    const policy = ConcurrencyPolicy.optimistic({ retries: 1, backoffMs: 0 })
    let nativePromise: Promise<unknown> | undefined
    let attempts = 0
    store.transaction = <TResult>(
      run: (current: typeof scope) => TResult,
      options?: ITransactionOptions
    ): Promise<Awaited<TResult>> => {
      expect(Object.hasOwn(options!, 'lock')).toBe(false)
      const pending = runWithConcurrency<TResult>(
        { store, options: options ?? {}, policy },
        {
          attempt: async (context) => {
            expect(context.lock).toBeUndefined()
            attempts++
            return attempts === 1
              ? {
                  status: 'conflict' as const,
                  phase: 'commit' as const,
                  keys: [],
                  holder: undefined
                }
              : { status: 'committed' as const, value: run(scope) }
          }
        }
      )
      nativePromise = pending
      return pending
    }
    const pending = createTransactionBuilder(store, { concurrency: policy }, undefined, {
      mode: 'optimistic'
    }).run((current) => current.read())
    expect(pending).toBe(nativePromise)
    expect(await pending).toBe(1)
    expect(attempts).toBe(2)
  })

  it('has no root execution method and delegates once with the actual scope, native options and original Promise', async () => {
    const { store, calls } = fixture()
    const nativeTag = { value: 'kept' }
    const root = createTransactionBuilder(store, {
      nativeTag: nativeTag,
      pageSize: 5
    })
    expect('run' in root).toBe(false)
    expect(calls).toEqual([])

    const callback = (scope: { read: () => number; sql: (query: 'native') => 'native' }) => {
      expectTypeOf(scope.sql('native')).toEqualTypeOf<'native'>()
      return Promise.resolve(scope.read())
    }
    const pending = root
      .lock(lockKey.record('z'), lockKey.text('a'), lockKey.text('a'))
      .run(callback)
    expect(pending).toBe(calls[0]!.promise)
    expect(await pending).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.receiver).toBe(store)
    expect(calls[0]!.run).toBe(callback)
    expect(calls[0]!.options).toMatchObject({
      nativeTag,
      pageSize: 5,
      lock: [
        { channel: 'text', key: 'a' },
        { channel: 'record', key: 'z' }
      ]
    })
  })

  it('keeps branches independent, snapshots only new mutable identities and never starts I/O in configuration', async () => {
    const { store, calls } = fixture()
    const original = new Date(1)
    const base = createTransactionBuilder(store).lock(lockKey.record(original))
    const policy = ConcurrencyPolicy.fail()
    const controller = new AbortController()
    const first = base
      .lock(lockKey.text('first'))
      .concurrency(policy)
      .signal(controller.signal)
      .timeout(7)
    const second = base.lock(lockKey.text('second'))
    original.setTime(99)
    expect(calls).toEqual([])
    await first.run(() => true)
    await second.run(() => false)
    expect(calls[0]!.options).toMatchObject({
      concurrency: policy,
      signal: controller.signal,
      timeoutMs: 7,
      lock: [
        { channel: 'text', key: 'first' },
        { channel: 'record', key: new Date(1) }
      ]
    })
    expect(calls[1]!.options).toMatchObject({
      concurrency: undefined,
      signal: undefined,
      timeoutMs: undefined,
      lock: [
        { channel: 'text', key: 'second' },
        { channel: 'record', key: new Date(1) }
      ]
    })
    expectTypeOf(first).toExtend<
      ILockedTransactionBuilder<{ read: () => number; sql: (query: 'native') => 'native' }>
    >()
  })

  it('rejects bad configuration before calling the actual transaction', () => {
    const { store, calls } = fixture()
    const root = createTransactionBuilder(store)
    expect(() => root.timeout(-1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => root.signal({} as AbortSignal)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => root.concurrency({ name: 'forged', locking: 'pessimistic' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => root.lock({ channel: 'record', key: [] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY' })
    )
    expect(() => root.lock(lockKey.text('key')).run(undefined as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(calls).toEqual([])
    /** Compile-only failures must not execute unsupported builder operations. */
    function invalidTypes() {
      // @ts-expect-error An unlocked builder exposes no terminal.
      root.run(() => 1)
      // @ts-expect-error Native option fields retain their precise original type.
      createTransactionBuilder(store, { nativeTag: 'wrong' })
      // @ts-expect-error Native SQL parameters retain their exact domain.
      root.lock(lockKey.text('key')).run((scope) => scope.sql('wrong'))
    }
    void invalidTypes
  })

  it('unfolds a long immutable history without recursion and invokes the original transaction once', async () => {
    const { store, calls } = fixture()
    let builder = createTransactionBuilder(store).lock(lockKey.text('0'))
    for (let index = 1; index < 1000; index++) builder = builder.lock(lockKey.text(String(index)))
    expect(calls).toEqual([])
    expect(await builder.run(() => 1)).toBe(1)
    expect(calls).toHaveLength(1)
    expect((calls[0]!.options as ITransactionOptions).lock).toHaveLength(1000)
  })

  it('hands pre-encoded identities to the same actual loop without opening a deadline during configuration', async () => {
    const { store, scope } = fixture()
    const attempt = vi.fn()
    type INativeOptions = NonNullable<Parameters<typeof store.transaction>[1]>
    store.transaction = <TResult>(
      run: (view: typeof scope) => TResult,
      options?: INativeOptions
    ): Promise<Awaited<TResult>> =>
      runWithConcurrency(
        {
          store,
          options: options ?? {},
          policy: resolveConcurrencyPolicy(store, options?.concurrency)
        },
        {
          attempt: async (context) => {
            attempt(context)
            return { status: 'committed', value: run(scope) }
          }
        }
      )
    const configured = createTransactionBuilder(store, { timeoutMs: 100 }).lock(lockKey.text('a'))
    expect(attempt).not.toHaveBeenCalled()
    expect(await configured.run(() => 1)).toBe(1)
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})

describe('transaction builder Feature methods', () => {
  it('retains references and receivers across every configuration branch and the original run Promise', async () => {
    const { store, calls } = fixture()
    /** The original method sees the real builder without gaining another transaction owner. */
    const methods = {
      feature<T>(this: T): T {
        return this
      }
    }
    const root = createTransactionBuilder(store, undefined, methods)
    const controller = new AbortController()
    const locked = root.lock(lockKey.text('feature'))
    const branches = [
      root,
      root.concurrency(ConcurrencyPolicy.fail()),
      root.signal(controller.signal),
      root.timeout(10),
      locked,
      locked.lock(lockKey.text('second')),
      locked.concurrency(ConcurrencyPolicy.fail()),
      locked.signal(controller.signal),
      locked.timeout(10)
    ]
    for (const branch of branches) {
      expect(branch.feature).toBe(methods.feature)
      expect(branch.feature()).toBe(branch)
    }
    const pending = locked.feature().run((scope) => scope.read())
    expectTypeOf(pending).toEqualTypeOf<Promise<number>>()
    expect(pending).toBe(calls[0]!.promise)
    expect(await pending).toBe(1)
  })

  it('rejects built-in collisions before transaction execution', () => {
    const { store, calls } = fixture()
    expect(() => createTransactionBuilder(store, undefined, { run() {} })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(calls).toEqual([])
  })
})
