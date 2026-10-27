/* oxlint-disable unicorn/no-thenable -- These fixtures distinguish callable and noncallable then properties. */
import { describe, expect, it, vi } from 'vitest'
import {
  assertVersionedEnvelope,
  StorageContractError,
  StorageContractErrorCode,
  type IMigrationStep
} from '@migaia/storage-contract'
import {
  createMigrationPlan,
  migrateEnvelope,
  migrateEnvelopeSync
} from '../src/authoring/migration.js'
import type { IAbortSignal } from '@migaia/utils/promise'

describe('migration plans', () => {
  it('snapshots one continuous range without enumerating absent versions', () => {
    /** Caller-owned steps are changed after plan creation to prove snapshot ownership. */
    const steps = { 2: (value: unknown) => [value, 2], 3: (value: unknown) => [value, 3] }
    /** Plan used by the public migration entry under test. */
    const plan = createMigrationPlan({
      version: 3,
      steps: steps as Readonly<Record<number, IMigrationStep>>
    })
    expect(plan.baseVersion).toBe(1)
    expect(Object.getPrototypeOf(plan.steps)).toBeNull()
    steps[2] = () => ['changed']
    expect(migrateEnvelopeSync(plan, { version: 1, state: 'old' })).toEqual([['old', 2], 3])
    expect(createMigrationPlan({ version: 3 }).baseVersion).toBe(3)
    expect(createMigrationPlan({ version: Number.MAX_SAFE_INTEGER }).baseVersion).toBe(
      Number.MAX_SAFE_INTEGER
    )
    expect(createMigrationPlan({ version: 0 }).baseVersion).toBe(0)
  })

  /** Invalid keys share one valid callback so each fixture isolates key admission. */
  const validStep: IMigrationStep = (value) => value
  it.each([
    { 1: validStep, 3: validStep },
    { 4: validStep },
    { 0: validStep },
    { '1.5': validStep },
    { '01': validStep },
    { '+1': validStep },
    { '1e0': validStep },
    { 1: validStep, '01': validStep, 3: validStep },
    { [Symbol('step')]: validStep }
  ])('rejects discontinuous or noncanonical ranges %#', (steps) => {
    expect(() =>
      createMigrationPlan({ version: 3, steps: steps as Readonly<Record<number, IMigrationStep>> })
    ).toThrow(expect.objectContaining({ code: StorageContractErrorCode.migrationGap }))
  })

  it.each([
    { version: -1 },
    { version: Number.MAX_SAFE_INTEGER + 1 },
    { version: 1, steps: [] },
    { version: 1, steps: { 1: 1 } },
    { version: 1, reset: 1 },
    { version: 1, reset: () => ({}), steps: {} }
  ])('rejects malformed plan options %#', (options) => {
    expect(() => createMigrationPlan(options as never)).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument })
    )
  })

  it('resets once without enumerating the version span', async () => {
    /** Counts reset invocations without expanding the supported version interval. */
    const reset = vi.fn(() => ({}))
    /** Plan used by the public migration entry under test. */
    const plan = createMigrationPlan({ version: Number.MAX_SAFE_INTEGER, reset })
    expect(plan.baseVersion).toBe(0)
    expect(Object.keys(plan.steps)).toEqual([])
    /** First reset result must not be shared with a later invocation. */
    const first = migrateEnvelopeSync(plan, { version: 0, state: {} })
    /** Second reset result proves that reset creates a fresh state. */
    const second = await migrateEnvelope(plan, { version: 1, state: {} })
    expect(first).not.toBe(second)
    expect(reset).toHaveBeenCalledTimes(2)
    expect(reset).toHaveBeenNthCalledWith(1)
    /** Current-version state must pass through without replacement. */
    const current = {}
    expect(migrateEnvelopeSync(plan, { version: plan.version, state: current })).toBe(current)
    expect(reset).toHaveBeenCalledTimes(2)
  })
})

