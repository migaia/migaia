/** Original scheduling assertions exercise the actual resource owner, without a Peer facade. */
import { createManualScheduler } from '@migaia/utils/testing'
import type { IScheduler } from '@migaia/utils/scheduler'
import { afterEach, expect, it, vi } from 'vitest'
import { PoolScheduler } from '../dist/pool.js'
import { pool as poolFeature, type IPoolPluginOptions } from '../dist/index.js'

/** A resource has native cleanup only; no request, codec, Session or fake wire behavior exists here. */
type IResource = Readonly<{ id: number; close: ReturnType<typeof vi.fn<() => Promise<void>>> }>

/** One case retains original completion gates, dispatch evidence and acquired native resources. */
class Resources {
  /** Real scheduling observations keep original resource/value order. */
  readonly dispatches: { id: number; value: number }[] = []
  /** Only completed native acquisition produces an owned resource. */
  readonly members: IResource[] = []
  /** Accepted operations retain their original business completion Promise. */
  readonly pending = new Map<number, PromiseWithResolvers<number>>()
  /** Reusable acquisition port allows original failed-refill and rollback error witnesses. */
  readonly create = vi.fn(async (): Promise<IResource> => {
    const resource = { id: this.members.length, close: vi.fn(async () => undefined) }
    this.members.push(resource)
    return resource
  })
  /** Only the shared production scheduler owns resource admission and timers. */
  async open(options: IPoolPluginOptions): Promise<PoolScheduler<IResource>> {
    poolFeature(options)
    const scheduler = new PoolScheduler(options, this.create)
    await scheduler.open()
    owners.push(scheduler)
    return scheduler
  }
  /** Each callback returns the actual operation completion borrowed by PoolScheduler.run. */
  run(
    scheduler: PoolScheduler<IResource>,
    value: number,
    held = false,
    signal?: AbortSignal
  ): Promise<number> {
    return scheduler.run((resource) => {
      this.dispatches.push({ id: resource.id, value })
      if (!held) return Promise.resolve(value)
      const completion = Promise.withResolvers<number>()
      this.pending.set(value, completion)
      return completion.promise
    }, signal)
  }
}
/** Final cleanup joins only schedulers actually opened by the current case. */
const owners: PoolScheduler<IResource>[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.allSettled(owners.splice(0).map((owner) => owner.close()))
})

it('dispatches least-in-flight FIFO with rotating ties and lazy stream slots', async () => {
  const fixture = new Resources()
  const scheduler = await fixture.open({ size: 2, maxQueue: 2 })
  const calls = [1, 2, 3, 4].map((value) => fixture.run(scheduler, value, true))
  await vi.waitFor(() =>
    expect(fixture.dispatches).toEqual([
      { id: 0, value: 1 },
      { id: 1, value: 2 }
    ])
  )
  expect(scheduler.stats()).toMatchObject({ memberCount: 2, inFlight: 2, queued: 2, state: 'open' })
  expect(Object.isFrozen(scheduler.stats())).toBe(true)
  fixture.pending.get(1)!.resolve(1)
  expect(await calls[0]).toBe(1)
  await vi.waitFor(() => expect(fixture.dispatches.at(-1)).toEqual({ id: 0, value: 3 }))
  const controller = new AbortController()
  const withdrawn = fixture.run(scheduler, 99, false, controller.signal).catch((error) => error)
  controller.abort()
  await withdrawn
  expect(scheduler.stats().queued).toBe(1)
  fixture.pending.get(2)!.resolve(2)
  expect(await calls[1]).toBe(2)
  await vi.waitFor(() => expect(fixture.dispatches.at(-1)).toEqual({ id: 1, value: 4 }))
  fixture.pending.get(3)!.resolve(3)
  fixture.pending.get(4)!.resolve(4)
  expect(await Promise.all(calls)).toEqual([1, 2, 3, 4])
  await fixture.run(scheduler, 5)
  await fixture.run(scheduler, 6)
  expect(fixture.dispatches.slice(-2)).toEqual([
    { id: 0, value: 5 },
    { id: 1, value: 6 }
  ])
  expect(scheduler.stats()).toMatchObject({ inFlight: 0, queued: 0 })
  await scheduler.close()
})

