import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  assertTransactionOwner,
  createTransactionOwner,
  nextTransactionIterator,
  registerTransactionFinalizer,
  runTransactionOperation,
  TransactionActivityMode,
  type IStorageBase,
  type IStorageIterator,
  type IRecordStore,
  type ITransactionInfo,
  type ITransactionScope
} from '../src/index.js'

/** Test backend keeps one native error family so normalization can preserve exact coded identity. */
type IFailure = Error & { readonly source: string; readonly code: string }
/** Concrete non-KV scope proves the owner retains backend extensions without copying caller fields. */
type IScope = { read(): Promise<number>; sql(text: string): Promise<string> }

/** Produces an idempotent backend error without changing an original stack or cause. */
function normalizeFailure(error: unknown): IFailure {
  if (error instanceof Error && 'source' in error && 'code' in error) return error as IFailure
  /** Frozen backend errors require cleanup aggregates to preserve the primary on their cause chain. */
  const failure = new Error('fixture transaction failed', { cause: error })
  Object.defineProperties(failure, {
    source: { value: 'fixture-backend' },
    code: { value: 'TRANSACTION_FAILED' }
  })
  return Object.freeze(failure) as IFailure
}

/** Each fixture owns one actual resource base and one original transaction method factory. */
function setup(options?: { beforeCommit?: (scope: IScope) => void | PromiseLike<void> }) {
  /** No KV methods are fabricated for this specialized backend. */
  const base: IStorageBase = {
    backend: 'fixture-backend',
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined
  }
  /** Calls are counted by original error identity rather than incidental expiry preparation. */
  const normalize = vi.fn(normalizeFailure)
  /** Backend abort notification must happen when the first operation fails. */
  const onFailure = vi.fn()
  /** Every method factory creates fresh complete native capabilities. */
  const createScope = vi.fn((): IScope => {
    /** Data methods authorize the actual view on every entry. */
    const scope: IScope = {
      read: () => runTransactionOperation(scope, () => 7),
      sql: (text) => runTransactionOperation(scope, () => text)
    }
    return scope
  })
  /** Explicit non-KV scope shares the same canonical owner as complete KV transaction scopes. */
  const owner = createTransactionOwner<unknown, IScope>(base, normalize, {
    activityMode: TransactionActivityMode.native
  })
  /** The initial view belongs only to the user callback interval. */
  const root = createScope()
  /** Only this backend holds lifecycle authority. */
  const controller = owner.register(root, {
    createScope,
    onFailure,
    beforeCommit: options?.beforeCommit
  })
  return { base, normalize, onFailure, createScope, owner, root, controller }
}

