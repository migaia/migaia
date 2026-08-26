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
} from '../../src/internal/listener-safety.js'
import { WEBRPC_SOURCE, WebRpcErrorCode, WebRpcLifecycleError } from '../../src/errors.js'

describe('listener safety', () => {
  it('preserves an exact pre-tagged WebRPC error at a different cleanup boundary', () => {
    const cause = new Error('endpoint primary')
    const cleanupErrors = [{ resource: 'endpoint cleanup', error: new Error('cleanup') }]
    const lifecycleError = new WebRpcLifecycleError(
      'endpoint disposal failed',
      cause,
      cleanupErrors
    )

    const failure = createListenerFailure([lifecycleError], {
      code: WebRpcErrorCode.transport
    })

    expect(failure).toBe(lifecycleError)
    expect(failure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.endpointDisposed,
      cause,
      cleanupErrors
    })

    const foreign = new Error('foreign identity')
    Object.defineProperties(foreign, {
      source: { value: '@foreign/rpc' },
      code: { value: WebRpcErrorCode.endpointDisposed }
    })
    expect(() => createListenerFailure([foreign], { code: WebRpcErrorCode.transport })).toThrow(
      TypeError
    )

    const invalidCode = new Error('invalid WebRPC identity')
    Object.defineProperties(invalidCode, {
      source: { value: WEBRPC_SOURCE },
      code: { value: 'NOT_A_WEBRPC_CODE' }
    })
    expect(() => createListenerFailure([invalidCode], { code: WebRpcErrorCode.transport })).toThrow(
      TypeError
    )
  })

  it('tags an exact bare single error with the cleanup boundary identity', () => {
    const bare = new Error('bare cleanup')

    const failure = createListenerFailure([bare], {
      code: WebRpcErrorCode.transport
    })

    expect(failure).toBe(bare)
    expect(failure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.transport
    })
  })

  it('keeps ordered child identities in a tagged native AggregateError', () => {
    const first = new WebRpcLifecycleError('endpoint cleanup')
    const second = new Error('transport cleanup')

    const failure = createListenerFailure([first, second], {
      code: WebRpcErrorCode.transport
    })

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([first, second])
    expect(failure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.transport
    })
    expect(first).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.endpointDisposed
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
        code: WebRpcErrorCode.internal,
        secondaryFailures: reporterFailures
      })
    ).toThrow(diagnostic)
    expect(diagnostic).toMatchObject({ code: WebRpcErrorCode.internal })
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
        code: WebRpcErrorCode.transport,
        secondaryFailures: reporterFailures
      })
    ).toThrow(reporterFailure)
    expect(reporterFailure).toMatchObject({ code: WebRpcErrorCode.transport })
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
      code: WebRpcErrorCode.transport,
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
      expect(error).toMatchObject({ code: WebRpcErrorCode.transport })
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
    expect(failure).toMatchObject({ code: WebRpcErrorCode.internal })
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
    expect(failure).toMatchObject({ code: WebRpcErrorCode.internal })
  })
})