it('drains accepted request/notify/stream and retires only resize/idle differences', async () => {
  const fixture = new Resources()
  const scheduler = await fixture.open({ size: 2 })
  const completions = [1, 2, 3].map((value) => fixture.run(scheduler, value, true))
  const closing = scheduler.close()
  expect(scheduler.close()).toBe(closing)
  expect(scheduler.stats().state).toBe('closing')
  expect(fixture.members.every((value) => value.close.mock.calls.length === 0)).toBe(true)
  await vi.waitFor(() => expect([...fixture.pending.keys()]).toEqual([1, 2]))
  fixture.pending.get(1)!.resolve(1)
  await completions[0]
  await vi.waitFor(() => expect(fixture.pending.has(3)).toBe(true))
  fixture.pending.get(3)!.resolve(3)
  await completions[2]
  expect(fixture.members.every((value) => value.close.mock.calls.length === 0)).toBe(true)
  fixture.pending.get(2)!.resolve(2)
  await completions[1]
  await closing
  expect(fixture.members.map((value) => value.close.mock.calls.length)).toEqual([1, 1])
  expect(scheduler.stats().state).toBe('closed')

  const resizedFixture = new Resources()
  const resized = await resizedFixture.open({ size: 2 })
  const holds = [fixtureRun(resizedFixture, resized, 11), fixtureRun(resizedFixture, resized, 22)]
  const shrink = resized.resize(1)
  await vi.waitFor(() => expect([...resizedFixture.pending.keys()]).toEqual([11, 22]))
  expect(resizedFixture.members.every((value) => value.close.mock.calls.length === 0)).toBe(true)
  resizedFixture.pending.get(11)!.resolve(11)
  resizedFixture.pending.get(22)!.resolve(22)
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

  const clock = createManualScheduler()
  const idleFixture = new Resources()
  const idle = await idleFixture.open({ size: 1, maxQueue: 0, idleTimeoutMs: 20, scheduler: clock })
  clock.advance(20)
  await vi.waitFor(() => expect(idleFixture.members[0]!.close).toHaveBeenCalledTimes(1))
  expect(idle.stats().memberCount).toBe(0)
  expect(await idleFixture.run(idle, 7)).toBe(7)
  expect(idleFixture.members).toHaveLength(2)
  expect(idle.stats()).toMatchObject({ targetSize: 1, memberCount: 1 })
  await idle.close()

  const coldFixture = new Resources()
  const coldClock = createManualScheduler()
  const cold = await coldFixture.open({ size: 1, idleTimeoutMs: 20, scheduler: coldClock })
  coldClock.advance(20)
  await vi.waitFor(() => expect(cold.stats().memberCount).toBe(0))
  const opened = Promise.withResolvers<IResource>()
  const beforeRefill = coldFixture.create.mock.calls.length
  coldFixture.create.mockImplementationOnce(() => opened.promise)
  const primary = new Error('cold refill primary')
  const head = coldFixture.run(cold, 77).catch((error) => error)
  const tail = coldFixture.run(cold, 88).catch((error) => error)
  opened.reject(primary)
  expect(await head).toBe(primary)
  expect(await tail).toBe(primary)
  expect(coldFixture.members).toHaveLength(1)
  expect(cold.stats()).toMatchObject({ inFlight: 0, queued: 0 })
  await cold.close()
  expect(coldFixture.create).toHaveBeenCalledTimes(beforeRefill + 1)

  const failingFixture = new Resources()
  const failing = await failingFixture.open({ size: 2 })
  const failures = [new Error('first close'), new Error('second close')]
  failingFixture.members.forEach((value, index) =>
    value.close.mockRejectedValueOnce(failures[index])
  )
  const failure = await failing.close().catch((error) => error)
  expect(failure).toBeInstanceOf(AggregateError)
  expect(failure).toMatchObject({ source: 'rpc.pool', code: 'CLOSE_FAILED' })
  expect((failure as AggregateError).errors).toEqual(failures)
})

/** Keep the original held operation explicit at the actual run boundary. */
function fixtureRun(fixture: Resources, scheduler: PoolScheduler<IResource>, value: number) {
  return fixture.run(scheduler, value, true)
}

