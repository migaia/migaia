import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  ConcurrencyPolicy,
  createTransactionBuilder,
  createTransactionOwner,
  lockKey,
  runWithConcurrency,
  resolveConcurrencyPolicy,
  type IStorageBase,
  type ITransactionOptions,
  type ILockedTransactionBuilder
} from '../src/index.js'

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
  it('has no root execution method and delegates once with the actual scope, native options and original Promise', async () => {
    const { store, calls } = fixture()
    const nativeTag = { value: 'kept' }
    let reads = 0
    const root = createTransactionBuilder(store, {
      get nativeTag() {
        reads++
        return nativeTag
      },
      pageSize: 5
    })
    expect('run' in root).toBe(false)
    expect(calls).toEqual([])
    expect(reads).toBe(1)
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
    expect(reads).toBe(1)
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
