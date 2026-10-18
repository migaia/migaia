import { describe, expect, it, vi } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import {
  createErrorCollector,
  createGenerationController,
  createProvisionalScope
} from '../src/index.js'
import { createLifecycleFailure } from '../src/errors.js'
import { snapshotScheduler } from '../src/scheduler-entry.js'

describe('lifecycle audited error observation', () => {
  it('D-03 requires a reporter at the public collector entry', () => {
    for (const policy of ['report', 'firstError'] as const)
      expect(() => createErrorCollector(policy, undefined)).toThrowError(
        expect.objectContaining({ source: '@migaia/lifecycle', code: 'INVALID_OPTION' })
      )
  })

  it('D-04 annotates admitted scheduler calls without changing native identity', () => {
    /** Clock, registration and deferred calls are supported public scheduler operations. */
    const failure = new RangeError('scheduler failed')
    /** Snapshot retains the captured receiver and the exact native failure. */
    const scheduler = snapshotScheduler({
      now: () => {
        throw failure
      },
      schedule: () => {
        throw failure
      },
      defer: () => {
        throw failure
      }
    })!
    for (const run of [
      () => scheduler.now(),
      () => scheduler.schedule(() => undefined, 1),
      () => scheduler.defer?.(() => undefined)
    ])
      expect(run).toThrow(failure)
    expect(failure).toMatchObject({ source: '@migaia/lifecycle', code: 'INVALID_OPTION' })
  })

  it('D-05 rejects provisional detach failure after releasing every resource', async () => {
    /** Listener release failure must enter rollback settlement, not an abandoned admission array. */
    const failure = new Error('parent listener removal')
    /** Every owned resource still releases even when detaching its cancellation parent fails. */
    const release = vi.fn()
    /** Structural cancellation source deliberately fails only during cleanup. */
    const scope = createProvisionalScope({
      parentSignal: {
        aborted: false,
        addEventListener: () => undefined,
        removeEventListener: () => {
          throw failure
        }
      }
    })
    scope.own({}, { force: release })
    await expect(scope.rollback()).rejects.toSatisfy((error: unknown) =>
      walkErrorCauses(error).includes(failure)
    )
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('D-05 reports parent-driven generation cleanup after admission ends', () => {
    /** Native callbacks have no awaiting caller; the configured reporter owns cleanup failures. */
    const failure = new Error('parent removal')
    /** Captured callback models supported structural signal dispatch. */
    let abort!: () => void
    /** Parent state changes before dispatch, as with AbortSignal. */
    let aborted = false
    /** Retained failures prove original identity, beyond counting reports. */
    const reports: unknown[] = []
    /** Cleanup and token invalidation share the existing generation owner. */
    const generations = createGenerationController({
      report: (error) => reports.push(error),
      parentSignal: {
        get aborted() {
          return aborted
        },
        reason: 'stop',
        addEventListener: (_type, listener) => {
          abort = listener
        },
        removeEventListener: () => {
          throw failure
        }
      }
    })
    /** This generation must lose commit authority despite cleanup failure. */
    const request = generations.begin()
    aborted = true
    abort()
    expect(generations.isCurrent(request.token)).toBe(false)
    expect(request.signal.aborted).toBe(true)
    expect(reports.some((error) => walkErrorCauses(error).includes(failure))).toBe(true)
    generations.dispose()
  })

  it('D-06 retains the original thrown value when diagnostic getters fail', () => {
    /** Diagnostic accessor failure is secondary to the hostile thrown object itself. */
    const getterFailure = new Error('message getter')
    /** Factory must never replace this original with its message getter failure. */
    const original = {
      get message() {
        throw getterFailure
      }
    }
    /** Coded fallback keeps both failures reachable. */
    const wrapped = createLifecycleFailure('INVALID_OPTION', 'fallback', original)
    expect(wrapped.source).toBe('@migaia/lifecycle')
    expect(wrapped.code).toBe('INVALID_OPTION')
    expect(wrapped.cause).toBe(original)
    expect(walkErrorCauses(wrapped).includes(original)).toBe(true)
    expect(walkErrorCauses(wrapped).includes(getterFailure)).toBe(true)
  })

  it('D-09 observes asynchronous onSuperseded failure through the existing reporter', async () => {
    /** Nominal void observers may be async under the public TypeScript contract. */
    const failure = new Error('superseded observer')
    /** Explicit reporter must observe secondary failure after adopt returns. */
    const reports: unknown[] = []
    /** Only the existing observer needs rejection observation. */
    const generations = createGenerationController({
      onSuperseded: async () => {
        throw failure
      },
      report: (error) => reports.push(error)
    })
    /** Stale adoption invokes the diagnostic observer. */
    const request = generations.begin()
    generations.supersede()
    expect(generations.adopt(request.token, {}, () => undefined)).toBe(false)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    expect(reports.some((error) => walkErrorCauses(error).includes(failure))).toBe(true)
    generations.dispose()
  })

  it('D-10 annotates unclassified release failures and preserves foreign coded errors', () => {
    /** A single native disposer failure needs package identity without object replacement. */
    const original = new TypeError('release')
    /** Policy retains the same native object and stack. */
    const collector = createErrorCollector('throw', undefined)
    collector.add('item', original)
    expect(() => collector.finalize('release failed')).toThrow(original)
    expect(original).toMatchObject({ source: '@migaia/lifecycle', code: 'SCOPE_DISPOSAL_FAILED' })
    /** Valid foreign semantic identity must never be rewritten by lifecycle policy. */
    const foreign = Object.assign(new Error('foreign'), {
      source: '@migaia/utils',
      code: 'INVALID_ARGUMENT'
    })
    /** Collection keeps the exact foreign value. */
    const collecting = createErrorCollector('collect', undefined)
    collecting.add('item', foreign)
    expect(collecting.finalize('collect')[0]?.error).toBe(foreign)
    expect(foreign.source).toBe('@migaia/utils')
  })
})