describe('migration execution', () => {
  it('shares version bounds, ordered steps and unchanged-state behavior', async () => {
    /** Records the order and version context of each actual step. */
    const calls: unknown[] = []
    /** Shared callback exposes each transition through the call record. */
    const step: IMigrationStep = (value, context) => {
      calls.push(context)
      return [...(value as number[]), context.toVersion]
    }
    /** Plan used by the public migration entry under test. */
    const plan = createMigrationPlan({ version: 3, steps: { 1: step, 2: step, 3: step } })
    expect(migrateEnvelopeSync(plan, { version: 0, state: [] })).toEqual([1, 2, 3])
    expect(calls).toEqual([
      { fromVersion: 0, toVersion: 1 },
      { fromVersion: 1, toVersion: 2 },
      { fromVersion: 2, toVersion: 3 }
    ])
    calls.length = 0
    expect(await migrateEnvelope(plan, { version: 0, state: [] })).toEqual([1, 2, 3])
    expect(calls).toHaveLength(3)
    /** Caller-owned state used to prove reference and mutation behavior. */
    const state = {}
    expect(migrateEnvelopeSync(plan, { version: 3, state })).toBe(state)
    expect(await migrateEnvelope(plan, { version: 3, state })).toBe(state)
    expect(() => migrateEnvelopeSync(plan, { version: 4, state })).toThrow(
      expect.objectContaining({
        code: StorageContractErrorCode.versionUnsupported,
        cause: undefined
      })
    )
    await expect(migrateEnvelope(plan, { version: 4, state })).rejects.toMatchObject({
      code: StorageContractErrorCode.versionUnsupported
    })
    /** Plan with a restricted lower version boundary. */
    const bounded = createMigrationPlan({ version: 3, steps: { 2: step, 3: step } })
    expect(() => migrateEnvelopeSync(bounded, { version: 0, state })).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.versionUnsupported })
    )
    await expect(migrateEnvelope(bounded, { version: 0, state })).rejects.toMatchObject({
      code: StorageContractErrorCode.versionUnsupported
    })
  })

  it('keeps the first failure, version details and caller-owned mutations', async () => {
    /** Original failure whose exact identity must remain reachable. */
    const original = new Error('step failed')
    /** Later step must remain untouched after failure or cancellation. */
    const last = vi.fn(() => 'never')
    /** Caller-owned state used to prove reference and mutation behavior. */
    const state = { count: 0 }
    /** Plan used by the public migration entry under test. */
    const plan = createMigrationPlan({
      version: 3,
      steps: {
        1: (value: unknown) => value,
        2: (value: unknown) => {
          ;(value as typeof state).count += 1
          throw original
        },
        3: last
      }
    })
    /** Execution must not rewrite the caller's persisted version. */
    const envelope = { version: 0, state }
    for (const run of [
      () => migrateEnvelopeSync(plan, envelope),
      () => migrateEnvelope(plan, envelope)
    ]) {
      try {
        await run()
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(StorageContractError)
        expect(error).toMatchObject({
          code: StorageContractErrorCode.migrationFailed,
          cause: original,
          fromVersion: 1,
          toVersion: 2
        })
        expect(Object.isFrozen(error)).toBe(true)
      }
    }
    expect(state.count).toBe(2)
    expect(last).not.toHaveBeenCalled()
    expect(envelope.version).toBe(0)
  })

  it('rejects synchronous thenables and observes their late rejection once', async () => {
    /** Deferred rejection lets the test observe behavior after the entry has settled. */
    let reject!: (cause: unknown) => void
    /** Observed public result for this migration invocation. */
    const result = new Promise((_resolve, rejectResult) => {
      reject = rejectResult
    })
    /** Collects observation or utility failures without affecting the migration result. */
    const report = vi.fn(() => undefined)
    /** Plan used by the public migration entry under test. */
    const plan = createMigrationPlan({ version: 1, steps: { 1: () => result } })
    expect(() =>
      migrateEnvelopeSync(plan as never, { version: 0, state: {} }, { observe: { report } })
    ).toThrow(
      expect.objectContaining({
        code: StorageContractErrorCode.migrationFailed,
        cause: expect.any(TypeError)
      })
    )
    /** Original failure whose exact identity must remain reachable. */
    const original = new Error('late rejection')
    reject(original)
    await vi.waitFor(() => expect(report).toHaveBeenCalledExactlyOnceWith(original))
  })

  it('checks cancellation before equal-version and reset fast paths', async () => {
    /** Owns the cancellation signal borrowed by the migration entry. */
    const controller = new AbortController()
    /** Exact cancellation reason must remain reachable through the contract error. */
    const reason = new Error('cancelled')
    controller.abort(reason)
    /** Counts reset invocations without expanding the supported version interval. */
    const reset = vi.fn(() => ({}))
    for (const plan of [
      createMigrationPlan({ version: 1 }),
      createMigrationPlan({ version: 1, reset })
    ]) {
      await expect(
        migrateEnvelope(plan, { version: 1, state: {} }, { signal: controller.signal })
      ).rejects.toMatchObject({ code: StorageContractErrorCode.aborted, cause: reason })
    }
    await expect(
      migrateEnvelope(
        createMigrationPlan({ version: 1, reset }),
        { version: 0, state: {} },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: StorageContractErrorCode.aborted })
    expect(reset).not.toHaveBeenCalled()
  })

  it('keeps abort listener admission and cleanup with the shared utility', async () => {
    /** Exact cancellation reason must remain reachable through the contract error. */
    const reason = new Error('cancel during listener setup')
    /** Shared callback exposes each transition through the call record. */
    const step = vi.fn(() => ({}))
    /** Signal state changes during listener registration to exercise the admission race. */
    let aborted = false
    /** Structural signal drives listener admission without introducing a second abort runtime. */
    const signal: IAbortSignal = {
      get aborted() {
        return aborted
      },
      reason,
      addEventListener(_name, listener) {
        aborted = true
        listener()
      },
      removeEventListener() {}
    }
    /** Plan used by the public migration entry under test. */
    const plan = createMigrationPlan({ version: 1, steps: { 1: step } })
    await expect(
      migrateEnvelope(plan, { version: 0, state: {} }, { signal })
    ).rejects.toMatchObject({ code: StorageContractErrorCode.aborted, cause: reason })
    expect(step).not.toHaveBeenCalled()
    /** Listener-registration failure retained in the utility-to-contract cause chain. */
    const setup = new Error('setup failed')
    await expect(
      migrateEnvelope(
        plan,
        { version: 0, state: {} },
        {
          signal: {
            aborted: false,
            addEventListener() {
              throw setup
            },
            removeEventListener() {}
          }
        }
      )
    ).rejects.toMatchObject({
      code: StorageContractErrorCode.invalidArgument,
      cause: { cause: setup }
    })
    /** Listener-cleanup failure must be reported without replacing successful recovery. */
    const cleanup = new Error('cleanup failed')
    /** Collects observation or utility failures without affecting the migration result. */
    const report = vi.fn()
    await expect(
      migrateEnvelope(
        plan,
        { version: 0, state: {} },
        {
          report,
          signal: {
            aborted: false,
            addEventListener() {},
            removeEventListener() {
              throw cleanup
            }
          }
        }
      )
    ).resolves.toEqual({})
    expect(report).toHaveBeenCalledWith(cleanup, expect.objectContaining({ phase: 'cleanup' }))
  })

  it('stops later steps on abort and reports a late non-cancellation rejection', async () => {
    /** Deferred rejection lets the test observe behavior after the entry has settled. */
    let reject!: (cause: unknown) => void
    /** Unsettled step or observer result separates migration completion from late rejection. */
    const pending = new Promise((_resolve, rejectResult) => {
      reject = rejectResult
    })
    /** Owns the cancellation signal borrowed by the migration entry. */
    const controller = new AbortController()
    /** Later step must remain untouched after failure or cancellation. */
    const last = vi.fn()
    /** Collects observation or utility failures without affecting the migration result. */
    const report = vi.fn()
    /** Plan used by the public migration entry under test. */
    const plan = createMigrationPlan({
      version: 3,
      steps: { 1: () => 1, 2: () => pending, 3: last }
    })
    /** Observed public result for this migration invocation. */
    const result = migrateEnvelope(
      plan,
      { version: 0, state: {} },
      { signal: controller.signal, report }
    )
    await Promise.resolve()
    await Promise.resolve()
    /** Exact cancellation reason must remain reachable through the contract error. */
    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(result).rejects.toMatchObject({
      code: StorageContractErrorCode.aborted,
      cause: reason
    })
    /** Original failure whose exact identity must remain reachable. */
    const original = new Error('late step failure')
    reject(original)
    await vi.waitFor(() =>
      expect(report).toHaveBeenCalledWith(
        original,
        expect.objectContaining({ phase: 'late-rejection' })
      )
    )
    expect(last).not.toHaveBeenCalled()
  })

  it('uses the same failure policy for reset and rejects async plans statically', async () => {
    /** Original failure whose exact identity must remain reachable. */
    const original = new Error('reset failed')
    /** Plan used by the public migration entry under test. */
    const plan = createMigrationPlan({
      version: 2,
      reset: () => {
        throw original
      }
    })
    expect(() => migrateEnvelopeSync(plan, { version: 0, state: {} })).toThrow(
      expect.objectContaining({ cause: original, fromVersion: 0, toVersion: 2 })
    )
    await expect(migrateEnvelope(plan, { version: 0, state: {} })).rejects.toMatchObject({
      cause: original,
      fromVersion: 0,
      toVersion: 2
    })
    /** Known asynchronous step plan must be rejected by the synchronous type boundary. */
    const asynchronous = createMigrationPlan({ version: 1, steps: { 1: async () => 1 } })
    /** Known asynchronous reset plan must be rejected by the synchronous type boundary. */
    const asynchronousReset = createMigrationPlan({ version: 1, reset: async () => 1 })
    /** Compile-only checks keep asynchronous plans outside the sync entry. */
    function assertMigrationTypes(): void {
      // @ts-expect-error Known asynchronous steps cannot enter synchronous execution.
      migrateEnvelopeSync(asynchronous, { version: 0, state: {} })
      // @ts-expect-error Known asynchronous resets cannot enter synchronous execution.
      migrateEnvelopeSync(asynchronousReset, { version: 0, state: {} })
      // @ts-expect-error Validation does not turn unknown data into a chosen business schema.
      assertVersionedEnvelope<{ name: string }>({} as unknown)
    }
    void assertMigrationTypes
    expect(
      migrateEnvelopeSync(createMigrationPlan({ version: 1, steps: { 1: () => ({ then: 1 }) } }), {
        version: 0,
        state: {}
      })
    ).toEqual({ then: 1 })
    await expect(migrateEnvelope(asynchronousReset, { version: 0, state: {} })).resolves.toBe(1)
  })
})

