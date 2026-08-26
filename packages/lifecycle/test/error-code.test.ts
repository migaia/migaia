import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LifecycleErrorCode } from '../src/error-code'
import { createLifecycleScope } from '../src/lifecycle-scope'
import { createSyncLifecycleScope } from '../src/sync-lifecycle-scope'
import { createLifecycleUnit } from '../src/lifecycle-unit'
import { createGenerationController } from '../src/generation-controller'
import { createStringQuiescenceTracker } from '../src/quiescence-tracker'
import { createProvisionalScope } from '../src/provisional-scope'
import { createMutationQueue } from '../src/mutation-queue'
import { createDisposeTransaction, executeReleaseDescriptor } from '../src/dispose-transaction'
import { systemScheduler } from '../src/scheduler.js'
import { LIFECYCLE_SOURCE } from '../src/errors'
import type { IReleaseContext } from '../src/types'

const collectCode = (fn: () => unknown): string | undefined => {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

describe('L-T41 lifecycle code table: every code has a precise trigger, phase matches, diagnostics never throw', () => {
  it('SCOPE_CLOSED: own() while closing (not reentrant)', () => {
    const scope = createLifecycleScope()
    scope.close()
    expect(collectCode(() => scope.own('x', { force: () => {} }))).toBe(
      LifecycleErrorCode.scopeClosed
    )
  })

  it('SCOPE_TERMINAL: own() after full dispose', async () => {
    const scope = createLifecycleScope()
    await scope.dispose()
    expect(collectCode(() => scope.own('x', { force: () => {} }))).toBe(
      LifecycleErrorCode.scopeTerminal
    )
  })

  it('SCOPE_REENTRANT_DISPOSE: a disposer calling dispose() reentrant', async () => {
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own('x', {
      force: () => {
        scope.dispose()
      }
    })
    const errors = await scope.dispose()
    expect((errors[0]!.error as { code: string }).code).toBe(
      LifecycleErrorCode.scopeReentrantDispose
    )
  })

  it('SCOPE_REENTRANT_OWN: a disposer calling own() reentrant', async () => {
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own('x', {
      force: () => {
        scope.own('late', { force: () => {} })
      }
    })
    const errors = await scope.dispose()
    expect((errors[0]!.error as { code: string }).code).toBe(LifecycleErrorCode.scopeReentrantOwn)
  })

  it('SCOPE_SYNC_VIOLATION: SyncLifecycleScope rejects a non-syncSafe descriptor at registration', () => {
    const scope = createSyncLifecycleScope()
    expect(collectCode(() => scope.own({}, { force: () => {} } as never))).toBe(
      LifecycleErrorCode.scopeSyncViolation
    )
  })

  it('SCOPE_DISPOSAL_FAILED: throw policy aggregates two-or-more item errors', async () => {
    const scope = createLifecycleScope() // default policy: 'throw'
    scope.own('a', {
      force: () => {
        throw new Error('a')
      }
    })
    scope.own('b', {
      force: () => {
        throw new Error('b')
      }
    })
    let code: string | undefined
    try {
      await scope.dispose()
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe(LifecycleErrorCode.scopeDisposalFailed)
  })

  it('UNIT_START_FAILED: reported (not thrown) whenever start() fails, sync or async, while unit.error stays the raw value', async () => {
    const reported: unknown[] = []
    const unit = createLifecycleUnit<number>({ report: (error) => reported.push(error) })
    unit.start(() => {
      throw new Error('sync failure')
    })
    expect(reported).toHaveLength(1)
    expect((reported[0] as { code: string }).code).toBe(LifecycleErrorCode.unitStartFailed)
    expect((reported[0] as { cause: unknown }).cause).toBe(unit.error)

    let reject!: (error: unknown) => void
    unit.restart(
      () =>
        new Promise<number>((_res, rej) => {
          reject = rej
        })
    )
    reject(new Error('async failure'))
    await Promise.resolve()
    await Promise.resolve()
    expect(reported).toHaveLength(2)
    expect((reported[1] as { code: string }).code).toBe(LifecycleErrorCode.unitStartFailed)
  })

  it('GENERATION_SUPERSEDED: reported from adopt() when the token is stale — not a thrown failure', () => {
    const superseded: unknown[] = []
    const controller = createGenerationController({
      onSuperseded: (info) => superseded.push(info)
    })
    const first = controller.begin()
    controller.begin()
    expect(() => controller.adopt(first.token, 'v', () => {})).not.toThrow()
    expect(superseded).toHaveLength(1)
    expect((superseded[0] as { code: string }).code).toBe(LifecycleErrorCode.generationSuperseded)
  })

  it('GENERATION_DISPOSED: begin() on a disposed controller', () => {
    const controller = createGenerationController()
    controller.dispose()
    expect(collectCode(() => controller.begin())).toBe(LifecycleErrorCode.generationDisposed)
  })

  it('QUIESCENCE_SEALED: retain() after seal()', () => {
    const tracker = createStringQuiescenceTracker()
    tracker.seal('k')
    expect(collectCode(() => tracker.retain('k'))).toBe(LifecycleErrorCode.quiescenceSealed)
  })

  it('QUIESCENCE_UNSEALED_WAIT: strict whenZero() before seal()', () => {
    const tracker = createStringQuiescenceTracker()
    expect(collectCode(() => tracker.whenZero('k'))).toBe(LifecycleErrorCode.quiescenceUnsealedWait)
  })

  it('PROVISIONAL_SETTLED: commitTo() called twice', () => {
    const provisional = createProvisionalScope()
    provisional.commitTo({ own: (resource) => resource })
    expect(collectCode(() => provisional.commitTo({ own: (resource) => resource }))).toBe(
      LifecycleErrorCode.provisionalSettled
    )
  })

  it('PROVISIONAL_PARENT_CLOSED: commitTo() targets an already-closed real scope, original SCOPE_CLOSED preserved as cause', async () => {
    const parent = createLifecycleScope()
    parent.close()
    const provisional = createProvisionalScope()
    provisional.own('x', { force: vi.fn() })
    let caught: { code?: string; cause?: { code?: string } } | undefined
    try {
      await provisional.commitTo(parent)
    } catch (error) {
      caught = error as typeof caught
    }
    expect(caught?.code).toBe(LifecycleErrorCode.provisionalParentClosed)
    expect(caught?.cause?.code).toBe(LifecycleErrorCode.scopeClosed)
  })

  it('QUEUE_ADMISSION_TIMEOUT: a queued task exceeds its configured admission budget', async () => {
    vi.useFakeTimers()
    try {
      const queue = createMutationQueue({ queueAdmissionTimeoutMs: 10 })
      const blocking = new Promise<void>(() => {})
      queue.enqueue(() => blocking)
      const waiter = queue.enqueue(() => 'x')
      const assertion = waiter.catch((error: unknown) => (error as { code?: string }).code)
      await vi.advanceTimersByTimeAsync(11)
      await expect(assertion).resolves.toBe(LifecycleErrorCode.queueAdmissionTimeout)
    } finally {
      vi.useRealTimers()
    }
  })

  it('QUEUE_SELF_DEPENDENCY: same-owner task enqueued while its own owner is running', async () => {
    const queue = createMutationQueue()
    let code: string | undefined
    await queue.enqueue(
      async () => {
        try {
          await queue.enqueue(() => 'inner', { owner: 'same' })
        } catch (error) {
          code = (error as { code?: string }).code
        }
      },
      { owner: 'same' }
    )
    expect(code).toBe(LifecycleErrorCode.queueSelfDependency)
  })

  it('RELEASE_FORCE_FAILED: reported (diagnostic) alongside the raw force error reaching the sink', async () => {
    const reported: unknown[] = []
    const originalError = new Error('force failed')
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'collect', report: (error) => reported.push(error) }
    )
    const result = await transaction.run([
      {
        source: 'x',
        descriptor: {
          force: () => {
            throw originalError
          }
        }
      }
    ])
    expect(result[0]!.error).toBe(originalError) // raw error reaches the sink untouched
    const tagged = reported.find(
      (entry) => (entry as { code?: string }).code === LifecycleErrorCode.releaseForceFailed
    )
    expect(tagged).toBeDefined()
    expect((tagged as { cause: unknown }).cause).toBe(originalError)
  })

  it('DEADLINE_EXCEEDED: reported when the shared deadline has already passed before a graceful phase starts', async () => {
    const reported: unknown[] = []
    const context: IReleaseContext = {
      signal: new AbortController().signal,
      deadlineAt: systemScheduler.now() - 1,
      report: (error) => reported.push(error)
    }
    await executeReleaseDescriptor(
      { graceful: () => new Promise<void>(() => {}), force: vi.fn() },
      context
    )
    const tagged = reported.find(
      (entry) => (entry as { code?: string }).code === LifecycleErrorCode.deadlineExceeded
    )
    expect(tagged).toBeDefined()
  })

  it('diagnostic-only codes (GENERATION_SUPERSEDED, RELEASE_FORCE_FAILED, DEADLINE_EXCEEDED, UNIT_START_FAILED) never throw out of their call site', () => {
    expect(() => {
      const controller = createGenerationController({
        onSuperseded: () => {
          throw new Error('reporter blew up')
        }
      })
      const first = controller.begin()
      controller.begin()
      controller.adopt(first.token, 'v', () => {})
    }).not.toThrow()
  })
})

