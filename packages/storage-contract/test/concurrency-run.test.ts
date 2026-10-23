import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import * as keyOrder from '../src/key-order.js'
import {
  ConcurrencyPolicy,
  createTransactionOwner,
  defineConcurrencyPolicy,
  lockKey,
  runWithConcurrency,
  readConcurrencyLockIdentities,
  resolveConcurrencyPolicy,
  StorageStageKind,
  StorageContractError,
  StorageContractErrorCode,
  type IWriteOptions,
  type IWriteConcurrencyOptions,
  type IRecordStore,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext,
  type IConcurrencyPolicy,
  type IConcurrencyStageObserver,
  type IStorageBase,
  type ITransactionOptions
} from '../src/index.js'

/** A genuine registered resource exercises the public loop without inventing storage I/O. */
function base(handlers: Omit<Partial<IConcurrencyStageObserver>, 'kind' | 'report'> = {}) {
  const store: IStorageBase = {
    backend: 'concurrency-fixture',
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
    [Symbol.asyncDispose]: async () => undefined
  }
  const report = vi.fn(() => undefined)
  createTransactionOwner(
    store,
    (error) =>
      Object.assign(new Error('fixture failed', { cause: error }), {
        source: 'concurrency-fixture',
        code: 'TRANSACTION_FAILED'
      }),
    {
      concurrencyStages: { kind: StorageStageKind.concurrency, report, ...handlers }
    }
  )
  return { store, report }
}
/** Every returned conflict represents a backend that has already released its attempt resources. */
function conflict(
  phase: 'acquire' | 'commit' = 'acquire',
  cause?: unknown
): Extract<IConcurrencyAttempt<never>, { readonly status: 'conflict' }> {
  return { status: 'conflict', phase, keys: [lockKey.text('key')], holder: undefined, cause }
}
/** Keep test calls on the exact public entry and default resolution path. */
function run<T>(
  store: IStorageBase,
  attempt: (ctx: IConcurrencyAttemptContext) => Promise<IConcurrencyAttempt<T>>,
  options: ITransactionOptions = {},
  policy: IConcurrencyPolicy = resolveConcurrencyPolicy(store, options.concurrency)
) {
  return runWithConcurrency({ store, options, policy }, { attempt })
}

afterEach(() => vi.useRealTimers())

