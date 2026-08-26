/* oxlint-disable unicorn/no-thenable -- 对抗夹具刻意构造 hostile then getter 以验证单次探测语义 */
import { describe, expect, it, vi } from 'vitest'
import { createProvisionalScope } from '../src/provisional-scope'
import { createLifecycleUnit } from '../src/lifecycle-unit'
import { createSyncLifecycleScope } from '../src/sync-lifecycle-scope'
import { createGenerationController } from '../src/generation-controller'
import { systemScheduler, createManualScheduler } from '../src/scheduler'
import { LifecycleErrorCode } from '../src/error-code'
import { assimilateCapturedThen, probeThenable } from '../src/errors'
import type { ILifecycleOwner } from '../src/types'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('AF-T1 ProvisionalScope partial commit (fire-and-forget → awaited compensation)', () => {
  it('awaits suffix cleanup, keeps the parent error primary, and exposes cleanup failure via a frozen errors array', async () => {
    const transferredToParent: string[] = []
    const released: string[] = []
    let callCount = 0
    const parent: ILifecycleOwner = {
      own(resource) {
        callCount += 1
        if (callCount > 1) throw new Error('parent rejected')
        transferredToParent.push(resource as string)
        return resource
      }
    }
    const provisional = createProvisionalScope()
    provisional.own('a', {
      force: () => {
        transferredToParent.push('a-leaked')
      }
    })
    const cleanupError = new Error('cleanup boom')
    provisional.own('b', {
      force: async () => {
        await Promise.resolve()
        released.push('b')
      }
    })
    provisional.own('c', {
      force: async () => {
        await Promise.resolve()
        released.push('c')
        throw cleanupError
      }
    })

    let settled = false
    let rejection: (Error & { errors?: readonly unknown[] }) | undefined
    const committed = provisional.commitTo(parent)
    void committed.then(
      () => {
        settled = true
      },
      (error: unknown) => {
        settled = true
        rejection = error as Error & { errors?: readonly unknown[] }
      }
    )

    // The async suffix cleanup must not have run yet: commitTo returned a pending Promise.
    expect(settled).toBe(false)
    expect(released).toEqual([])

    await committed.catch(() => {})
    await flush()

    // Exactly one owner per item: 'a' went to parent; 'b'/'c' were released by the provisional scope.
    expect(transferredToParent).toEqual(['a'])
    expect(released.sort()).toEqual(['b', 'c'])
    // The parent refusal stays primary, and the cleanup failure is reachable (frozen errors array).
    expect(rejection).toBeInstanceOf(Error)
    expect(rejection?.message).toBe('parent rejected')
    expect(rejection?.errors).toHaveLength(1)
    expect(rejection?.errors?.[0]).toBe(cleanupError)
    expect(Object.isFrozen(rejection?.errors)).toBe(true)
  })
})

describe('AF-T2 LifecycleUnit thenable single probe', () => {
  it('reads a hostile then getter exactly once and applies the captured then', async () => {
    let reads = 0
    const unit = createLifecycleUnit<number>()
    unit.start(
      () =>
        ({
          get then() {
            reads += 1
            return (resolve: (value: number) => void) => resolve(42)
          }
        }) as never
    )
    expect(reads).toBe(1)
    await flush()
    expect(unit.state).toBe('loaded')
    expect(unit.value).toBe(42)
  })

  it('surfaces a then-getter failure as a failed unit instead of swallowing it', () => {
    const getterError = new Error('then getter boom')
    const unit = createLifecycleUnit<number>()
    unit.start(
      () =>
        ({
          get then() {
            throw getterError
          }
        }) as never
    )
    expect(unit.state).toBe('failed')
    expect(unit.error).toBe(getterError)
  })
})