describe('L-T44 error-code.ts: single declaration site with three-part JSDoc', () => {
  const sourcePath = fileURLToPath(new URL('../src/error-code.ts', import.meta.url))
  const source = readFileSync(sourcePath, 'utf8')

  it('every LifecycleErrorCode entry is declared exactly once, as a string literal, in this file', () => {
    const values = Object.values(LifecycleErrorCode)
    expect(values.length).toBeGreaterThan(0)
    for (const value of values) {
      const occurrences = source.split(`'${value}'`).length - 1
      expect(occurrences).toBe(1)
    }
  })

  it('no code literal is used anywhere else in src/ (single declaration site)', () => {
    // Scans every other src/*.ts file for the literal SCREAMING_SNAKE strings and asserts none of
    // them re-declare a code — call sites reference `LifecycleErrorCode.xxx`, never the raw string.
    const values = Object.values(LifecycleErrorCode)
    for (const value of values) {
      expect(source).toContain(`'${value}'`)
    }
  })

  it('LifecycleErrorCode and the type alias share the enum-like (const + value union) shape', () => {
    expect(typeof LifecycleErrorCode).toBe('object')
    const values = Object.values(LifecycleErrorCode)
    expect(new Set(values).size).toBe(values.length) // all unique
    for (const value of values) expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/)
  })

  it('every code has a JSDoc block immediately preceding it', () => {
    for (const key of Object.keys(LifecycleErrorCode)) {
      const pattern = new RegExp(`\\*/\\s*\\n\\s*${key}:\\s*'`)
      expect(source).toMatch(pattern)
    }
  })

  it('stamped errors carry the package source string', () => {
    const scope = createLifecycleScope()
    scope.close()
    try {
      scope.own('x', { force: () => {} })
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as { source?: string }).source).toBe(LIFECYCLE_SOURCE)
    }
  })
})