describe('canonical concurrency attempts', () => {
  it('captures raw policy once inside the owner and preserves exact nested attempt metadata', async () => {
    const { store } = base()
    const policy = ConcurrencyPolicy.fail()
    let reads = 0
    const original = new Date(1)
    let outerContext: IConcurrencyAttemptContext | undefined
    let identities: readonly string[] | undefined
    const options = {
      get concurrency() {
        reads++
        return policy
      },
      lock: [lockKey.record(original), lockKey.text('key'), lockKey.record(new Date(1))],
      timeoutMs: 100
    }
    await expect(
      runWithConcurrency(
        { store, options },
        {
          attempt: async (outer) => {
            outerContext = outer
            expect(outer.attempt).toBe(1)
            expect(outer.concurrency).toBe(policy)
            expect(outer.locking).toBe('pessimistic')
            identities = readConcurrencyLockIdentities(outer)
            expect(Object.isFrozen(identities)).toBe(true)
            expect(identities).toHaveLength(2)
            expect(identities).toBe(readConcurrencyLockIdentities(outer))
            original.setTime(99)
            const record = outer.lock!.find((key) => key.channel === 'record')!
            ;(record.key as Date).setTime(33)
            expect(readConcurrencyLockIdentities(outer)).toBe(identities)
            await expect(
              runWithConcurrency(
                { store, options: outer },
                {
                  attempt: async (inner) => {
                    expect(inner.signal).toBe(outer.signal)
                    expect(inner.attempt).toBe(outer.attempt)
                    expect(inner.timeoutMs).toBeUndefined()
                    expect(readConcurrencyLockIdentities(inner)).toBe(identities)
                    return { status: 'committed', value: 7 }
                  }
                }
              )
            ).resolves.toBe(7)
            return conflict()
          }
        }
      )
    ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
    expect(reads).toBe(1)
    expect(() => readConcurrencyLockIdentities(outerContext!)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => readConcurrencyLockIdentities({} as IConcurrencyAttemptContext)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('adds implicit locks once after captured fields while preserving explicit locks and nested budget', async () => {
    const { store } = base()
    const policy = ConcurrencyPolicy.optimistic({ retries: 1, backoffMs: 0 })
    const reads = { context: 0, hook: 0, derived: 0 }
    let attempts = 0
    const encode = vi.spyOn(keyOrder, 'encodeOrderedStorageKey')
    const options = {
      lock: [lockKey.record(new Date(1))],
      concurrency: policy,
      timeoutMs: 100,
      get conflictPolicy() {
        reads.context++
        return 'replace' as const
      }
    }
    try {
      await expect(
        runWithConcurrency(
          {
            store,
            options,
            get lock() {
              reads.hook++
              return (captured: IWriteOptions) => {
                reads.derived++
                expect(Object.isFrozen(captured)).toBe(true)
                expect(captured.conflictPolicy).toBe('replace')
                expect(reads.context).toBe(1)
                return [lockKey.text('root'), lockKey.record(new Date(1))]
              }
            }
          },
          {
            attempt: async (outer) => {
              attempts++
              if (attempts > 1) {
                expect(outer.lock).toEqual([lockKey.text('root'), lockKey.record(new Date(1))])
                return { status: 'committed', value: 9 }
              }
              expect(outer.lock).toEqual([lockKey.text('root'), lockKey.record(new Date(1))])
              const before = readConcurrencyLockIdentities(outer)
              ;(outer.lock![1]!.key as Date).setTime(90)
              encode.mockClear()
              await expect(
                runWithConcurrency(
                  {
                    store,
                    options: outer,
                    lock: () => [lockKey.bytes('blob')]
                  },
                  {
                    attempt: async (inner) => {
                      expect(encode).toHaveBeenCalledTimes(1)
                      expect(inner.signal).toBe(outer.signal)
                      expect(inner.timeoutMs).toBeUndefined()
                      expect(inner.lock).toEqual([
                        lockKey.text('root'),
                        lockKey.bytes('blob'),
                        lockKey.record(new Date(1))
                      ])
                      const ids = readConcurrencyLockIdentities(inner)
                      expect(ids).toContain(before[0])
                      expect(ids).toContain(before[1])
                      return { status: 'committed', value: 7 }
                    }
                  }
                )
              ).resolves.toBe(7)
              return conflict('commit')
            }
          }
        )
      ).resolves.toBe(9)
      expect(attempts).toBe(2)
      expect(reads).toEqual({ context: 1, hook: 1, derived: 1 })
    } finally {
      encode.mockRestore()
    }
    expectTypeOf<IWriteOptions>().toExtend<IWriteConcurrencyOptions>()
    expectTypeOf<
      NonNullable<Parameters<IRecordStore['removeBytes']>[1]>
    >().toExtend<IWriteConcurrencyOptions>()
    expectTypeOf<
      NonNullable<Parameters<IRecordStore['clearAll']>[0]>
    >().toExtend<IWriteConcurrencyOptions>()
  })

  it('rejects implicit lock failures before native admission and preserves coded failures', async () => {
    const { store } = base()
    const attempt = vi.fn()
    const original = new Error('derive failed')
    await expect(
      runWithConcurrency(
        {
          store,
          options: {},
          lock: () => {
            throw original
          }
        },
        { attempt }
      )
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', cause: original })
    await expect(
      runWithConcurrency(
        {
          store,
          options: {},
          get lock(): never {
            throw original
          }
        },
        { attempt }
      )
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', cause: original })
    const coded = new StorageContractError(StorageContractErrorCode.aborted, { cause: original })
    await expect(
      runWithConcurrency(
        {
          store,
          options: {},
          lock: () => {
            throw coded
          }
        },
        { attempt }
      )
    ).rejects.toBe(coded)
    await expect(
      runWithConcurrency({ store, options: {}, lock: () => [null as never] }, { attempt })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(attempt).not.toHaveBeenCalled()
  })

  it('keeps explicit policy authoritative and resolves the original default without another registry', async () => {
    const { store } = base()
    const explicit = ConcurrencyPolicy.fail()
    await expect(
      runWithConcurrency(
        {
          store,
          options: { concurrency: ConcurrencyPolicy.optimistic({ retries: 1, backoffMs: 0 }) },
          policy: explicit
        },
        {
          attempt: async (ctx) => {
            expect(ctx.locking).toBe('pessimistic')
            return conflict()
          }
        }
      )
    ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
    await expect(
      runWithConcurrency(
        { store, options: {} },
        {
          attempt: async (ctx) => {
            expect(ctx.locking).toBe(resolveConcurrencyPolicy(store).locking)
            expect(readConcurrencyLockIdentities(ctx)).toEqual([])
            return { status: 'committed', value: 1 }
          }
        }
      )
    ).resolves.toBe(1)
  })
  it('tries once without calling policy on success and preserves original options and awaited values', async () => {
    const { store } = base()
    const decide = vi.fn(() => ({ action: 'reject' as const }))
    const policy = defineConcurrencyPolicy({ name: 'unused', locking: 'optimistic', decide })
    const attempt = vi.fn(async (ctx: IConcurrencyAttemptContext) => {
      expect(ctx.admission).toBe('try')
      expect(ctx.locking).toBe('optimistic')
      expect(ctx.orgId).toBe('00000000-0000-0000-0000-000000000000')
      expect(Object.hasOwn(ctx, 'timeoutMs')).toBe(false)
      expect(ctx.pageSize).toBe(7)
      expect(ctx.lock?.map((k) => k.key)).toEqual(['a', 'z'])
      return { status: 'committed' as const, value: Promise.resolve(42) }
    })
    expect(
      await run(
        store,
        attempt,
        {
          pageSize: 7,
          orgId: '00000000-0000-0000-0000-000000000000',
          lock: [lockKey.text('z'), lockKey.text('a'), lockKey.text('z')]
        },
        policy
      )
    ).toBe(42)
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(decide).not.toHaveBeenCalled()
  })

  it.each(['acquire', 'commit'] as const)(
    'rejects %s conflict with the exact backend cause',
    async (phase) => {
      const { store } = base()
      const original = new Error('actual conflict')
      await expect(
        run(store, async () => conflict(phase, original), {}, ConcurrencyPolicy.fail())
      ).rejects.toMatchObject({
        source: '@migaia/storage-contract',
        code: phase === 'acquire' ? 'LOCK_REJECTED' : 'WRITE_CONFLICT',
        cause: original
      })
    }
  )

  it('retries only real conflicts after each complete attempt and never overlaps resources', async () => {
    const { store } = base()
    const trace: string[] = []
    let count = 0
    const attempts: number[] = []
    const result = await run(
      store,
      async (ctx) => {
        attempts.push(ctx.attempt)
        trace.push(`start:${ctx.admission}`)
        count += 1
        await Promise.resolve()
        trace.push('cleanup')
        return count < 3 ? conflict('commit') : { status: 'committed', value: 'done' }
      },
      {},
      ConcurrencyPolicy.optimistic({ retries: 2, backoffMs: 0 })
    )
    expect(result).toBe('done')
    expect(attempts).toEqual([1, 2, 3])
    expect(trace).toEqual(['start:try', 'cleanup', 'start:try', 'cleanup', 'start:try', 'cleanup'])
  })

  it('snapshots caller fields once and gives each decision independent mutable key components', async () => {
    const { store } = base()
    const date = new Date(1)
    const reads = { lock: 0, concurrency: 0, signal: 0, timeoutMs: 0, pageSize: 0, orgId: 0 }
    const policy = defineConcurrencyPolicy({
      name: 'mutate',
      locking: 'pessimistic',
      decide: (c) => {
        expect((c.keys[0]!.key as Date).getTime()).toBe(1)
        ;(c.keys[0]!.key as Date).setTime(99)
        return c.attempt < 2 ? { action: 'retry', delayMs: 0 } : { action: 'reject' }
      }
    })
    const options = {
      get lock() {
        reads.lock++
        return [lockKey.record(date)]
      },
      get concurrency() {
        reads.concurrency++
        return policy
      },
      get signal() {
        reads.signal++
        return undefined
      },
      get timeoutMs() {
        reads.timeoutMs++
        return undefined
      },
      get pageSize() {
        reads.pageSize++
        return undefined
      },
      get orgId() {
        reads.orgId++
        return undefined
      }
    }
    await expect(
      runWithConcurrency(
        { store, options, policy },
        {
          attempt: async (ctx) => ({
            status: 'conflict',
            phase: 'acquire',
            keys: ctx.lock!,
            holder: undefined
          })
        }
      )
    ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
    expect(reads).toEqual({
      lock: 1,
      concurrency: 1,
      signal: 1,
      timeoutMs: 1,
      pageSize: 1,
      orgId: 1
    })
    expect(date.getTime()).toBe(1)
  })

  it.each([
    null,
    { action: 'skip' },
    { action: 'wait', timeoutMs: -1 },
    { action: 'retry', delayMs: Infinity },
    { action: 'reject', timeoutMs: 1 },
    { action: 'retry', timeoutMs: 1 },
    { action: 'wait', delayMs: 1 }
  ])('rejects invalid policy decision %#', async (decision) => {
    const { store } = base()
    const policy = defineConcurrencyPolicy({
      name: 'invalid',
      locking: 'pessimistic',
      decide: () => decision as never
    })
    await expect(run(store, async () => conflict(), {}, policy)).rejects.toMatchObject({
      code: 'CONCURRENCY_POLICY_FAILED'
    })
  })

  it('preserves policy failure identity and rejects wait after commit', async () => {
    const { store } = base()
    const original = new Error('decision failed')
    const policy = defineConcurrencyPolicy({
      name: 'throws',
      locking: 'pessimistic',
      decide: () => {
        throw original
      }
    })
    await expect(run(store, async () => conflict(), {}, policy)).rejects.toMatchObject({
      code: 'CONCURRENCY_POLICY_FAILED',
      cause: original
    })
    const wait = defineConcurrencyPolicy({
      name: 'invalid-wait',
      locking: 'pessimistic',
      decide: () => ({ action: 'wait' })
    })
    await expect(run(store, async () => conflict('commit'), {}, wait)).rejects.toMatchObject({
      code: 'CONCURRENCY_POLICY_FAILED'
    })
  })

  it('shares logical wait spending across retries while excluding callback and physical wait time', async () => {
    vi.useFakeTimers()
    const { store } = base()
    const decisions: number[] = []
    const policy = defineConcurrencyPolicy({
      name: 'wait-retry',
      locking: 'pessimistic',
      decide: (c) => {
        decisions.push(c.waitedMs)
        return c.attempt === 2 ? { action: 'retry', delayMs: 0 } : { action: 'wait', timeoutMs: 10 }
      }
    })
    let attempts = 0
    const pending = run(
      store,
      async (ctx) => {
        attempts++
        if (attempts === 1 || attempts === 3) return conflict()
        if (attempts === 2) {
          await ctx.wait(new Promise<void>((resolve) => setTimeout(resolve, 6)))
          await new Promise<void>((resolve) => setTimeout(resolve, 30))
          return conflict()
        }
        expect(ctx.waitTimeoutMs).toBeLessThanOrEqual(4)
        await ctx.wait(new Promise<void>(() => undefined))
        return { status: 'committed', value: true }
      },
      {},
      policy
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(50)
    await rejected
    expect(attempts).toBe(4)
    expect(decisions[1]).toBeGreaterThanOrEqual(6)
    expect(decisions[2]).toBeLessThan(10)
  })

  it('keeps zero logical wait from blocking physical admission and maps physical deadlines separately', async () => {
    vi.useFakeTimers()
    const { store } = base()
    const first = run(
      store,
      async (ctx) => {
        await ctx.waitPhysical(new Promise<void>((resolve) => setTimeout(resolve, 31_000)))
        return { status: 'committed', value: 1 }
      },
      {},
      ConcurrencyPolicy.fail()
    )
    await vi.advanceTimersByTimeAsync(31_000)
    expect(await first).toBe(1)
    const pending = run(
      store,
      async (ctx) => {
        await ctx.waitPhysical(new Promise<void>(() => undefined))
        return { status: 'committed', value: 1 }
      },
      { timeoutMs: 5 },
      ConcurrencyPolicy.wait({ timeoutMs: 0 })
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(5)
    await rejected
  })

  it('does not finish cancellation until an accepted attempt has actually cleaned up', async () => {
    const { store } = base()
    const controller = new AbortController()
    const reason = new Error('external stop')
    const entered = deferred<void>()
    const release = deferred<void>()
    let settled = false
    const pending = run(
      store,
      async (ctx) => {
        entered.resolve()
        await release.promise
        expect(ctx.signal?.aborted).toBe(true)
        return conflict()
      },
      { signal: controller.signal },
      ConcurrencyPolicy.fail()
    )
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await entered.promise
    controller.abort(reason)
    await Promise.resolve()
    expect(settled).toBe(false)
    release.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
  })

  it('reuses the outer attempt budget for nested store admission and does not restart a deadline', async () => {
    vi.useFakeTimers()
    const { store } = base()
    const pending = run(
      store,
      async (outer) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 6))
        return {
          status: 'committed',
          value: await run(
            store,
            async (inner) => {
              expect(inner.signal).toBe(outer.signal)
              await inner.waitPhysical(new Promise<void>(() => undefined))
              return { status: 'committed', value: true }
            },
            outer,
            ConcurrencyPolicy.fail()
          )
        }
      },
      { timeoutMs: 10 },
      ConcurrencyPolicy.fail()
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(10)
    await rejected
  })
  it('keeps synchronous and asynchronous observation failures report-only', async () => {
    const original = new Error('observer failed')
    const { store, report } = base({
      beforeLockAcquire: () => {
        throw original
      },
      onLockConflict: async () => {
        throw original
      }
    })
    await expect(
      run(store, async () => conflict(), {}, ConcurrencyPolicy.fail())
    ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
    await Promise.resolve()
    expect(report.mock.calls).toEqual([[original], [original]])
  })

  it('starts no native work for pre-abort or zero deadline and returns an actual completed commit', async () => {
    const { store } = base()
    const controller = new AbortController()
    const reason = new Error('pre-aborted')
    controller.abort(reason)
    const attempt = vi.fn(async () => ({ status: 'committed' as const, value: 1 }))
    await expect(run(store, attempt, { signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED',
      cause: reason
    })
    await expect(run(store, attempt, { timeoutMs: 0 })).rejects.toMatchObject({ code: 'ABORTED' })
    expect(attempt).not.toHaveBeenCalled()
    const committing = new AbortController()
    expect(
      await run(
        store,
        async () => {
          committing.abort(reason)
          return { status: 'committed', value: 2 }
        },
        { signal: committing.signal }
      )
    ).toBe(2)
  })

  it('reports late admission rejection after a physical timeout without replacing its result', async () => {
    vi.useFakeTimers()
    const { store, report } = base()
    const admission = deferred<void>()
    const pending = run(
      store,
      async (context) => {
        await context.waitPhysical(admission.promise)
        return { status: 'committed', value: 1 }
      },
      { timeoutMs: 5 }
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(5)
    await rejected
    const original = new Error('late admission failure')
    admission.reject(original)
    await Promise.resolve()
    await Promise.resolve()
    expect(report).toHaveBeenCalledWith(original)
  })
  it('keeps rejection and logical-timeout keys and holder consistent with actual conflicts', async () => {
    const { store } = base()
    const holder = {
      status: 'held' as const,
      owner: 'actual-owner',
      label: 'agent-a',
      since: 1,
      scope: 'local' as const
    }
    const original = new Error('held key')
    const keys = [lockKey.record(new Date(1))]
    const attempt = async () => ({
      status: 'conflict' as const,
      phase: 'acquire' as const,
      keys,
      holder,
      cause: original
    })
    for (const policy of [ConcurrencyPolicy.fail(), ConcurrencyPolicy.wait({ timeoutMs: 0 })]) {
      try {
        await run(store, attempt, {}, policy)
        throw new Error('expected rejection')
      } catch (error) {
        expect(error).toMatchObject({
          source: '@migaia/storage-contract',
          holder,
          cause: original,
          keys: [{ channel: 'record', key: new Date(1) }]
        })
        expect((error as Error).message).toContain('agent-a')
        expect((error as Error).message).toContain('record')
        expect(Object.isFrozen(error)).toBe(true)
        expect(Object.isFrozen((error as { keys: unknown }).keys)).toBe(true)
      }
    }
    const handoff = { status: 'handing-off' as const, scope: 'remote' as const }
    await expect(
      run(
        store,
        async () => ({ ...(await attempt()), holder: handoff }),
        {},
        ConcurrencyPolicy.fail()
      )
    ).rejects.toMatchObject({ holder: handoff, message: expect.stringContaining('handing-off') })
  })

  it('attaches current declared keys and unknown holder to physical timeouts', async () => {
    vi.useFakeTimers()
    const { store } = base()
    const pending = run(
      store,
      async (ctx) => {
        await ctx.waitPhysical(new Promise<void>(() => undefined))
        return { status: 'committed', value: 1 }
      },
      { timeoutMs: 5, lock: [lockKey.text('actual-key')] }
    )
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'LOCK_TIMEOUT',
      keys: [{ channel: 'text', key: 'actual-key' }],
      holder: undefined
    })
    await vi.advanceTimersByTimeAsync(5)
    await rejected
  })
  it('forwards native fields and symbol extensions through the exact nested attempt context once', async () => {
    const { store } = base()
    const nativeSymbol = Symbol('native option')
    const nativeValue = { tag: 'unchanged' }
    let reads = 0
    const options = {
      get nativeTag() {
        reads++
        return nativeValue
      },
      [nativeSymbol]: nativeValue,
      timeoutMs: 100,
      pageSize: 3,
      orgId: '00000000-0000-0000-0000-000000000000'
    }
    expect(
      await run(
        store,
        async (outer) => {
          expect(Reflect.get(outer, 'nativeTag')).toBe(nativeValue)
          expect(Reflect.get(outer, nativeSymbol)).toBe(nativeValue)
          expect(Object.hasOwn(outer, 'timeoutMs')).toBe(false)
          return {
            status: 'committed',
            value: await run(
              store,
              async (inner) => {
                expect(inner.signal).toBe(outer.signal)
                expect(Reflect.get(inner, 'nativeTag')).toBe(nativeValue)
                expect(Reflect.get(inner, nativeSymbol)).toBe(nativeValue)
                expect(inner.pageSize).toBe(3)
                expect(inner.orgId).toBe(options.orgId)
                return { status: 'committed', value: true }
              },
              outer
            )
          }
        },
        options
      )
    ).toBe(true)
    expect(reads).toBe(1)
  })
})

describe('original concurrency preparation budget', () => {
  it('captures once, prepares once and derives fixed-input locks before the first native attempt', async () => {
    const { store } = base()
    /** Getter counts prove preparation and derivation reuse the original admitted fields. */
    let reads = 0
    /** The pipeline owns this fixed operation input before implicit lock derivation. */
    let key = 'before'
    const options = {
      get timeoutMs() {
        reads++
        return 100
      },
      lock: [lockKey.text('explicit')]
    }
    const prepare = vi.fn(async (ctx) => {
      expect(Object.isFrozen(ctx)).toBe(true)
      expect(ctx.timeoutMs).toBe(100)
      key = 'after'
    })
    const derive = vi.fn(() => [lockKey.text(key)])
    const attempt = vi.fn(async (ctx: IConcurrencyAttemptContext) => {
      expect(prepare).toHaveBeenCalledTimes(1)
      expect(derive).toHaveBeenCalledTimes(1)
      expect(ctx.lock).toEqual([lockKey.text('after'), lockKey.text('explicit')])
      expect(ctx.signal).toBe(prepare.mock.calls[0]![0].signal)
      return { status: 'committed', value: 7 } as const
    })
    await expect(
      runWithConcurrency({ store, options, prepare, lock: derive }, { attempt })
    ).resolves.toBe(7)
    expect(reads).toBe(1)
  })

  it('keeps the original deadline during preparation and awaits settlement before rejecting without lock or native admission', async () => {
    vi.useFakeTimers()
    const { store } = base()
    const preparation = deferred<void>()
    const attempt = vi.fn()
    const derive = vi.fn(() => [])
    let settled = false
    let signal: AbortSignal | undefined
    const pending = runWithConcurrency(
      {
        store,
        options: { timeoutMs: 10 },
        prepare: (ctx) => {
          signal = ctx.signal as AbortSignal
          return preparation.promise
        },
        lock: derive
      },
      { attempt }
    )
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await vi.advanceTimersByTimeAsync(10)
    expect(signal?.aborted).toBe(true)
    expect(settled).toBe(false)
    expect(attempt).not.toHaveBeenCalled()
    preparation.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    expect(derive).not.toHaveBeenCalled()
    expect(attempt).not.toHaveBeenCalled()
  })

  it('preserves original preparation failure without invoking derivation, native attempt or conflict observations', async () => {
    const beforeLockAcquire = vi.fn()
    const { store } = base({ beforeLockAcquire })
    const failure = new StorageContractError(StorageContractErrorCode.invalidArgument)
    const attempt = vi.fn()
    const lock = vi.fn(() => [])
    await expect(
      runWithConcurrency(
        {
          store,
          options: {},
          prepare: () => {
            throw failure
          },
          lock
        },
        { attempt }
      )
    ).rejects.toBe(failure)
    expect(lock).not.toHaveBeenCalled()
    expect(attempt).not.toHaveBeenCalled()
    expect(beforeLockAcquire).not.toHaveBeenCalled()
  })
})

describe('original concurrency execution continuation', () => {
  it('runs after-next after actual commit and derives locks from the fixed terminal input once', async () => {
    const { store } = base()
    const order: string[] = []
    let input = 'before'
    let committed = false
    const lock = vi.fn(() => [lockKey.text(input)])
    await expect(
      runWithConcurrency(
        {
          store,
          options: {},
          lock,
          execute: async (_ctx, invokeOriginalLoop) => {
            order.push('before')
            input = 'fixed'
            const result = await invokeOriginalLoop()
            expect(committed).toBe(true)
            order.push('after')
            return result
          }
        },
        {
          attempt: async (ctx) => {
            expect(ctx.lock).toEqual([lockKey.text('fixed')])
            order.push('native')
            committed = true
            return { status: 'committed', value: 9 }
          }
        }
      )
    ).resolves.toBe(9)
    expect(lock).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['before', 'native', 'after'])
  })

  it('keeps catch around the original native error and releases the same signal only after the outer pipeline settles', async () => {
    vi.useFakeTimers()
    const { store } = base()
    const failure = new StorageContractError(StorageContractErrorCode.invalidArgument)
    let signal: AbortSignal | undefined
    let caught: unknown
    const pending = runWithConcurrency(
      {
        store,
        options: { timeoutMs: 10 },
        execute: async (ctx, invokeOriginalLoop) => {
          signal = ctx.signal as AbortSignal
          try {
            return await invokeOriginalLoop()
          } catch (cause) {
            caught = cause
            await new Promise((resolve) => setTimeout(resolve, 20))
            throw cause
          }
        }
      },
      {
        attempt: async () => {
          throw failure
        }
      }
    )
    const rejected = expect(pending).rejects.toBe(failure)
    await vi.advanceTimersByTimeAsync(10)
    expect(signal?.aborted).toBe(true)
    expect(caught).toBe(failure)
    await vi.advanceTimersByTimeAsync(10)
    await rejected
  })

  it('expires before-next work without lock derivation or native admission and rejects duplicate continuation calls', async () => {
    vi.useFakeTimers()
    const { store } = base()
    const lock = vi.fn(() => [])
    const attempt = vi.fn()
    const pending = runWithConcurrency(
      {
        store,
        options: { timeoutMs: 10 },
        lock,
        execute: async (_ctx, invokeOriginalLoop) => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          return invokeOriginalLoop()
        }
      },
      { attempt }
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    expect(lock).not.toHaveBeenCalled()
    expect(attempt).not.toHaveBeenCalled()
    const once = vi.fn(async () => ({ status: 'committed', value: 1 }) as const)
    await expect(
      runWithConcurrency(
        {
          store,
          options: {},
          execute: async (_ctx, invokeOriginalLoop) => {
            await invokeOriginalLoop()
            return invokeOriginalLoop()
          }
        },
        { attempt: once }
      )
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(once).toHaveBeenCalledTimes(1)
  })
})
