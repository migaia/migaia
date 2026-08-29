import { describe, expect, it } from 'vitest'
import {
  createDisposeTransaction,
  createLifecycleScope,
  createManualScheduler,
  createSyncLifecycleScope,
  LifecycleErrorCode
} from '../src/index.js'
import type { IReleaseContext } from '../src/index.js'

describe('disposer context owner-join contract', () => {
  it('DC-T01: rejects synchronous and suspended owner joins with the package error code', async () => {
    const failures: unknown[] = []
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own('sync', {
      force: (context) => {
        try {
          context.disposer!.join()
        } catch (error) {
          failures.push(error)
        }
      }
    })
    scope.own('suspended', {
      force: async (context) => {
        await Promise.resolve()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        try {
          context.disposer!.join()
        } catch (error) {
          failures.push(error)
        }
      }
    })

    await expect(scope.dispose()).resolves.toEqual([])
    expect(failures).toHaveLength(2)
    for (const failure of failures) {
      expect(failure).toMatchObject({
        source: '@migaia/lifecycle',
        code: LifecycleErrorCode.scopeReentrantDispose
      })
      expect((failure as Error).stack).toBeTruthy()
    }
  })

  it('DC-T01: keeps join fail-fast through multiple microtasks, a Promise chain, nested helper and timer', async () => {
    const failures: unknown[] = []
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    const capture = (context: IReleaseContext): void => {
      try {
        context.disposer!.join()
      } catch (error) {
        failures.push(error)
      }
    }
    scope.own('microtasks', {
      force: async (context) => {
        await Promise.resolve()
        await Promise.resolve()
        capture(context)
      }
    })
    scope.own('promise-chain', {
      force: (context) =>
        Promise.resolve()
          .then(() => Promise.resolve())
          .then(() => capture(context))
    })
    scope.own('nested-helper', {
      force: async (context) => {
        const nested = async (): Promise<void> => {
          await Promise.resolve()
          capture(context)
        }
        await nested()
      }
    })
    scope.own('timer', {
      force: async (context) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        capture(context)
      }
    })

    await expect(scope.dispose()).resolves.toEqual([])
    expect(failures).toHaveLength(4)
    expect(
      failures.every(
        (failure) =>
          (failure as { code?: string }).code === LifecycleErrorCode.scopeReentrantDispose
      )
    ).toBe(true)
  })

  it('DC-T01: fake scheduler does not defer or weaken the context join guard', async () => {
    const scheduler = createManualScheduler()
    let failure: unknown
    const scope = createLifecycleScope({ errorPolicy: 'collect', scheduler })
    scope.own('fake-clock', {
      force: async (context) => {
        await Promise.resolve()
        try {
          context.disposer!.join()
        } catch (error) {
          failure = error
        }
      }
    })
    await expect(scope.dispose()).resolves.toEqual([])
    expect(failure).toMatchObject({ code: LifecycleErrorCode.scopeReentrantDispose })
    expect(scheduler.now()).toBe(0)
  })

  it('DC-T02: an uncaught context join is collected while later disposers still settle', async () => {
    const released: string[] = []
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own('later', {
      force: () => {
        released.push('later')
      }
    })
    scope.own('self', {
      force: (context) => {
        context.disposer!.join()
      }
    })

    const errors = await scope.dispose()
    expect(released).toEqual(['later'])
    expect(scope.lifecycle).toBe('terminal')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.error).toMatchObject({ code: LifecycleErrorCode.scopeReentrantDispose })
  })

  it('DC-T03: external concurrent dispose callers retain the exact canonical native Promise', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scope = createLifecycleScope()
    scope.own('held', { force: async () => gate })

    const first = scope.dispose()
    const second = scope.dispose()
    expect(first).toBeInstanceOf(Promise)
    expect(second).toBe(first)
    release()
    await first
  })

  it('DC-T02: all four error policies preserve primary and secondary self-join failures', async () => {
    for (const policy of ['throw', 'collect', 'report', 'firstError'] as const) {
      const secondary = new Error(`secondary-${policy}`)
      const reported: unknown[] = []
      const scope = createLifecycleScope({
        errorPolicy: policy,
        report: (error) => reported.push(error)
      })
      scope.own('secondary', {
        force: () => {
          throw secondary
        }
      })
      scope.own('primary', {
        force: (context) => {
          context.disposer!.join()
        }
      })

      let outcome: unknown
      let settled: readonly { readonly source: string; readonly error: unknown }[] | undefined
      try {
        settled = await scope.dispose()
      } catch (error) {
        outcome = error
      }
      const primary = policy === 'throw' || policy === 'firstError' ? outcome : undefined
      if (policy === 'throw') {
        expect(primary).toMatchObject({ code: 'SCOPE_DISPOSAL_FAILED' })
        expect((primary as AggregateError).errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: LifecycleErrorCode.scopeReentrantDispose }),
            secondary
          ])
        )
      } else if (policy === 'collect') {
        expect(outcome).toBeUndefined()
        expect(settled).toHaveLength(2)
        expect(settled?.map((entry) => entry.error)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: LifecycleErrorCode.scopeReentrantDispose }),
            secondary
          ])
        )
      } else if (policy === 'report') {
        expect(outcome).toBeUndefined()
        expect(reported).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: LifecycleErrorCode.scopeReentrantDispose }),
            secondary
          ])
        )
      } else {
        expect(primary).toMatchObject({ code: LifecycleErrorCode.scopeReentrantDispose })
        expect(reported).toContain(secondary)
      }
    }
  })

  it('DC-T04: SyncLifecycleScope retains its context shape without an owner capability', () => {
    let context: IReleaseContext | undefined
    const scope = createSyncLifecycleScope()
    scope.own('sync', {
      syncSafe: true,
      force: (received) => {
        context = received
      }
    })
    scope.dispose()
    expect(context?.disposer).toBeUndefined()
  })

  it('DC-T04: generic transactions omit owner context and a stale context remains owner-bound', async () => {
    let genericContext: IReleaseContext | undefined
    const transaction = createDisposeTransaction({ kind: 'plan' })
    await transaction.run([
      {
        source: 'generic',
        descriptor: {
          force: (context) => {
            genericContext = context
          }
        }
      }
    ])
    expect(genericContext?.disposer).toBeUndefined()

    let staleContext: IReleaseContext | undefined
    const scope = createLifecycleScope()
    scope.own('stale', {
      force: (context) => {
        staleContext = context
      }
    })
    await scope.dispose()
    let staleError: unknown
    try {
      staleContext?.disposer?.join()
    } catch (error) {
      staleError = error
    }
    expect(staleError).toMatchObject({ code: LifecycleErrorCode.scopeReentrantDispose })
  })

  it('DC-T04: an owner A context cannot join owner B and both scopes settle independently', async () => {
    let releaseA!: () => void
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const aReady = Promise.withResolvers<void>()
    let aContext: IReleaseContext | undefined
    const scopeA = createLifecycleScope({ errorPolicy: 'collect' })
    scopeA.own('A-held', {
      force: async (context) => {
        aContext = context
        aReady.resolve()
        await aGate
      }
    })

    let bContext: IReleaseContext | undefined
    let aError: unknown
    let bLaterReleased = false
    const scopeB = createLifecycleScope({ errorPolicy: 'collect' })
    scopeB.own('B-later', {
      force: () => {
        bLaterReleased = true
      }
    })
    scopeB.own('B-calls-A', {
      force: (context) => {
        bContext = context
        try {
          aContext!.disposer!.join()
        } catch (error) {
          aError = error
          throw error
        }
      }
    })

    const aDispose = scopeA.dispose()
    await aReady.promise
    const bDispose = scopeB.dispose()

    expect(aDispose).toBeInstanceOf(Promise)
    expect(bDispose).toBeInstanceOf(Promise)
    expect(bDispose).not.toBe(aDispose)
    expect(aContext?.disposer).toBeDefined()
    expect(bContext?.disposer).toBeDefined()
    expect(bContext?.disposer).not.toBe(aContext?.disposer)

    const bErrors = await bDispose
    expect(bLaterReleased).toBe(true)
    expect(bErrors).toHaveLength(1)
    expect(bErrors[0]?.error).toBe(aError)
    expect(aError).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.scopeReentrantDispose
    })
    expect(scopeB.lifecycle).toBe('terminal')
    expect(scopeA.lifecycle).toBe('closing')

    releaseA()
    await expect(aDispose).resolves.toEqual([])
    expect(scopeA.lifecycle).toBe('terminal')
  })
})