describe('migration step observation', () => {
  it('keeps before/step/after order without waiting for observers', async () => {
    /** Records before, actual step and after order without awaiting observer work. */
    const events: string[] = []
    /** Deferred rejection lets the test observe behavior after the entry has settled. */
    let reject!: (cause: unknown) => void
    /** Unsettled step or observer result separates migration completion from late rejection. */
    const pending = new Promise<void>((_resolve, rejectResult) => {
      reject = rejectResult
    })
    /** Collects observation or utility failures without affecting the migration result. */
    const report = vi.fn(() => undefined)
    /** Plan used by the public migration entry under test. */
    const plan = createMigrationPlan({
      version: 1,
      steps: {
        1: () => {
          events.push('step')
          return 'value'
        }
      }
    })
    /** Observation-only callbacks cannot veto or delay a migration step. */
    const observe = {
      beforeStep: () => {
        events.push('before')
        return pending
      },
      afterStep: () => {
        events.push('after')
      },
      report
    }
    expect(migrateEnvelopeSync(plan, { version: 0, state: {} }, { observe })).toBe('value')
    expect(events).toEqual(['before', 'step', 'after'])
    reject(new Error('observer failed'))
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    events.length = 0
    await expect(
      migrateEnvelope(
        plan,
        { version: 0, state: {} },
        {
          observe: {
            beforeStep: async () => {
              events.push('before')
            },
            afterStep: () => {
              events.push('after')
            },
            report
          }
        }
      )
    ).resolves.toBe('value')
    expect(events).toEqual(['before', 'step', 'after'])
  })

  it.each(['beforeStep', 'afterStep'] as const)(
    'reports %s failures without changing the result',
    async (phase) => {
      for (const original of [
        new Error('observer failed'),
        new StorageContractError(StorageContractErrorCode.invalidArgument),
        { source: 'storage.contract', code: 'MIGRATION_FAILED' }
      ]) {
        /** Collects observation or utility failures without affecting the migration result. */
        const report = vi.fn(() => undefined)
        /** Plan used by the public migration entry under test. */
        const plan = createMigrationPlan({ version: 1, steps: { 1: () => 1 } })
        expect(
          migrateEnvelopeSync(
            plan,
            { version: 0, state: {} },
            {
              observe: {
                [phase]: () => {
                  throw original
                },
                report
              }
            }
          )
        ).toBe(1)
        expect(report).toHaveBeenCalledExactlyOnceWith(original)
        await expect(
          migrateEnvelope(
            plan,
            { version: 0, state: {} },
            { observe: { [phase]: () => Promise.reject(original), report } }
          )
        ).resolves.toBe(1)
        await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(2))
      }
    }
  )

  it('emits no steps for reset or current versions', () => {
    /** Counts step events; reset and unchanged versions must not emit any. */
    const before = vi.fn()
    /** Counts reset invocations without expanding the supported version interval. */
    const reset = createMigrationPlan({ version: 1, reset: () => 1 })
    migrateEnvelopeSync(reset, { version: 0, state: {} }, { observe: { beforeStep: before } })
    migrateEnvelopeSync(reset, { version: 1, state: {} }, { observe: { beforeStep: before } })
    expect(before).not.toHaveBeenCalled()
  })
})