it('rejects overflow/new closed work and validates before native acquisition', async () => {
  const fixture = new Resources()
  const scheduler = await fixture.open({ size: 1, maxQueue: 1 })
  const active = fixture.run(scheduler, 1, true)
  const queued = fixture.run(scheduler, 2)
  await expect(fixture.run(scheduler, 3)).rejects.toMatchObject({
    source: 'rpc.pool',
    code: 'QUEUE_FULL'
  })
  expect(fixture.dispatches).toEqual([{ id: 0, value: 1 }])
  const closing = scheduler.close()
  await expect(fixture.run(scheduler, 4)).rejects.toMatchObject({ code: 'POOL_CLOSED' })
  fixture.pending.get(1)!.resolve(1)
  expect(await active).toBe(1)
  expect(await queued).toBe(2)
  await closing
  await expect(scheduler.resize(2)).rejects.toMatchObject({ code: 'POOL_CLOSED' })
  const zeroFixture = new Resources()
  const zero = await zeroFixture.open({ size: 1, maxQueue: 0 })
  const held = zeroFixture.run(zero, 5, true)
  await expect(zeroFixture.run(zero, 6)).rejects.toMatchObject({ code: 'QUEUE_FULL' })
  expect(zeroFixture.dispatches).toEqual([{ id: 0, value: 5 }])
  zeroFixture.pending.get(5)!.resolve(5)
  await held
  await zero.close()
  const invalidFixture = new Resources()
  for (const options of [
    { size: 0 },
    { size: 1, maxQueue: -1 },
    { size: 1, idleTimeoutMs: 2147483648 }
  ])
    await expect(invalidFixture.open(options)).rejects.toMatchObject({
      name: 'RangeError',
      code: 'INVALID_OPTIONS'
    })
  await expect(
    Promise.resolve().then(() => Reflect.apply(poolFeature, undefined, [null]))
  ).rejects.toMatchObject({ name: 'TypeError', code: 'INVALID_OPTIONS' })
  expect(invalidFixture.create).not.toHaveBeenCalled()
  const rollbackFixture = new Resources()
  const survivor = { id: 0, close: vi.fn(async () => undefined) }
  const primary = new Error('native creation failed')
  const cleanup = new Error('rollback close failed')
  survivor.close.mockRejectedValueOnce(cleanup)
  rollbackFixture.create.mockResolvedValueOnce(survivor).mockRejectedValueOnce(primary)
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    await expect(rollbackFixture.open({ size: 2 })).rejects.toBe(primary)
    expect(survivor.close).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith(cleanup)
  } finally {
    report.mockRestore()
  }
})

it('ignores a repeated release so close still drains queued work', async () => {
  const fixture = new Resources()
  const scheduler = await fixture.open({ size: 1 })
  for (let cycle = 0; cycle < 2; cycle++) {
    const slot = await scheduler.acquire()
    scheduler.release(slot)
    scheduler.release(slot)
  }
  const active = fixture.run(scheduler, 1, true)
  const queued = fixture.run(scheduler, 2)
  await vi.waitFor(() => expect(fixture.pending.has(1)).toBe(true))
  const closing = scheduler.close()
  fixture.pending.get(1)!.resolve(1)
  expect(await active).toBe(1)
  expect(await queued).toBe(2)
  await closing
  expect(fixture.dispatches).toEqual([
    { id: 0, value: 1 },
    { id: 0, value: 2 }
  ])
})