describe('canonical transaction ownership', () => {
  it('rejects forged, duplicate and expired identities without invoking data factories', async () => {
    /** A real owner is initialized exactly once for the original store identity. */
    const fixture = setup()
    expect(() => createTransactionOwner(fixture.base, normalizeFailure)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() =>
      fixture.owner.register(fixture.root, {
        createScope: fixture.createScope,
        onFailure: fixture.onFailure
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => assertTransactionOwner(fixture.base, {})).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => runTransactionOperation({}, () => 1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    /** Termination releases all old view authority, including previously saved method references. */
    const saved = fixture.root.read
    fixture.controller.close()
    fixture.controller.close()
    expect(() => assertTransactionOwner(fixture.base, fixture.root)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await expect(saved()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(fixture.createScope).toHaveBeenCalledTimes(1)
    expect(() =>
      fixture.owner.register(fixture.root, {
        createScope: fixture.createScope,
        onFailure: fixture.onFailure
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('admits work synchronously and drains accepted operation views after the user view closes', async () => {
    /** Deferred native work remains owned until its actual settlement. */
    const gate = Promise.withResolvers<number>()
    /** Root and derived views share one immutable transaction identity. */
    const fixture = setup()
    /** The callback receives a fresh view before this API returns its Promise. */
    let operation: IScope | undefined
    /** All views report the actual backend activity mode. */
    const info = assertTransactionOwner(fixture.base, fixture.root)
    /** In-flight work can use its own view after callback admission ends. */
    const result = runTransactionOperation(fixture.root, async (scope) => {
      operation = scope
      expect(assertTransactionOwner(fixture.base, scope)).toBe(info)
      await gate.promise
      return await scope.sql('same transaction')
    })
    expect(operation).toBeDefined()
    expect(operation).not.toBe(fixture.root)
    fixture.controller.stopAdmission()
    await expect(fixture.root.read()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    /** Final checks wait accepted work without keeping the old callback view active. */
    const final = fixture.controller.runFinalizers()
    gate.resolve(1)
    await expect(result).resolves.toBe('same transaction')
    await final
    expect(info.activityMode).toBe(TransactionActivityMode.native)
    expect(Object.isFrozen(info)).toBe(true)
    expect(() => assertTransactionOwner(fixture.base, operation!)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    fixture.controller.close()
  })

  it('locks a caught pre-request failure and reads a returned then getter only once', async () => {
    /** An encoding failure can occur before any native backend request starts. */
    const original = new Error('codec failed first')
    /** One real transaction must fail even when its user catches the operation rejection. */
    const fixture = setup()
    /** Captured then inspection must not rediscover this throwing accessor. */
    let reads = 0
    /** A getter descriptor exercises then inspection without declaring a Promise implementation. */
    // eslint-disable-next-line unicorn/no-thenable -- The test intentionally exercises a failed then getter.
    const result = Object.defineProperty({}, 'then', {
      get(): never {
        reads += 1
        throw original
      }
    })
    await runTransactionOperation(fixture.root, () => result).catch(() => undefined)
    expect(reads).toBe(1)
    expect(fixture.onFailure).toHaveBeenCalledTimes(1)
    /** The callback and finalizers observe the exact same backend-coded primary. */
    const failure = fixture.onFailure.mock.calls[0]![0] as IFailure
    expect(failure.cause).toBe(original)
    const first = fixture.controller.runFinalizers()
    expect(fixture.controller.runFinalizers()).toBe(first)
    await expect(first).rejects.toBe(failure)
    expect(fixture.normalize.mock.calls.filter(([error]) => error === original)).toHaveLength(1)
    fixture.controller.close()
  })

  it('runs ordered checks and final beforeCommit once with distinct complete views', async () => {
    /** Saved view facts prove one transaction identity without retaining data permission. */
    const identities: ITransactionInfo[] = []
    /** Each check creates its own active resource, released before entering the next check. */
    const closed: string[] = []
    /** A final beforeCommit check follows all ordinary registered checks. */
    const order: string[] = []
    /** The final library check can still perform native work on its new view. */
    const fixture = setup({
      beforeCommit: async (scope) => {
        order.push('commit')
        expect(closed).toEqual(['a', 'b'])
        await scope.read()
      }
    })
    /** An expired check object must never become valid again for a later check. */
    let previous: IScope | undefined
    for (const name of ['a', 'b']) {
      registerTransactionFinalizer(fixture.root, async (scope) => {
        if (previous)
          expect(() => assertTransactionOwner(fixture.base, previous!)).toThrowError(
            expect.objectContaining({ code: 'INVALID_ARGUMENT' })
          )
        previous = scope
        order.push(name)
        identities.push(assertTransactionOwner(fixture.base, scope))
        fixture.owner.registerIterator(scope, {
          next: async () => ({ done: false, value: 1 }),
          close: () => {
            closed.push(name)
          }
        })
        expect(await scope.read()).toBe(7)
      })
    }
    const final = fixture.controller.runFinalizers()
    expect(fixture.controller.runFinalizers()).toBe(final)
    expect(() => registerTransactionFinalizer(fixture.root, () => undefined)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await final
    expect(order).toEqual(['a', 'b', 'commit'])
    expect(identities[0]).toBe(identities[1])
    expect(fixture.onFailure).not.toHaveBeenCalled()
    fixture.controller.close()
  })

  it('normalizes a failed check once and skips all later checks', async () => {
    /** The second check's source error remains reachable from the one cached finalizer result. */
    const original = new Error('second check failed')
    /** Check order is distinct from Promise settlement ordering. */
    const order: number[] = []
    /** The failure must call the existing backend rollback notification immediately. */
    const fixture = setup()
    registerTransactionFinalizer(fixture.root, () => {
      order.push(1)
    })
    registerTransactionFinalizer(fixture.root, () => {
      order.push(2)
      throw original
    })
    registerTransactionFinalizer(fixture.root, () => {
      order.push(3)
    })
    const final = fixture.controller.runFinalizers()
    await expect(final).rejects.toMatchObject({ cause: original, code: 'TRANSACTION_FAILED' })
    expect(fixture.controller.runFinalizers()).toBe(final)
    expect(order).toEqual([1, 2])
    expect(fixture.normalize.mock.calls.filter(([error]) => error === original)).toHaveLength(1)
    expect(fixture.onFailure).toHaveBeenCalledTimes(1)
    fixture.controller.close()
  })
})

describe('transaction iterator resources', () => {
  it('borrows each current view without reviving its expired creation view or accepting forged resources', async () => {
    /** One resource position advances under distinct current operation views. */
    const fixture = setup()
    /** Captured operation views prove next does not reuse a prior view. */
    const views: IScope[] = []
    /** Backend close remains one real cleanup after partial consumption. */
    const close = vi.fn()
    /** The resource is created inside a short-lived operation. */
    const iterator = await runTransactionOperation(fixture.root, (scope) =>
      fixture.owner.registerIterator(scope, {
        next: async (current) => {
          views.push(current)
          return { done: false, value: views.length }
        },
        close
      })
    )
    await expect(iterator.next()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    await expect(
      runTransactionOperation(fixture.root, (scope) => nextTransactionIterator(scope, iterator))
    ).resolves.toMatchObject({ value: 1 })
    await expect(
      runTransactionOperation(fixture.root, (scope) => nextTransactionIterator(scope, iterator))
    ).resolves.toMatchObject({ value: 2 })
    expect(views[0]).not.toBe(views[1])
    expect(() => nextTransactionIterator(fixture.root, { next: iterator.next })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    /** Another store and another transaction cannot borrow this resource. */
    const other = setup()
    expect(() => nextTransactionIterator(other.root, iterator)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await fixture.controller.runFinalizers()
    expect(close).toHaveBeenCalledTimes(1)
    const main = iterator.dispose()
    expect(iterator.dispose()).toBe(main)
    const symbolic = iterator[Symbol.asyncDispose]()
    expect(iterator[Symbol.asyncDispose]()).toBe(symbolic)
    expect(symbolic).not.toBe(main)
    expect(iterator.return!()).toBe(iterator.return!())
    await Promise.all([main, symbolic, iterator.return!()])
    expect(close).toHaveBeenCalledTimes(1)
    fixture.controller.close()
    other.controller.close()
  })

  it('waits accepted concurrent advances before close and releases once across cleanup callers', async () => {
    /** Concurrent port advances keep independent views but share one actual cursor lifetime. */
    const fixture = setup()
    /** Each native next must settle before resource cleanup can release the cursor. */
    const first = Promise.withResolvers<IteratorResult<number>>()
    /** Independent second advancement proves cleanup cannot stop after the first result. */
    const second = Promise.withResolvers<IteratorResult<number>>()
    /** Ports execute immediately in the original transaction active context. */
    const next = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    /** The one actual cleanup is counted regardless of initiating public method. */
    const close = vi.fn()
    /** Resource methods themselves carry no authority to commit. */
    const iterator = fixture.owner.registerIterator<IScope, number>(fixture.root, { next, close })
    const a = iterator.next()
    const b = iterator.next()
    const main = iterator.dispose()
    const returning = iterator.return!()
    expect(iterator.dispose()).toBe(main)
    const closing = fixture.controller.closeIterators()
    expect(fixture.controller.closeIterators()).toBe(closing)
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()
    first.resolve({ done: false, value: 1 })
    await a
    expect(close).not.toHaveBeenCalled()
    second.resolve({ done: false, value: 2 })
    await Promise.all([b, main, returning, closing])
    expect(close).toHaveBeenCalledTimes(1)
    fixture.controller.close()
  })

  it('captures the outer canonical disposal key once without creating a native fallback', async () => {
    /** A distinct fixed key represents the existing outer host identity. */
    const key: symbol = Symbol('host-disposal')
    /** This base has not been initialized by the tested owner yet. */
    const fixture = setup()
    /** A separate original base supports the host key as its real cleanup method. */
    const base = { ...fixture.base, [key]: fixture.base.dispose }
    /** Key accessors must not be rediscovered by each iterator wrapper. */
    let reads = 0
    const owner = createTransactionOwner<unknown, IScope>(base, normalizeFailure, {
      get asyncDisposeKey(): typeof Symbol.asyncDispose {
        reads += 1
        return key as typeof Symbol.asyncDispose
      }
    })
    const root = fixture.createScope()
    const controller = owner.register(root, {
      createScope: fixture.createScope,
      onFailure: fixture.onFailure
    })
    const close = vi.fn()
    const iterator = owner.registerIterator(root, {
      next: async () => ({ done: false, value: 1 }),
      close
    })
    expect(reads).toBe(1)
    expect(Reflect.get(iterator, Symbol.asyncDispose)).toBeUndefined()
    /** The host owns key selection; the contract only installs the supplied method identity. */
    const symbolic = Reflect.get(iterator, key) as () => Promise<void>
    expect(symbolic()).toBe(symbolic())
    await symbolic()
    expect(close).toHaveBeenCalledTimes(1)
    controller.close()
    fixture.controller.close()
  })

  it('naturally completed resources close once and do not replay historical cleanup', async () => {
    /** A done result releases the resource without waiting for explicit return. */
    const fixture = setup()
    /** Closing a completed cursor is still one required port action. */
    const close = vi.fn()
    /** A finite native cursor is owned by this exact transaction. */
    const iterator = fixture.owner.registerIterator<IScope, number>(fixture.root, {
      next: async () => ({ done: true, value: undefined }),
      close
    })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    await fixture.controller.runFinalizers()
    expect(close).toHaveBeenCalledTimes(1)
    fixture.controller.close()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  })

  it('continues cleanup and preserves the primary before multiple resource failures', async () => {
    /** A real operation failure remains the primary even if every remaining cursor close fails. */
    const primary = new Error('request failed')
    /** Both independent cleanup failures remain reachable. */
    const releases = [new Error('cursor a close failed'), new Error('cursor b close failed')]
    /** One shared owner aggregates its actual active resources only. */
    const fixture = setup()
    /** Every remaining port must be attempted despite earlier close rejection. */
    const closes = releases.map((error) =>
      vi.fn(() => {
        throw error
      })
    )
    for (const close of closes)
      fixture.owner.registerIterator(fixture.root, {
        next: async () => ({ done: false, value: 1 }),
        close
      })
    await runTransactionOperation(fixture.root, () => {
      throw primary
    }).catch(() => undefined)
    /** Backend normalization codes the aggregate while retaining its native type on cause. */
    let failure: unknown
    try {
      await fixture.controller.closeIterators()
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED' })
    const aggregate = (failure as Error).cause as AggregateError
    expect(aggregate).toBeInstanceOf(AggregateError)
    expect(aggregate.errors[0]).toBe(fixture.onFailure.mock.calls[0]![0])
    expect(aggregate.errors[0].cause).toBe(primary)
    expect(aggregate.errors.slice(1).map((error) => error.cause)).toEqual([...releases].reverse())
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1)
    await fixture.controller.closeIterators()
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1)
    fixture.controller.close()
  })

  it('observes an unawaited late next failure and drains its actual resource before rollback', async () => {
    /** A discarded iterator Promise remains owned until its native request really settles. */
    const gate = Promise.withResolvers<IteratorResult<number>>()
    /** Native request failure must become the same first transaction failure. */
    const original = new Error('late native next failed')
    const fixture = setup()
    const close = vi.fn()
    const iterator = fixture.owner.registerIterator<IScope, number>(fixture.root, {
      next: () => gate.promise,
      close
    })
    void iterator.next()
    fixture.controller.stopAdmission()
    const final = fixture.controller.runFinalizers()
    gate.reject(original)
    await expect(final).rejects.toMatchObject({ cause: original })
    expect(close).toHaveBeenCalledTimes(1)
    expect(fixture.onFailure).toHaveBeenCalledTimes(1)
    fixture.controller.close()
  })

  it('keeps a rejecting main cleanup Promise and reports once through cached symbolic cleanup', async () => {
    /** Existing host exception scheduling is the diagnostic seam; no new production reporter exists. */
    const reported: unknown[] = []
    /** Collect queued host exceptions at their original identity for this one resource failure. */
    const enqueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      try {
        callback()
      } catch (error) {
        reported.push(error)
      }
    })
    try {
      /** The main rejection and report-only symbolic Promise represent one actual cleanup. */
      const fixture = setup()
      /** Native resource close rejects once with this exact source error. */
      const original = new Error('cursor release failed')
      /** Port invocation is independent of the number of cleanup entry points. */
      const close = vi.fn(() => {
        throw original
      })
      const iterator = fixture.owner.registerIterator(fixture.root, {
        next: async () => ({ done: false, value: 1 }),
        close
      })
      const main = iterator.dispose()
      await expect(main).rejects.toMatchObject({ cause: original })
      const symbolic = iterator[Symbol.asyncDispose]()
      expect(iterator[Symbol.asyncDispose]()).toBe(symbolic)
      expect(iterator.dispose()).toBe(main)
      await expect(symbolic).resolves.toBeUndefined()
      expect(close).toHaveBeenCalledTimes(1)
      expect(reported).toEqual([fixture.onFailure.mock.calls[0]![0]])
      fixture.controller.close()
    } finally {
      enqueue.mockRestore()
    }
  })
})

describe('transaction public type contracts', () => {
  it('retains precise callbacks, complete scope, resource iterators and native normalization', () => {
    /** This compile-only caller proves synchronous and PromiseLike results retain Awaited inference. */
    function verify(store: IRecordStore<{ count: number }>, raw: AsyncIterableIterator<number>) {
      expectTypeOf(store.transaction((scope) => scope.getRecord('k'))).toEqualTypeOf<
        Promise<{ count: number } | undefined>
      >()
      expectTypeOf(store.transaction(() => 3 as const)).toEqualTypeOf<Promise<3>>()
      expectTypeOf<ITransactionScope['get']>().returns.toEqualTypeOf<Promise<string | null>>()
      // @ts-expect-error Plain iterators cannot promise explicit owned cleanup.
      const owned: IStorageIterator<number> = raw
      void owned
      // @ts-expect-error Legacy record write names are removed, not aliased.
      store.transaction((scope) => scope.put({ count: 1 }))
      // @ts-expect-error A bare Error does not satisfy backend source/code ownership.
      createTransactionOwner(store, () => new Error('uncoded'))
    }
    void verify
  })
})
