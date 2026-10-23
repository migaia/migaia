import { type IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRuntimePeer, IRpcHostMember } from '@migaia/rpc-host/plugin'
import type { IRpcHost } from '@migaia/rpc-host'
import type { IPoolPluginOptions } from '../dist/index.js'
import { schedulingHost } from './pool-fixture.js'

/** The existing SDK openMember boundary preserves exact downstream operation identities. */
const factories = { thread: vi.fn<(context: unknown) => Promise<IRuntimePeer>>() }
/** Genuine RPC facades retain endpoint cleanup after each controls-level scheduling case. */
const owners: IRpcHost<unknown>[] = []

/** Drive the new host facade while substituting only the original SDK member authoring callback. */
async function openPool(options: IPoolPluginOptions) {
  const { host, controls } = await schedulingHost(
    options,
    async (context) => (await factories.thread(context.transport)) as unknown as IRpcHostMember
  )
  owners.push(host)
  return {
    request: host.request as IRuntimePeer['request'],
    notify: host.notify as IRuntimePeer['notify'],
    stream: host.stream as IRuntimePeer['stream'],
    ...controls
  }
}

/** A mocked public Peer owns these explicit business completion points. */
function member(id: number, dispatches: Array<Readonly<{ id: number; value: number }>>) {
  /** Only held request completion controls scheduling in the deterministic cases. */
  const requests = new Map<number, PromiseWithResolvers<number>>()
  /** Notify completion represents the original send Promise rather than provider concurrency. */
  const notifications = new Map<number, PromiseWithResolvers<void>>()
  /** Request rejection can retain any original peer-owned error object. */
  const request = vi.fn<IRuntimePeer['request']>((method, payload) => {
    /** Test business inputs are numbers, independent of any transport metadata. */
    const value = typeof payload === 'number' ? payload : 0
    dispatches.push({ id, value })
    if (method !== 'hold') return Promise.resolve(value)
    /** Each accepted hold has an independently observable completion point. */
    const pending = Promise.withResolvers<number>()
    requests.set(value, pending)
    return pending.promise
  })
  /** The send operation remains unresolved until the fixture's caller releases it. */
  const notify = vi.fn<IRuntimePeer['notify']>((_method, payload) => {
    /** Numeric labels distinguish independently accepted notifications. */
    const value = typeof payload === 'number' ? payload : 0
    /** The public send Promise is the sole notification completion fact. */
    const pending = Promise.withResolvers<void>()
    notifications.set(value, pending)
    return pending.promise
  })
  /** The original iterator owns its completion, early return, throw, and active cancellation. */
  const stream = vi.fn<IRuntimePeer['stream']>((_method, payload, options) => {
    /** One fixture item makes done and return distinct observable paths. */
    let emitted = false
    /** Only this iterator's own abort observation changes its next result. */
    let failure: unknown
    /** A defined failure flag also preserves an undefined thrown value. */
    let failed = false
    /** Active cancellation is implemented by the Peer fixture, not by the pool. */
    const abort = (): void => {
      failed = true
      failure = options?.signal?.reason
    }
    options?.signal?.addEventListener('abort', abort, { once: true })
    /** Every terminal iterator operation removes only its own signal observer. */
    const detach = (): void => options?.signal?.removeEventListener('abort', abort)
    /** The public iterator returns the same object to for-await consumers. */
    const iterator: ReturnType<IRuntimePeer['stream']> = {
      [Symbol.asyncIterator]: () => iterator,
      next: async () => {
        if (failed) {
          detach()
          throw failure
        }
        if (emitted) {
          detach()
          return { done: true, value: undefined }
        }
        emitted = true
        return { done: false, value: typeof payload === 'number' ? payload : 0 }
      },
      return: async () => {
        detach()
        return { done: true, value: undefined }
      },
      throw: async (error) => {
        detach()
        throw error
      }
    }
    return iterator
  })
  /** Original close call counts prove retirement and final shutdown do not duplicate cleanup. */
  const close = vi.fn<IRuntimePeer['close']>(() => Promise.resolve())
  /** Unused query methods reject rather than inventing native state or a directory receipt. */
  const unused = (): Promise<never> => Promise.reject(new Error('unused fixture operation'))
  /** This complete public Peer exists only behind the explicitly mocked public factory. */
  const peer: IRuntimePeer = {
    self: { name: 'fixture', instanceId: `fixture-${id}` },
    request,
    notify,
    stream,
    close,
    group: unused,
    outcome: unused,
    describe: unused,
    on: () => () => undefined,
    [Symbol.asyncDispose]: close
  }
  return { peer, request, notify, stream, close, requests, notifications }
}

