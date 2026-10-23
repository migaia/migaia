import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  ConcurrencyPolicy,
  defineConcurrencyPolicy,
  createTransactionOwner,
  StorageStageKind,
  type IConcurrencyConflict,
  type IConcurrencyDecision,
  type IConcurrencyPolicy,
  type IStorageBase
} from '../src/index.js'
import { resolveConcurrencyPolicy } from '../src/transaction.js'

/** This original specialized resource has no database and does not fabricate KV operations. */
function createBase(): IStorageBase {
  return {
    backend: 'policy-fixture',
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
}
/** Owner admission is tested without executing any transaction or policy decision. */
function normalize(error: unknown): Error & { source: string; code: string } {
  return Object.assign(new Error('fixture failed', { cause: error }), {
    source: 'policy-fixture',
    code: 'TRANSACTION_FAILED'
  })
}

describe('registered concurrency policy metadata', () => {
  it('captures valid metadata and its decision once without executing or exposing the callback', () => {
    /** All definition fields are borrowed once before immutable metadata is published. */
    const reads = { name: 0, locking: 0, decide: 0 }
    /** A definition callback is private and must not run during creation or default selection. */
    const decide = vi.fn((): IConcurrencyDecision => ({ action: 'reject' }))
    const policy = defineConcurrencyPolicy({
      get name() {
        reads.name += 1
        return 'custom' as const
      },
      get locking() {
        reads.locking += 1
        return 'pessimistic' as const
      },
      get decide() {
        reads.decide += 1
        return decide
      }
    })
    expect(reads).toEqual({ name: 1, locking: 1, decide: 1 })
    expect(policy).toEqual({ name: 'custom', locking: 'pessimistic' })
    expect(Object.isFrozen(policy)).toBe(true)
    expect('decide' in policy).toBe(false)
    expect(decide).not.toHaveBeenCalled()
    expectTypeOf(policy.name).toEqualTypeOf<'custom'>()
    expectTypeOf(policy.locking).toEqualTypeOf<'pessimistic'>()
  })

  it.each([
    null,
    [],
    {},
    { name: '', locking: 'pessimistic', decide: () => ({ action: 'reject' }) },
    { name: ' ', locking: 'pessimistic', decide: () => ({ action: 'reject' }) },
    { name: 'bad', locking: 'invalid', decide: () => ({ action: 'reject' }) },
    { name: 'bad', locking: 'optimistic', decide: 1 }
  ])('rejects invalid metadata before policy execution %#', (definition) => {
    expect(() =>
      defineConcurrencyPolicy(definition as Parameters<typeof defineConcurrencyPolicy>[0])
    ).toThrowError(
      expect.objectContaining({ source: '@migaia/storage-contract', code: 'INVALID_ARGUMENT' })
    )
  })

  it('preserves definition and option getter failures as exact causes', () => {
    /** The original failed accessor remains the admission error cause. */
    const original = new Error('policy getter failed')
    expect(() =>
      defineConcurrencyPolicy({
        get name(): never {
          throw original
        },
        locking: 'pessimistic',
        decide: () => ({ action: 'reject' })
      })
    ).toThrowError(expect.objectContaining({ cause: original }))
    expect(() =>
      ConcurrencyPolicy.wait({
        get timeoutMs(): never {
          throw original
        }
      })
    ).toThrowError(expect.objectContaining({ cause: original }))
    expect(() =>
      ConcurrencyPolicy.optimistic({
        get retries(): never {
          throw original
        }
      })
    ).toThrowError(expect.objectContaining({ cause: original }))
  })

  it.each([-1, Infinity, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid preset budgets %s',
    (value) => {
      for (const create of [
        () => ConcurrencyPolicy.wait({ timeoutMs: value }),
        () => ConcurrencyPolicy.optimistic({ retries: value }),
        () => ConcurrencyPolicy.optimistic({ backoffMs: value })
      ]) {
        expect(create).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
      }
    }
  )

  it('accepts zero and safe upper bounds while keeping preset locking modes precise', () => {
    for (const timeoutMs of [0, 1, Number.MAX_SAFE_INTEGER])
      expect(ConcurrencyPolicy.wait({ timeoutMs }).locking).toBe('pessimistic')
    for (const value of [0, 1, Number.MAX_SAFE_INTEGER])
      expect(ConcurrencyPolicy.optimistic({ retries: value, backoffMs: value }).locking).toBe(
        'optimistic'
      )
    expect(ConcurrencyPolicy.wait().name).toBe('wait')
    expect(ConcurrencyPolicy.fail().name).toBe('fail')
    expect(ConcurrencyPolicy.optimistic().name).toBe('optimistic')
    expectTypeOf(ConcurrencyPolicy.wait().locking).toEqualTypeOf<'pessimistic'>()
    expectTypeOf(ConcurrencyPolicy.fail().locking).toEqualTypeOf<'pessimistic'>()
    expectTypeOf(ConcurrencyPolicy.optimistic().locking).toEqualTypeOf<'optimistic'>()
  })

  it('stores defaults only in the original transaction owner and prioritizes authentic overrides', () => {
    /** Independent store identities cannot claim each other’s default registration. */
    const first = createBase()
    const second = createBase()
    const defaultPolicy = ConcurrencyPolicy.fail()
    const override = ConcurrencyPolicy.optimistic({ retries: 0 })
    createTransactionOwner(first, normalize, {
      defaultPolicy,
      concurrencyStages: { kind: StorageStageKind.concurrency, report: () => undefined }
    })
    createTransactionOwner(second, normalize)
    expect(resolveConcurrencyPolicy(first)).toBe(defaultPolicy)
    expect(resolveConcurrencyPolicy(first, override)).toBe(override)
    expect(resolveConcurrencyPolicy(second).name).toBe('wait')
    expect(resolveConcurrencyPolicy(second)).toBe(resolveConcurrencyPolicy(second))
    expect(() => resolveConcurrencyPolicy(createBase(), defaultPolicy)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => resolveConcurrencyPolicy(first, { ...defaultPolicy })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() =>
      createTransactionOwner(createBase(), normalize, { defaultPolicy: { ...defaultPolicy } })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('infers synchronous and asynchronous decisions while excluding incompatible fields', () => {
    const sync = defineConcurrencyPolicy({
      name: 'sync',
      locking: 'pessimistic',
      decide: (conflict) => {
        expectTypeOf(conflict).toEqualTypeOf<IConcurrencyConflict>()
        if (conflict.phase === 'acquire') return { action: 'wait', timeoutMs: 0 }
        return { action: 'reject' }
      }
    })
    const async = defineConcurrencyPolicy({
      name: 'async',
      locking: 'optimistic',
      decide: async (conflict) =>
        conflict.attempt < 2 ? { action: 'retry', delayMs: 0 } : { action: 'reject' }
    })
    expectTypeOf(sync.name).toEqualTypeOf<'sync'>()
    expectTypeOf(async.name).toEqualTypeOf<'async'>()
    /** Invalid declarations are compile-only and never execute policy callbacks. */
    function invalidTypes(): void {
      defineConcurrencyPolicy({
        name: 'bad',
        locking: 'pessimistic',
        // @ts-expect-error Decision action spelling is a closed union.
        decide: () => ({ action: 'skip' })
      })
      defineConcurrencyPolicy({
        name: 'bad',
        locking: 'pessimistic',
        // @ts-expect-error Wait decisions cannot carry retry delay fields.
        decide: () => ({ action: 'wait', delayMs: 1 })
      })
      const invalid: { action: 'reject'; timeoutMs: number } = { action: 'reject', timeoutMs: 1 }
      // @ts-expect-error Stored variables must also satisfy exclusive action fields.
      defineConcurrencyPolicy({ name: 'bad', locking: 'optimistic', decide: () => invalid })
    }
    void invalidTypes
    expectTypeOf(sync).toExtend<IConcurrencyPolicy>()
  })
})
