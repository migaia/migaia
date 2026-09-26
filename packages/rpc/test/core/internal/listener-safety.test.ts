import { describe, expect, it } from 'vitest'
import {
  createListenerFailure,
  createListenerFailureState,
  drainListenerFailures,
  drainTerminalListenerFailures,
  observeListener,
  registerListeners,
  reportListenerFailure,
  releaseListeners
} from '../../../src/core/internal/listener-safety.js'
import {
  RPC_CORE_ERROR_SOURCE,
  RpcCoreErrorCode,
  RpcLifecycleError
} from '../../../src/core/errors.js'

describe('listener safety', () => {
  it('preserves an exact pre-tagged WebRPC error at a different cleanup boundary', () => {
    const cause = new Error('endpoint primary')
    const cleanupErrors = [{ resource: 'endpoint cleanup', error: new Error('cleanup') }]
    const lifecycleError = new RpcLifecycleError('endpoint disposal failed', cause, cleanupErrors)

    const failure = createListenerFailure([lifecycleError], {
      code: RpcCoreErrorCode.transport
    })

    expect(failure).toBe(lifecycleError)
    expect(failure).toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.endpointDisposed,
      cause,
      cleanupErrors
    })

    const foreign = new Error('foreign identity')
    Object.defineProperties(foreign, {
      source: { value: '@foreign/rpc' },
      code: { value: RpcCoreErrorCode.endpointDisposed }
    })
    expect(() => createListenerFailure([foreign], { code: RpcCoreErrorCode.transport })).toThrow(
      TypeError
    )

    const invalidCode = new Error('invalid WebRPC identity')
    Object.defineProperties(invalidCode, {
      source: { value: RPC_CORE_ERROR_SOURCE },
      code: { value: 'NOT_A_WEBRPC_CODE' }
    })
    expect(() =>
      createListenerFailure([invalidCode], { code: RpcCoreErrorCode.transport })
    ).toThrow(TypeError)
  })

  it('tags an exact bare single error with the cleanup boundary identity', () => {
    const bare = new Error('bare cleanup')

    const failure = createListenerFailure([bare], {
      code: RpcCoreErrorCode.transport
    })

    expect(failure).toBe(bare)
    expect(failure).toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.transport
    })
  })

  it('keeps ordered child identities in a tagged native AggregateError', () => {
    const first = new RpcLifecycleError('endpoint cleanup')
    const second = new Error('transport cleanup')

    const failure = createListenerFailure([first, second], {
      code: RpcCoreErrorCode.transport
    })

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([first, second])
    expect(failure).toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.transport
    })
    expect(first).toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.endpointDisposed
    })
    expect(second).not.toHaveProperty('source')
  })

  it('reports synchronous listener failures without throwing', () => {
    const errors: unknown[] = []
    expect(() =>
      observeListener(
        () => {
          throw new Error('sync')
        },
        (error) => errors.push(error)
      )
    ).not.toThrow()
    expect(errors[0]).toMatchObject({ message: 'sync' })
  })

  it('observes promise and thenable rejection asynchronously', async () => {
    const errors: unknown[] = []
    observeListener(
      () => Promise.reject('promise'),
      (error) => errors.push(error)
    )
    observeListener(
      () =>
        ({
          // oxlint-disable-next-line unicorn/no-thenable
          then: (_resolve: () => void, reject: (error: unknown) => void) => reject('thenable')
        }) as never,
      (error) => errors.push(error)
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(errors).toEqual(['promise', 'thenable'])
  })

  it('collects reporter failures once and surfaces the exact error at cleanup', async () => {
    const diagnostic = new Error('diagnostic')
    const reporterFailures = createListenerFailureState()
    expect(() =>
      observeListener(
        () => Promise.reject('failure'),
        () => {
          throw diagnostic
        },
        reporterFailures
      )
    ).not.toThrow()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(reporterFailures.failures.map(({ error }) => error)).toEqual([diagnostic])
    expect(() =>
      drainListenerFailures([], {
        code: RpcCoreErrorCode.internal,
        secondaryFailures: reporterFailures
      })
    ).toThrow(diagnostic)
    expect(diagnostic).toMatchObject({ code: RpcCoreErrorCode.internal })
    expect(reporterFailures.failures).toEqual([])
  })

  it('contains asynchronous reporter rejection until the cleanup boundary', async () => {
    const reporterFailure = new Error('async diagnostic')
    const reporterFailures = createListenerFailureState()
    observeListener(
      () => {
        throw new Error('listener')
      },
      () => Promise.reject(reporterFailure),
      reporterFailures
    )

    await Promise.resolve()
    await Promise.resolve()
    expect(reporterFailures.failures.map(({ error }) => error)).toEqual([reporterFailure])
    expect(() =>
      drainListenerFailures([], {
        code: RpcCoreErrorCode.transport,
        secondaryFailures: reporterFailures
      })
    ).toThrow(reporterFailure)
    expect(reporterFailure).toMatchObject({ code: RpcCoreErrorCode.transport })
  })

  it('keeps asynchronous reporter failures in invocation order at the terminal boundary', async () => {
    const first = new Error('first reporter')
    const second = new Error('second reporter')
    const reporterFailures = createListenerFailureState()
    let rejectFirst!: (error: unknown) => void
    let rejectSecond!: (error: unknown) => void
    const reporters = new Set<(error: unknown) => Promise<void>>([
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject
        }),
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSecond = reject
        })
    ])

    reportListenerFailure(new Error('terminal'), reporters, reporterFailures)
    const terminal = drainTerminalListenerFailures([], {
      code: RpcCoreErrorCode.transport,
      secondaryFailures: reporterFailures,
      aggregateSingle: true
    })
    expect(terminal).toBeInstanceOf(Promise)
    rejectSecond(second)
    rejectFirst(first)

    try {
      await terminal
      throw new Error('terminal cleanup unexpectedly succeeded')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([first, second])
      expect(error).toMatchObject({ code: RpcCoreErrorCode.transport })
    }
  })

  it('rolls back earlier registrations when a later registration fails', () => {
    const active: string[] = []
    expect(() =>
      registerListeners([
        {
          add: () => active.push('first'),
          remove: () => active.splice(active.indexOf('first'), 1)
        },
        {
          add: () => {
            throw new Error('second registration failed')
          },
          remove: () => undefined
        }
      ])
    ).toThrow('second registration failed')
    expect(active).toEqual([])
  })

  it('keeps rollback going when an earlier removal fails', () => {
    const active: string[] = []
    const primary = new Error('third registration failed')
    const cleanup = new Error('first removal failed')
    let failure: unknown
    try {
      registerListeners([
        {
          add: () => active.push('first'),
          remove: () => {
            throw cleanup
          }
        },
        {
          add: () => active.push('second'),
          remove: () => active.splice(active.indexOf('second'), 1)
        },
        {
          add: () => {
            throw primary
          },
          remove: () => undefined
        }
      ])
    } catch (error) {
      failure = error
    }
    expect(active).toEqual(['first'])
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([primary, cleanup])
    expect(failure).toMatchObject({ code: RpcCoreErrorCode.internal })
  })

  it('runs every removal and aggregates cleanup failures', () => {
    const removed: string[] = []
    let failure: unknown
    try {
      releaseListeners([
        () => {
          removed.push('first')
          throw new Error('first failed')
        },
        () => {
          removed.push('second')
          throw new Error('second failed')
        },
        () => removed.push('third')
      ])
    } catch (error) {
      failure = error
    }
    expect(removed).toEqual(['third', 'second', 'first'])
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toHaveLength(2)
    expect(failure).toMatchObject({ code: RpcCoreErrorCode.internal })
  })
})