/** Configure only the current test's public factory result sequence and dispatch observation. */
function installFactory() {
  /** Call order and fixture values are independent evidence for FIFO and round-robin dispatch. */
  const dispatches: Array<Readonly<{ id: number; value: number }>> = []
  /** Each public factory call creates a distinct owned mocked Peer. */
  const members: Array<ReturnType<typeof member>> = []
  factories.thread.mockImplementation(async () => {
    /** Only this public factory result becomes a member of the tested pool. */
    const created = member(members.length, dispatches)
    members.push(created)
    return created.peer
  })
  return { members, dispatches }
}

beforeEach(() => {
  factories.thread.mockReset()
  vi.useRealTimers()
})

/** Final owner cleanup reports retained failures already asserted by the controls-level cases. */
afterEach(async () => {
  vi.useRealTimers()
  const outcomes = await Promise.allSettled(owners.splice(0).map((host) => host.close()))
  for (const outcome of outcomes) if (outcome.status === 'rejected') console.error(outcome.reason)
})

describe('public pool scheduling', () => {
  it('dispatches least-in-flight FIFO with rotating ties and lazy stream slots', async () => {
    /** All business completion points remain with the mocked public Peers. */
    const fixture = installFactory()
    /** Two distinct factory results provide exactly two client scheduling slots. */
    const pool = await openPool({ size: 2, maxQueue: 2 })
    /** Both acquisitions come through the actual installed transport's SDK descriptor. */
    for (const [transport] of factories.thread.mock.calls)
      expect(transport).toEqual({ name: 'scheduler-source', mode: 'connect' })
    /** Four calls admit two active operations and two FIFO entries. */
    const calls = [1, 2, 3, 4].map((value) => pool.request('hold', value))
    await vi.waitFor(() =>
      expect(fixture.dispatches).toEqual([
        { id: 0, value: 1 },
        { id: 1, value: 2 }
      ])
    )
    expect(pool.stats()).toMatchObject({ memberCount: 2, inFlight: 2, queued: 2, state: 'open' })
    expect(Object.isFrozen(pool.stats())).toBe(true)
    fixture.members[0]!.requests.get(1)!.resolve(1)
    expect(await calls[0]).toBe(1)
    await vi.waitFor(() => expect(fixture.dispatches.at(-1)).toEqual({ id: 0, value: 3 }))
    /** Returning a first-next reservation in FIFO never opens a native consumer. */
    const waiting = pool.stream('count', 99)
    const waitingNext = waiting.next()
    await waiting.return?.()
    expect(await waitingNext).toEqual({ done: true, value: undefined })
    expect(pool.stats().queued).toBe(1)
    fixture.members[1]!.requests.get(2)!.resolve(2)
    expect(await calls[1]).toBe(2)
    await vi.waitFor(() => expect(fixture.dispatches.at(-1)).toEqual({ id: 1, value: 4 }))
    fixture.members[0]!.requests.get(3)!.resolve(3)
    fixture.members[1]!.requests.get(4)!.resolve(4)
    expect(await Promise.all(calls)).toEqual([1, 2, 3, 4])
    await pool.request('echo', 5)
    await pool.request('echo', 6)
    expect(fixture.dispatches.slice(-2)).toEqual([
      { id: 0, value: 5 },
      { id: 1, value: 6 }
    ])
    /** An untouched iterator owns no slot and has not called a Peer stream method. */
    const returned = pool.stream('count', 7)
    expect(pool.stats().inFlight).toBe(0)
    expect(
      fixture.members.reduce((total, value) => total + value.stream.mock.calls.length, 0)
    ).toBe(0)
    expect(await returned.next()).toEqual({ done: false, value: 7 })
    expect(pool.stats().inFlight).toBe(1)
    await returned.return?.()
    expect(pool.stats().inFlight).toBe(0)
    /** Normal done and thrown completion independently release their acquired slots. */
    const done = pool.stream('count', 8)
    await done.next()
    expect(await done.next()).toEqual({ done: true, value: undefined })
    const thrown = pool.stream('count', 9)
    await thrown.next()
    /** The original iterator error is never replaced by pool bookkeeping. */
    const reason = new Error('iterator stopped')
    await expect(thrown.throw?.(reason)).rejects.toBe(reason)
    expect(pool.stats()).toMatchObject({ inFlight: 0, queued: 0 })
    await pool.close()
  })

  it('drains accepted request/notify/stream and retires only resize/idle differences', async () => {
    /** Separate sends and iterators make close's three completion boundaries observable. */
    const fixture = installFactory()
    const pool = await openPool({ size: 2 })
    const request = pool.request('hold', 1)
    const notify = pool.notify('note', 2)
    const stream = pool.stream('count', 3)
    const first = stream.next()
    const closing = pool.close()
    expect(pool.close()).toBe(closing)
    expect(pool.stats().state).toBe('closing')
    expect(fixture.members.every((value) => value.close.mock.calls.length === 0)).toBe(true)
    await vi.waitFor(() => {
      expect(fixture.members[0]!.requests.has(1)).toBe(true)
      expect(fixture.members[1]!.notifications.has(2)).toBe(true)
    })
    fixture.members[0]!.requests.get(1)!.resolve(1)
    await request
    expect(await first).toEqual({ done: false, value: 3 })
    await stream.return?.()
    expect(fixture.members.every((value) => value.close.mock.calls.length === 0)).toBe(true)
    fixture.members[1]!.notifications.get(2)!.resolve()
    await notify
    await closing
    expect(fixture.members.map((value) => value.close.mock.calls.length)).toEqual([1, 1])
    expect(pool.stats().state).toBe('closed')

    /** A pending next cannot prevent return from reaching the same original consumer. */
    const blockedFixture = installFactory()
    const blocked = await openPool({ size: 1 })
    const read = Promise.withResolvers<IteratorResult<number>>()
    const returnConsumer = vi.fn(async () => {
      read.resolve({ done: true, value: undefined })
      return { done: true as const, value: undefined }
    })
    const consumer: ReturnType<IRuntimePeer['stream']> = {
      [Symbol.asyncIterator]: () => consumer,
      next: () => read.promise,
      return: returnConsumer
    }
    blockedFixture.members[0]!.stream.mockReturnValueOnce(consumer)
    const blockedStream = blocked.stream('count', 4)
    const blockedNext = blockedStream.next()
    await vi.waitFor(() => expect(blockedFixture.members[0]!.stream).toHaveBeenCalledTimes(1))
    const blockedClose = blocked.close()
    await blockedStream.return?.()
    expect(await blockedNext).toEqual({ done: true, value: undefined })
    await blockedClose
    expect(returnConsumer).toHaveBeenCalledTimes(1)
    expect(blockedFixture.members[0]!.close).toHaveBeenCalledTimes(1)

    /** Busy shrink waits for the retired member's actual public operation without preemption. */
    const resizedFixture = installFactory()
    const resized = await openPool({ size: 2 })
    const holds = [resized.request('hold', 11), resized.request('hold', 22)]
    const shrink = resized.resize(1)
    await vi.waitFor(() => {
      expect(resizedFixture.members[0]!.requests.has(11)).toBe(true)
      expect(resizedFixture.members[1]!.requests.has(22)).toBe(true)
    })
    expect(resizedFixture.members.every((value) => value.close.mock.calls.length === 0)).toBe(true)
    resizedFixture.members[0]!.requests.get(11)!.resolve(11)
    resizedFixture.members[1]!.requests.get(22)!.resolve(22)
    expect(await Promise.all(holds)).toEqual([11, 22])
    await shrink
    expect(resized.stats()).toMatchObject({ targetSize: 1, memberCount: 1 })
    expect(
      resizedFixture.members.reduce((total, value) => total + value.close.mock.calls.length, 0)
    ).toBe(1)
    await Promise.all([resized.resize(2), resized.resize(3)])
    expect(resized.stats()).toMatchObject({ targetSize: 3, memberCount: 3 })
    expect(resizedFixture.members).toHaveLength(4)
    await resized.close()
    expect(resizedFixture.members.every((value) => value.close.mock.calls.length === 1)).toBe(true)

    /** Fake time affects only the pool's explicitly requested idle resource policy. */
    vi.useFakeTimers()
    const idleFixture = installFactory()
    const idle = await openPool({
      size: 1,
      maxQueue: 0,
      idleTimeoutMs: 20
    })
    try {
      await vi.advanceTimersByTimeAsync(20)
      expect(idle.stats().memberCount).toBe(0)
      expect(idleFixture.members[0]!.close).toHaveBeenCalledTimes(1)
      expect(await idle.request('echo', 7)).toBe(7)
      expect(idleFixture.members).toHaveLength(2)
      expect(idle.stats()).toMatchObject({ targetSize: 1, memberCount: 1 })
    } finally {
      await idle.close()
      vi.useRealTimers()
    }

    /** One failed cold refill rejects its reserved head and associated FIFO with the same primary. */
    vi.useFakeTimers()
    const coldFixture = installFactory()
    const cold = await openPool({ size: 1, idleTimeoutMs: 20 })
    try {
      await vi.advanceTimersByTimeAsync(20)
      const opened = Promise.withResolvers<IRuntimePeer>()
      /** Exactly one public refill attempt may serve these already accepted operations. */
      const beforeRefill = factories.thread.mock.calls.length
      factories.thread.mockImplementationOnce(() => opened.promise)
      const primary = new Error('cold refill primary')
      const head = cold.request('echo', 77).catch((error: unknown) => error)
      const tail = cold.request('echo', 88).catch((error: unknown) => error)
      opened.reject(primary)
      expect(await head).toBe(primary)
      expect(await tail).toBe(primary)
      expect(coldFixture.members).toHaveLength(1)
      expect(cold.stats()).toMatchObject({ inFlight: 0, queued: 0 })
      await cold.close()
      expect(factories.thread).toHaveBeenCalledTimes(beforeRefill + 1)
    } finally {
      await cold.close()
      vi.useRealTimers()
    }

    /** Close collects the original member failures rather than losing later cleanup errors. */
    const failingFixture = installFactory()
    const failing = await openPool({ size: 2 })
    const failures = [new Error('first close'), new Error('second close')]
    failingFixture.members.forEach((value, index) =>
      value.close.mockRejectedValueOnce(failures[index])
    )
    const failure = await failing.close().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure).toMatchObject({ source: 'rpc.pool', code: 'CLOSE_FAILED' })
    expect((failure as AggregateError).errors).toEqual(failures)
  })

  it('rejects overflow/new closed work and validates before native acquisition', async () => {
    const fixture = installFactory()
    const pool = await openPool({ size: 1, maxQueue: 1 })
    const active = pool.request('hold', 1)
    const queued = pool.request('echo', 2)
    await expect(pool.request('echo', 3)).rejects.toMatchObject({
      source: 'rpc.pool',
      code: 'QUEUE_FULL'
    })
    expect(fixture.dispatches).toEqual([{ id: 0, value: 1 }])
    const close = pool.close()
    await expect(pool.request('echo', 4)).rejects.toMatchObject({ code: 'POOL_CLOSED' })
    fixture.members[0]!.requests.get(1)!.resolve(1)
    expect(await active).toBe(1)
    expect(await queued).toBe(2)
    await close
    await expect(pool.resize(2)).rejects.toMatchObject({ code: 'POOL_CLOSED' })

    const zeroFixture = installFactory()
    const zero = await openPool({ size: 1, maxQueue: 0 })
    const held = zero.request('hold', 5)
    await expect(zero.notify('note', 6)).rejects.toMatchObject({ code: 'QUEUE_FULL' })
    expect(zeroFixture.members[0]!.notify).not.toHaveBeenCalled()
    zeroFixture.members[0]!.requests.get(5)!.resolve(5)
    await held
    await zero.close()

    /** Invalid JavaScript structure and numeric values are admitted by no native factory. */
    factories.thread.mockClear()
    await expect(openPool({ size: 0 })).rejects.toMatchObject({
      name: 'RangeError',
      code: 'INVALID_OPTIONS'
    })
    await expect(openPool({ size: 1, maxQueue: -1 })).rejects.toMatchObject({
      name: 'RangeError',
      code: 'INVALID_OPTIONS'
    })
    await expect(openPool({ size: 1, idleTimeoutMs: 2147483648 })).rejects.toMatchObject({
      name: 'RangeError',
      code: 'INVALID_OPTIONS'
    })
    await expect(
      Promise.resolve().then(() => Reflect.apply(openPool, undefined, [null]))
    ).rejects.toMatchObject({ name: 'TypeError', code: 'INVALID_OPTIONS' })
    expect(factories.thread).not.toHaveBeenCalled()

    /** A partly acquired batch rolls back its actual Peer and preserves the first factory failure. */
    const rollbackFixture = installFactory()
    const survivor = member(0, rollbackFixture.dispatches)
    const primary = new Error('native creation failed')
    const cleanup = new Error('rollback close failed')
    survivor.close.mockRejectedValueOnce(cleanup)
    factories.thread.mockReset().mockResolvedValueOnce(survivor.peer).mockRejectedValueOnce(primary)
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(openPool({ size: 2 })).rejects.toBe(primary)
      expect(survivor.close).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenCalledWith(cleanup)
    } finally {
      report.mockRestore()
    }
  })

  it('removes queued cancellation and passes active options/errors to the Peer unchanged', async () => {
    const fixture = installFactory()
    const pool = await openPool({ size: 1, maxQueue: 2 })
    const activeController = new AbortController()
    const queuedController = new AbortController()
    const streamController = new AbortController()
    const originalReason = new Error('active native cancellation')
    const queuedReason = new Error('queued cancellation')
    const streamReason = new Error('stream native cancellation')
    /** The active public Peer supplies this exact native AbortError instance. */
    const nativeFailure = new DOMException('native cancelled', 'AbortError')
    Object.defineProperty(nativeFailure, 'cause', { value: originalReason })
    const pending = Promise.withResolvers<number>()
    fixture.members[0]!.request.mockImplementation((_method, _payload, options) => {
      options?.signal?.addEventListener('abort', () => pending.reject(nativeFailure), {
        once: true
      })
      return pending.promise
    })
    const options = Object.freeze({
      signal: activeController.signal,
      timeoutMs: 1234,
      orderKey: 'pool-order',
      idempotencyKey: 'pool-idempotency'
    })
    const active = pool.request('hold', 1, options).catch((error: unknown) => error)
    await vi.waitFor(() => expect(fixture.members[0]!.request).toHaveBeenCalledTimes(1))
    expect(fixture.members[0]!.request.mock.calls[0]![2]).toBe(options)
    expect(fixture.members[0]!.request.mock.calls[0]![2]!.signal).toBe(activeController.signal)
    const queued = pool
      .request('echo', 2, { signal: queuedController.signal })
      .catch((error: unknown) => error)
    queuedController.abort(queuedReason)
    const rejected = await queued
    expect(rejected).toBeInstanceOf(DOMException)
    expect(rejected).toMatchObject({
      name: 'AbortError',
      source: 'rpc.pool',
      code: 'CALL_ABORTED'
    })
    expect((rejected as Error).cause).toBe(queuedReason)
    expect(pool.stats()).toMatchObject({ inFlight: 1, queued: 0 })
    const streamOptions = Object.freeze({ signal: streamController.signal, timeoutMs: 4321 })
    const stream = pool.stream('count', 3, streamOptions)
    const first = stream.next()
    activeController.abort(originalReason)
    expect(await active).toBe(nativeFailure)
    expect(await first).toEqual({ done: false, value: 3 })
    expect(fixture.members[0]!.stream.mock.calls[0]![2]).toBe(streamOptions)
    streamController.abort(streamReason)
    const closing = pool.close()
    await expect(stream.next()).rejects.toBe(streamReason)
    await closing
    expect(pool.stats()).toMatchObject({ inFlight: 0, queued: 0, state: 'closed' })
    expect(fixture.members[0]!.close).toHaveBeenCalledTimes(1)
    expect(fixture.members[0]!.request).toHaveBeenCalledTimes(1)

    /** A throw during pending next must terminate its real consumer without waiting for that read. */
    const blockedFixture = installFactory()
    const blocked = await openPool({ size: 1 })
    const read = Promise.withResolvers<IteratorResult<number>>()
    const primary = new Error('pending stream termination')
    const throwConsumer = vi.fn(async (error: unknown) => {
      read.reject(error)
      throw error
    })
    const consumer: ReturnType<IRuntimePeer['stream']> = {
      [Symbol.asyncIterator]: () => consumer,
      next: () => read.promise,
      throw: throwConsumer
    }
    blockedFixture.members[0]!.stream.mockReturnValueOnce(consumer)
    const blockedStream = blocked.stream('count', 4)
    const blockedNext = blockedStream.next().catch((error: unknown) => error)
    await vi.waitFor(() => expect(blockedFixture.members[0]!.stream).toHaveBeenCalledTimes(1))
    const close = blocked.close()
    await expect(blockedStream.throw?.(primary)).rejects.toBe(primary)
    expect(await blockedNext).toBe(primary)
    await close
    expect(throwConsumer).toHaveBeenCalledTimes(1)
    expect(blockedFixture.members[0]!.close).toHaveBeenCalledTimes(1)
    expect(blocked.stats()).toMatchObject({ inFlight: 0, queued: 0, state: 'closed' })
  })
})