describe('AF-T3 scheduler input validation', () => {
  it('systemScheduler.schedule rejects NaN/Infinity/negative delay with a tagged RangeError', () => {
    for (const delay of [NaN, Infinity, -Infinity, -1]) {
      let thrown: unknown
      try {
        systemScheduler.schedule(() => {}, delay)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(RangeError)
      expect((thrown as { code?: unknown }).code).toBe(LifecycleErrorCode.invalidOption)
    }
  })

  it('manual scheduler rejects a backward/negative/invalid advance and now() is monotonic', () => {
    const scheduler = createManualScheduler()
    for (const ms of [NaN, Infinity, -Infinity, -1]) {
      expect(() => scheduler.advance(ms)).toThrowError(RangeError)
    }
    expect(scheduler.now()).toBe(0)
    scheduler.advance(5)
    expect(scheduler.now()).toBe(5)
    scheduler.advance(0)
    expect(scheduler.now()).toBe(5)
  })

  it('manual scheduler schedule rejects invalid delay', () => {
    const scheduler = createManualScheduler()
    expect(() => scheduler.schedule(() => {}, NaN)).toThrowError(RangeError)
    expect(() => scheduler.schedule(() => {}, -1)).toThrowError(RangeError)
  })
})

describe('AF-T13 SyncLifecycleScope hostile then getter', () => {
  it('getter failure is attributed to the item and later resources still release', () => {
    const scope = createSyncLifecycleScope({ errorPolicy: 'collect' })
    const released: string[] = []
    const getterError = new Error('then getter boom')
    scope.own('a', {
      syncSafe: true,
      force: () =>
        ({
          get then() {
            throw getterError
          }
        }) as never
    })
    scope.own('b', {
      syncSafe: true,
      force: () => {
        released.push('b')
      }
    })
    const errors = scope.dispose()
    expect(released).toEqual(['b'])
    expect(errors.some((entry) => entry.error === getterError)).toBe(true)
  })
})

describe('AF-T14/AF-T15 generation timeout/parent abort invalidates token', () => {
  it('timeout aborts the signal and invalidates the token so adopt() releases', () => {
    const scheduler = createManualScheduler()
    const controller = createGenerationController({ scheduler })
    const request = controller.begin({ timeoutMs: 10 })
    expect(controller.isCurrent(request.token)).toBe(true)
    scheduler.advance(10)
    expect(request.signal.aborted).toBe(true)
    expect(controller.isCurrent(request.token)).toBe(false)
    let released = false
    expect(
      controller.adopt(request.token, 'v', () => {
        released = true
      })
    ).toBe(false)
    expect(released).toBe(true)
  })

  it('parent already aborted invalidates immediately and leaves no pending timer', () => {
    const scheduler = createManualScheduler()
    const parent = new AbortController()
    parent.abort('closed')
    const controller = createGenerationController({ scheduler, parentSignal: parent.signal })
    const request = controller.begin({ timeoutMs: 10 })
    expect(request.signal.aborted).toBe(true)
    expect(controller.isCurrent(request.token)).toBe(false)
  })
})

describe('AF-T16/AF-T17 ProvisionalScope shared settle + listener cleanup', () => {
  it('AF-T16: concurrent rollback() settles with the same release (released once)', async () => {
    const provisional = createProvisionalScope()
    let releases = 0
    let resolveRelease!: () => void
    provisional.own('a', {
      force: async () => {
        releases += 1
        await new Promise<void>((resolve) => (resolveRelease = resolve))
      }
    })
    const first = provisional.rollback()
    const second = provisional.rollback()
    let firstSettled = false
    let secondSettled = false
    void first.then(() => (firstSettled = true))
    void second.then(() => (secondSettled = true))
    await Promise.resolve()
    // 释放仍被阻塞，两次 rollback 都未提前完成。
    expect(firstSettled).toBe(false)
    expect(secondSettled).toBe(false)
    resolveRelease()
    await Promise.all([first, second])
    expect(releases).toBe(1)
  })

  it('AF-T17: parent abort listener is removed after rollback settle', async () => {
    const parent = new AbortController()
    const removeSpy = vi.spyOn(parent.signal, 'removeEventListener')
    const provisional = createProvisionalScope({ parentSignal: parent.signal })
    provisional.own('a', { force: () => {} })
    await provisional.rollback()
    expect(removeSpy).toHaveBeenCalled()
    removeSpy.mockRestore()
  })
})

describe('AF-T23 manual scheduler recursive due flush', () => {
  it('a callback scheduling a zero-delay task is flushed in the same advance', () => {
    const scheduler = createManualScheduler()
    const order: string[] = []
    scheduler.schedule(() => {
      order.push('first')
      scheduler.schedule(() => order.push('second'), 0)
    }, 1)
    scheduler.advance(1)
    expect(order).toEqual(['first', 'second'])
  })
})

describe('AF-T26/AF-T27 lifecycle canonical probe + rollback identity', () => {
  it('AF-T26: isThenable is no longer a public export', async () => {
    const publicApi = (await import('../src/index.js')) as Record<string, unknown>
    expect(publicApi.isThenable).toBeUndefined()
  })

  it('AF-T27: concurrent rollback() returns the same Promise object', async () => {
    const provisional = createProvisionalScope()
    let resolveRelease!: () => void
    provisional.own('a', {
      force: async () => {
        await new Promise<void>((resolve) => (resolveRelease = resolve))
      }
    })
    const first = provisional.rollback()
    const second = provisional.rollback()
    expect(second).toBe(first)
    resolveRelease()
    await Promise.all([first, second])
  })
})

describe('AF-T34 reflective receiver-binding boundary (assimilateCapturedThen)', () => {
  it('invokes the captured then with the thenable as receiver (Promise/A+)', async () => {
    const thenable = {
      get then() {
        return function (this: unknown, resolve: (value: unknown) => void) {
          expect(this).toBe(thenable)
          resolve('ok')
        }
      }
    }
    const probe = probeThenable(thenable)
    expect(probe.kind).toBe('thenable')
    if (probe.kind !== 'thenable') return
    await expect(assimilateCapturedThen(probe.thenFn, thenable)).resolves.toBe('ok')
  })

  it('rejects with the synchronous throw from the captured then call', async () => {
    const syncError = new Error('then threw synchronously')
    const thenable = {
      get then() {
        return function () {
          throw syncError
        }
      }
    }
    const probe = probeThenable(thenable)
    expect(probe.kind).toBe('thenable')
    if (probe.kind !== 'thenable') return
    await expect(assimilateCapturedThen(probe.thenFn, thenable)).rejects.toBe(syncError)
  })

  it('rejects with an asynchronous rejection from the captured then call', async () => {
    const asyncError = new Error('then rejected asynchronously')
    const thenable = {
      get then() {
        return function (_resolve: unknown, reject: (reason?: unknown) => void) {
          reject(asyncError)
        }
      }
    }
    const probe = probeThenable(thenable)
    expect(probe.kind).toBe('thenable')
    if (probe.kind !== 'thenable') return
    await expect(assimilateCapturedThen(probe.thenFn, thenable)).rejects.toBe(asyncError)
  })

  it('probeThenable surfaces a hostile then getter as a failed probe after exactly one read', () => {
    let reads = 0
    const getterError = new Error('then getter boom')
    const hostile = {
      get then() {
        reads += 1
        throw getterError
      }
    }
    const probe = probeThenable(hostile)
    expect(probe.kind).toBe('failed')
    if (probe.kind !== 'failed') return
    expect(probe.error).toBe(getterError)
    expect(reads).toBe(1)
  })
})
