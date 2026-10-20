import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  createSyncStartedDisposalLedger,
  mergeCleanupResults,
  type ICleanupResult,
  LifecycleState,
  type IAbortController
} from '../src/index.js'
import { createAbortController } from '../src/abort.js'

describe('sync-started disposal ledger', () => {
  it('starts every callback synchronously and reaches terminal after seal and settlement', async () => {
    const ledger = createSyncStartedDisposalLedger()
    const order: string[] = []
    let resolve: (() => void) | undefined
    const pending = new Promise<void>((done) => {
      resolve = done
    })

    ledger.start('first', () => {
      order.push('first')
    })
    ledger.start('second', () => {
      order.push('second')
      return pending
    })
    expect(order).toEqual(['first', 'second'])
    const outcome = ledger.seal()
    expect(outcome.cleanupErrors).toEqual([])
    expect(ledger.lifecycle).toBe(LifecycleState.closing)
    resolve?.()
    await expect(outcome.physicalCompletion).resolves.toEqual({ cleanupErrors: [] })
    expect(ledger.lifecycle).toBe(LifecycleState.terminal)
  })

  it('keeps synchronous failures in the frozen synchronous snapshot and async failures in completion order', async () => {
    const ledger = createSyncStartedDisposalLedger()
    const first = new Error('sync')
    const second = new Error('async')
    ledger.start('sync', () => {
      throw first
    })
    ledger.start('async', () => Promise.reject(second))
    const outcome = ledger.seal()
    expect(outcome.cleanupErrors).toHaveLength(1)
    expect(outcome.cleanupErrors[0]?.error).toBe(first)
    await expect(outcome.physicalCompletion).resolves.toEqual({
      cleanupErrors: [{ source: 'async', error: second }]
    })
    await expect(mergeCleanupResults([outcome])).resolves.toEqual({
      cleanupErrors: [
        { source: 'sync', error: first },
        { source: 'async', error: second }
      ]
    })
    expect(ledger.seal()).toBe(outcome)
  })

  it('reads a thenable once and preserves its receiver', async () => {
    const ledger = createSyncStartedDisposalLedger()
    let reads = 0
    let receiver: unknown
    // This fixture intentionally exposes the Promise assimilation protocol to verify one read.
    const thenable = {
      // oxlint-disable-next-line unicorn/no-thenable
      get then() {
        reads++
        return function (this: unknown, done: () => void): void {
          // oxlint-disable-next-line typescript/no-this-alias
          receiver = this
          done()
        }
      }
    }
    ledger.start('thenable', () => thenable)
    const outcome = ledger.seal()
    await expect(outcome.physicalCompletion).resolves.toEqual({ cleanupErrors: [] })
    expect(reads).toBe(1)
    expect(receiver).toBe(thenable)
  })

  it('rejects start and seal reentrancy without freezing an incomplete snapshot', () => {
    const ledger = createSyncStartedDisposalLedger()
    let reentrant: unknown
    ledger.start('item', () => {
      try {
        ledger.seal()
      } catch (error) {
        reentrant = error
      }
    })
    expect(reentrant).toMatchObject({ code: 'SCOPE_REENTRANT_OWN' })
    const outcome = ledger.seal()
    expect(outcome.cleanupErrors).toEqual([])
  })

  it('merges foreign promises, captured thenables and rejected branches without losing errors', async () => {
    /** Keep exact error identities across realm and physical continuation boundaries. */
    const first = new Error('foreign logical')
    const late = new Error('foreign physical')
    const rejected = new Error('rejected branch')
    const last = new Error('thenable')
    const foreign = runInNewContext(
      'Promise.resolve({ cleanupErrors: [first], physicalCompletion: Promise.resolve({ cleanupErrors: [late] }) })',
      { first, late }
    ) as Promise<ICleanupResult>
    /** PromiseLike getters are captured by await exactly once, retaining the source receiver. */
    let reads = 0
    let receiver: unknown
    const thenable = {
      // oxlint-disable-next-line unicorn/no-thenable
      get then() {
        reads += 1
        return function (this: unknown, resolve: (result: ICleanupResult) => void) {
          // oxlint-disable-next-line typescript/no-this-alias
          receiver = this
          resolve({ cleanupErrors: [last] })
        }
      }
    } as unknown as PromiseLike<ICleanupResult>
    const merged = await mergeCleanupResults([foreign, Promise.reject(rejected), thenable])
    expect(merged.cleanupErrors).toEqual([first, late, rejected, last])
    expect(merged.cleanupErrors[0]).toBe(first)
    expect(merged.cleanupErrors[1]).toBe(late)
    expect(reads).toBe(1)
    expect(receiver).toBe(thenable)
    expect(Object.isFrozen(merged)).toBe(true)
    expect(Object.isFrozen(merged.cleanupErrors)).toBe(true)
  })
})

describe('native abort boundary', () => {
  it('fails closed when the host constructor is unavailable', () => {
    const globalObject = globalThis as { AbortController?: unknown }
    const original = globalObject.AbortController
    try {
      globalObject.AbortController = undefined
      expect(() => createAbortController()).toThrowError(
        expect.objectContaining({ code: 'ENV_UNSUPPORTED' })
      )
    } finally {
      globalObject.AbortController = original
    }
  })

  it('captures a native constructor for long-lived owners', () => {
    const original = (globalThis as { AbortController: unknown }).AbortController
    const captured = createAbortController()
    const host = (globalThis as { AbortController: new () => IAbortController }).AbortController
    expect(captured).toBeInstanceOf(host)
    ;(globalThis as { AbortController: unknown }).AbortController = original
  })
})