it('removes queued cancellation and passes active options/errors to the Peer unchanged', async () => {
  const fixture = new Resources()
  const scheduler = await fixture.open({ size: 1, maxQueue: 2 })
  const queuedController = new AbortController()
  const queuedReason = new Error('queued cancellation')
  const nativeFailure = new DOMException('native cancelled', 'AbortError')
  const originalReason = new Error('active native cancellation')
  Object.defineProperty(nativeFailure, 'cause', { value: originalReason })
  const pending = Promise.withResolvers<number>()
  const active = scheduler.run(() => pending.promise).catch((error) => error)
  await vi.waitFor(() => expect(scheduler.stats().inFlight).toBe(1))
  const queued = fixture.run(scheduler, 2, false, queuedController.signal).catch((error) => error)
  queuedController.abort(queuedReason)
  const rejected = await queued
  expect(rejected).toBeInstanceOf(DOMException)
  expect(rejected).toMatchObject({ name: 'AbortError', source: 'rpc.pool', code: 'CALL_ABORTED' })
  expect((rejected as Error).cause).toBe(queuedReason)
  expect(scheduler.stats()).toMatchObject({ inFlight: 1, queued: 0 })
  const streamReason = new Error('stream native cancellation')
  const finished = Promise.withResolvers<number>()
  const terminal = scheduler.run(() => finished.promise).catch((error) => error)
  pending.reject(nativeFailure)
  expect(await active).toBe(nativeFailure)
  await vi.waitFor(() => expect(scheduler.stats().inFlight).toBe(1))
  const closing = scheduler.close()
  finished.reject(streamReason)
  expect(await terminal).toBe(streamReason)
  await closing
  expect(scheduler.stats()).toMatchObject({ inFlight: 0, queued: 0, state: 'closed' })
  expect(fixture.members[0]!.close).toHaveBeenCalledTimes(1)
})

/** One observable task wrapper borrows the genuine manual heap's timer ownership. */
class IdleClock {
  /** Native timer release count observes actual cancel calls only. */
  cancels = 0
  /** The existing manual scheduler retains all timer/deadline state. */
  readonly #clock: ReturnType<typeof createManualScheduler>
  /** Native liveness hints are observed independently from deadlines. */
  readonly #unref: () => void
  /** Scheduler input is captured once at the actual production constructor. */
  readonly value: IScheduler
  /** Capture only existing heap and observation ports. */
  constructor(clock: ReturnType<typeof createManualScheduler>, unref: () => void) {
    this.#clock = clock
    this.#unref = unref
    this.value = { now: clock.now, schedule: this.#schedule }
  }
  /** The returned original task owns its exact cancel receipt. */
  readonly #schedule = (callback: () => void, delay: number) => {
    const task = this.#clock.schedule(callback, delay)
    return {
      cancel: () => {
        this.cancels++
        task.cancel()
      },
      unref: this.#unref
    }
  }
}

it('captures the idle clock once, unrefs its tasks and cancels them on reserve/close', async () => {
  const fixture = new Resources()
  const clock = createManualScheduler()
  const unref = vi.fn()
  let reads = 0
  const idleClock = new IdleClock(clock, unref)
  const pool = await fixture.open({
    size: 1,
    idleTimeoutMs: 10,
    get scheduler() {
      reads++
      return idleClock.value
    }
  })
  expect(reads).toBe(1)
  expect(clock.pendingCount).toBe(1)
  expect(unref).toHaveBeenCalledTimes(1)
  expect(await fixture.run(pool, 7)).toBe(7)
  expect(idleClock.cancels).toBe(1)
  expect(unref).toHaveBeenCalledTimes(2)
  clock.advance(9)
  expect(fixture.members[0]!.close).not.toHaveBeenCalled()
  await pool.close()
  expect(idleClock.cancels).toBe(2)
  expect(clock.pendingCount).toBe(0)
  expect(fixture.members[0]!.close).toHaveBeenCalledTimes(1)
})

it('expires idle members only when the injected scheduler advances', async () => {
  const fixture = new Resources()
  const scheduler = createManualScheduler()
  const pool = await fixture.open({ size: 1, idleTimeoutMs: 10, scheduler })
  scheduler.advance(10)
  await vi.waitFor(() => expect(fixture.members[0]!.close).toHaveBeenCalledTimes(1))
  expect(pool.stats().memberCount).toBe(0)
  expect(scheduler.pendingCount).toBe(0)
  await pool.close()
  expect(fixture.members[0]!.close).toHaveBeenCalledTimes(1)
})

it('preserves a failed scheduler getter before any native factory starts', async () => {
  const fixture = new Resources()
  const cause = new Error('pool scheduler getter failed')
  await expect(
    fixture.open({
      size: 1,
      get scheduler(): IScheduler {
        throw cause
      }
    })
  ).rejects.toMatchObject({ source: 'lifecycle', code: 'INVALID_OPTION', cause })
  expect(fixture.create).not.toHaveBeenCalled()
})
