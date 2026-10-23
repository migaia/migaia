import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { Resource, type IResourceFetchContext } from '../src/index.js'
import { walkErrorCauses } from '@migaia/utils/error'

describe('audited resource request ownership', () => {
  it('keeps the newest public request Promise after synchronous refetch reentrancy', async () => {
    /** Fetcher may synchronously replace its own request through the public API. */
    let resource: Resource<number>
    /** Nested request must remain the canonical current Promise. */
    let nested!: Promise<number>
    /** Each request produces a distinguishable successful value. */
    let calls = 0
    resource = new Resource(
      () => {
        /** Retain this attempt's value even if its callback starts a newer request. */
        const value = ++calls
        if (value === 1) nested = resource.refetch()
        return value
      },
      createRuntime(),
      { autoStart: false }
    )
    /** Outer caller still observes its own superseded request outcome. */
    const outer = resource.refetch()
    await expect(outer).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
    await expect(nested).resolves.toBe(2)
    expect(resource.promise).toBe(nested)
    expect(resource.peekState()).toEqual({ status: 'success', data: 2 })
    resource.dispose()
  })

  it('revalidates a changed suspended dependency even when ttl is zero', async () => {
    /** Manual idle execution isolates suspension from elapsed-time expiration. */
    const idle: (() => void)[] = []
    /** One runtime owns both the resource observer and its signal. */
    const runtime = createRuntime({
      scheduleIdle: (task) => {
        idle.push(task)
      }
    })
    /** Dependency changes only after the resource has suspended its reverse edges. */
    const input = runtime.signal(1)
    /** Supported ttl:0 retains its existing no-time-expiration policy. */
    const resource = new Resource(() => input.value, runtime, { ttl: 0 })
    await expect(resource.promise).resolves.toBe(1)
    for (const task of idle.splice(0)) task()
    input.value = 2
    /** Suspense read must start the needed replacement rather than return the stale cached 1. */
    let pending: unknown
    try {
      resource.read()
    } catch (error) {
      pending = error
    }
    expect(pending).toBe(resource.promise)
    await expect(resource.promise).resolves.toBe(2)
    expect(resource.read()).toBe(2)
    resource.dispose()
    input.dispose()
  })

  it('transfers remaining lifetime between unrelated scheduler origins', async () => {
    /** Sender and receiver use independent monotonic origins without any shared wall clock. */
    let senderNow = 10_000
    let receiverNow = 100
    /** Cache is already 40ms old when it leaves the sender. */
    const sender = new Resource(() => 42, createRuntime(), {
      ttl: 100,
      scheduler: { now: () => senderNow, schedule: () => ({ cancel: () => undefined }) }
    })
    await sender.promise
    senderNow += 40
    /** Snapshot durations are portable; transport/storage elapsed time is caller-owned. */
    const snapshot = sender.dehydrate()
    expect(snapshot).toEqual({ version: 2, data: 42, ageMs: 40, remainingTtlMs: 60 })
    /** Hydration resumes the captured remaining lifetime in the receiving scheduler domain. */
    const receiver = new Resource(() => 99, createRuntime(), {
      autoStart: false,
      ttl: 100,
      initialSnapshot: snapshot,
      scheduler: { now: () => receiverNow, schedule: () => ({ cancel: () => undefined }) }
    })
    receiverNow += 59
    expect(receiver.isStale).toBe(false)
    expect(receiver.dehydrate()).toEqual({ version: 2, data: 42, ageMs: 99, remainingTtlMs: 1 })
    receiverNow++
    expect(receiver.isStale).toBe(true)
    sender.dispose()
    receiver.dispose()
  })

  it.each(['retry', 'retryDelay'] as const)(
    'preserves fetch failure when %s throws',
    async (option) => {
      /** Retry policies add context without erasing the request failure that invoked them. */
      const fetchFailure = new Error('fetch failed')
      const policyFailure = new TypeError('policy failed')
      /** Both policy callbacks are supported public failure boundaries. */
      const resource = new Resource(() => Promise.reject(fetchFailure), createRuntime(), {
        retry:
          option === 'retry'
            ? () => {
                throw policyFailure
              }
            : 1,
        retryDelay:
          option === 'retryDelay'
            ? () => {
                throw policyFailure
              }
            : 0
      })
      /** Mutable native policy errors retain their identity and gain the underlying request failure. */
      const failure = await resource.promise.catch((error: unknown) => error)
      expect(failure).toBe(policyFailure)
      expect([...walkErrorCauses(failure)]).toContain(fetchFailure)
      expect(failure).toMatchObject({ source: 'resource', code: 'INVALID_OPTION' })
      resource.dispose()
    }
  )

  it.each(['cancel', 'reset', 'refetch', 'dispose'] as const)(
    'retains the signal reason after %s',
    async (operation) => {
      /** The first request exposes the same cancellation channel used by a real transport. */
      let context!: IResourceFetchContext
      const resource = new Resource((request) => {
        context ??= request
        return new Promise<number>(() => undefined)
      }, createRuntime())
      /** Every caller retains its own cancelled request even if a replacement becomes current. */
      const pending = resource.promise
      if (operation === 'refetch') void resource.refetch().catch(() => undefined)
      else resource[operation]()
      /**
       * Lifecycle-owned replacement reasons may be causes; explicit Resource reasons may be
       * identical.
       */
      const failure = await pending.catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(DOMException)
      expect(failure).toMatchObject({ source: 'resource', code: 'REQUEST_ABORTED' })
      expect([...walkErrorCauses(failure)]).toContain(context.signal.reason)
      resource.dispose()
    }
  )

  it('identifies an async fetch rejection without replacing its native error', async () => {
    /** Async failures bypass the reactive synchronous callback boundary. */
    const original = new RangeError('async fetch failed')
    const resource = new Resource(() => Promise.reject(original), createRuntime())
    const failure = await resource.promise.catch((error: unknown) => error)
    expect(failure).toBe(original)
    expect(failure).toMatchObject({ source: 'resource', code: 'FETCH_FAILED' })
    expect(() => resource.read()).toThrow(original)
    resource.dispose()
  })

  it('retains immutable fetch failures and preserves an existing foreign identity', async () => {
    /** Frozen native errors need a package-owned shell whose cause retains the original stack. */
    const frozen = Object.freeze(new Error('immutable fetch failed'))
    const immutable = new Resource(() => Promise.reject(frozen), createRuntime())
    const failure = await immutable.promise.catch((error: unknown) => error)
    expect(failure).toMatchObject({ source: 'resource', code: 'FETCH_FAILED' })
    expect([...walkErrorCauses(failure)]).toContain(frozen)
    /** Already classified failures remain owned by their originating package. */
    const foreign = Object.assign(new Error('foreign failure'), {
      source: 'serialization',
      code: 'ENCODE_FAILED'
    })
    const owned = new Resource(() => Promise.reject(foreign), createRuntime())
    await expect(owned.promise).rejects.toBe(foreign)
    immutable.dispose()
    owned.dispose()
  })
})