describe('pool scheduler ownership', () => {
  it('captures the idle clock once, unrefs its tasks and cancels them on reserve/close', async () => {
    /** The existing public factory port keeps native Peer ownership observable. */
    const { members } = installFactory()
    /** Virtual time owns every idle deadline without replacing the scheduling algorithm. */
    const clock = createManualScheduler()
    /** Each acquired timer requests the optional host liveness hint. */
    const unref = vi.fn()
    /** Cancellation counts actual task releases, not repeated owner checks. */
    let cancels = 0
    /** Option admission must not reread a changing scheduler getter. */
    let reads = 0
    /** The same real heap backs the test's observable task handles. */
    const scheduler = {
      now: clock.now,
      schedule(callback: () => void, delay: number) {
        /** This one handle remains owned until reservation or close cancels it. */
        const task = clock.schedule(callback, delay)
        return {
          cancel() {
            cancels++
            task.cancel()
          },
          unref
        }
      }
    }
    /** Getter admission happens before the original Peer factory acquires anything. */
    const pool = await openPool({
      size: 1,
      idleTimeoutMs: 10,
      get scheduler() {
        reads++
        return scheduler
      }
    })
    expect(reads).toBe(1)
    expect(clock.pendingCount).toBe(1)
    expect(unref).toHaveBeenCalledTimes(1)
    expect(await pool.request('echo', 7)).toBe(7)
    expect(cancels).toBe(1)
    expect(unref).toHaveBeenCalledTimes(2)
    clock.advance(9)
    expect(members[0]!.close).not.toHaveBeenCalled()
    await pool.close()
    expect(cancels).toBe(2)
    expect(clock.pendingCount).toBe(0)
    expect(members[0]!.close).toHaveBeenCalledTimes(1)
  })

  it('expires idle members only when the injected scheduler advances', async () => {
    /** Retirement still closes exactly the original public Peer. */
    const { members } = installFactory()
    /** No native timer is needed for pool retirement. */
    const scheduler = createManualScheduler()
    /** The actual public pool retains its configured target after idle retirement. */
    const pool = await openPool({ size: 1, idleTimeoutMs: 10, scheduler })
    scheduler.advance(10)
    await vi.waitFor(() => expect(members[0]!.close).toHaveBeenCalledTimes(1))
    expect(pool.stats().memberCount).toBe(0)
    expect(scheduler.pendingCount).toBe(0)
    await pool.close()
    expect(members[0]!.close).toHaveBeenCalledTimes(1)
  })

  it('preserves a failed scheduler getter before any native factory starts', async () => {
    /** Input failure remains the exact cause, without replacing it during admission. */
    const cause = new Error('pool scheduler getter failed')
    await expect(
      openPool({
        size: 1,
        get scheduler(): IScheduler {
          throw cause
        }
      })
    ).rejects.toMatchObject({
      source: 'lifecycle',
      code: 'INVALID_OPTION',
      cause
    })
    expect(factories.thread).not.toHaveBeenCalled()
  })
})
