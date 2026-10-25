/** Public witnesses for the scheduling and stream business clauses in original seven cases. */
import { createRpcHost } from '@migaia/rpc-host'
import { createManualScheduler } from '@migaia/utils/testing'
import { expect, it, vi } from 'vitest'
import { pool } from '../dist/index.js'
import { repeatableConnect } from './connect-fixture.js'

/** Only business provider entry and original completion gates are retained by this case. */
type ISchedulingEvidence = {
  dispatches: { id: number; value: number }[]
  pending: Map<number, PromiseWithResolvers<number>>
  streams: number[]
}

/** These are actual application providers reached over framed native Node byte streams. */
class SchedulingProvider {
  /** Native acquisition ordinal independently identifies the real remote Host. */
  readonly #id: number
  /** Case observations are shared with the parent without replacing any RPC resource. */
  readonly #evidence: ISchedulingEvidence
  /** The genuine provider catalog receives these exact business functions. */
  readonly value
  /** Allocate business state only; native acquisition remains with processPlugin.connect. */
  constructor(id: number, evidence: ISchedulingEvidence) {
    this.#id = id
    this.#evidence = evidence
    this.value = { hold: this.#hold, echo: this.#echo, count: this.#count }
  }
  /** Actual provider entry creates the original held completion for this labelled request. */
  readonly #hold = (value: number): Promise<number> => {
    this.#evidence.dispatches.push({ id: this.#id, value })
    const pending = Promise.withResolvers<number>()
    this.#evidence.pending.set(value, pending)
    return pending.promise
  }
  /** Scalar provider entry independently proves rotation and exactly-once dispatch. */
  readonly #echo = (value: number): number => {
    this.#evidence.dispatches.push({ id: this.#id, value })
    return value
  }
  /** User generators remain genuine provider iterators; no local stream facade is constructed. */
  readonly #count = (value: number) => countValues(this.#evidence, value)
}

/** Real application iteration keeps state explicit while native RPC owns the iterator lifecycle. */
async function* countValues(evidence: ISchedulingEvidence, value: number) {
  evidence.streams.push(value)
  yield value
}

it('public Pool preserves original FIFO, queued return, lazy stream and exact local throw clauses', async () => {
  const evidence: ISchedulingEvidence = { dispatches: [], pending: new Map(), streams: [] }
  const source = repeatableConnect({
    provide: (index) => new SchedulingProvider(index, evidence).value
  })
  const host = await createRpcHost({ plugins: [source.transport(pool({ size: 2, maxQueue: 2 }))] })
  const api = host.process
  try {
    const calls = [1, 2, 3, 4].map((value) => api.send('pool', 'hold', value))
    await vi.waitFor(() =>
      expect(evidence.dispatches).toEqual([
        { id: 0, value: 1 },
        { id: 1, value: 2 }
      ])
    )
    expect(api.pool.stats()).toMatchObject({
      memberCount: 2,
      inFlight: 2,
      queued: 2,
      state: 'open'
    })
    expect(Object.isFrozen(api.pool.stats())).toBe(true)
    evidence.pending.get(1)!.resolve(1)
    expect(await calls[0]).toBe(1)
    await vi.waitFor(() => expect(evidence.dispatches.at(-1)).toEqual({ id: 0, value: 3 }))
    const waiting = api.stream('count', 99) as AsyncIterableIterator<unknown>
    const waitingNext = waiting.next()
    await waiting.return?.()
    expect(await waitingNext).toEqual({ done: true, value: undefined })
    expect(api.pool.stats().queued).toBe(1)
    evidence.pending.get(2)!.resolve(2)
    expect(await calls[1]).toBe(2)
    await vi.waitFor(() => expect(evidence.dispatches.at(-1)).toEqual({ id: 1, value: 4 }))
    evidence.pending.get(3)!.resolve(3)
    evidence.pending.get(4)!.resolve(4)
    expect(await Promise.all(calls)).toEqual([1, 2, 3, 4])
    await api.send('pool', 'echo', 5)
    await api.send('pool', 'echo', 6)
    expect(evidence.dispatches.slice(-2)).toEqual([
      { id: 0, value: 5 },
      { id: 1, value: 6 }
    ])
    const returned = api.stream('count', 7) as AsyncIterableIterator<unknown>
    expect(api.pool.stats().inFlight).toBe(0)
    expect(evidence.streams).toHaveLength(0)
    expect(await returned.next()).toEqual({ done: false, value: 7 })
    expect(api.pool.stats().inFlight).toBe(1)
    await returned.return?.()
    expect(api.pool.stats().inFlight).toBe(0)
    const done = api.stream('count', 8) as AsyncIterableIterator<unknown>
    await done.next()
    expect(await done.next()).toEqual({ done: true, value: undefined })
    const thrown = api.stream('count', 9) as AsyncIterableIterator<unknown>
    await thrown.next()
    const reason = new Error('iterator stopped')
    await expect(thrown.throw?.(reason)).rejects.toBe(reason)
    expect(api.pool.stats()).toMatchObject({ inFlight: 0, queued: 0 })
  } finally {
    await host.close()
    await source.close()
  }
})

it('public Pool preserves original queue cancellation, overflow, busy shrink, serialized resize and idle refill clauses', async () => {
  const evidence: ISchedulingEvidence = { dispatches: [], pending: new Map(), streams: [] }
  const clock = createManualScheduler()
  const source = repeatableConnect({
    provide: (index) => new SchedulingProvider(index, evidence).value
  })
  const host = await createRpcHost({
    plugins: [source.transport(pool({ size: 1, maxQueue: 1, idleTimeoutMs: 20, scheduler: clock }))]
  })
  const api = host.process
  try {
    const active = api.send('pool', 'hold', 1)
    await vi.waitFor(() => expect(evidence.pending.has(1)).toBe(true))
    const controller = new AbortController()
    const reason = new Error('queued cancellation')
    const queued = api
      .send('pool', 'echo', 2, { signal: controller.signal })
      .catch((error) => error)
    await expect(api.send('pool', 'echo', 3)).rejects.toMatchObject({
      source: 'rpc.pool',
      code: 'QUEUE_FULL'
    })
    controller.abort(reason)
    const rejected = await queued
    expect(rejected).toBeInstanceOf(DOMException)
    expect(rejected).toMatchObject({ name: 'AbortError', source: 'rpc.pool', code: 'CALL_ABORTED' })
    expect(rejected.cause).toBe(reason)
    expect(api.pool.stats()).toMatchObject({ inFlight: 1, queued: 0 })
    evidence.pending.get(1)!.resolve(1)
    expect(await active).toBe(1)
    await api.pool.resize(2)
    const holds = [api.send('pool', 'hold', 11), api.send('pool', 'hold', 22)]
    await vi.waitFor(() => expect(evidence.pending.has(11) && evidence.pending.has(22)).toBe(true))
    const shrink = api.pool.resize(1)
    expect(source.closeOrder).toEqual([])
    evidence.pending.get(11)!.resolve(11)
    evidence.pending.get(22)!.resolve(22)
    expect(await Promise.all(holds)).toEqual([11, 22])
    await shrink
    expect(api.pool.stats()).toMatchObject({ targetSize: 1, memberCount: 1 })
    expect(source.closeOrder).toHaveLength(1)
    await Promise.all([api.pool.resize(2), api.pool.resize(3)])
    expect(api.pool.stats()).toMatchObject({ targetSize: 3, memberCount: 3 })
    expect(source.opens()).toBe(4)
    clock.advance(20)
    await vi.waitFor(() => expect(api.pool.stats().memberCount).toBe(0))
    expect(await api.send('pool', 'echo', 7)).toBe(7)
    expect(api.pool.stats()).toMatchObject({ targetSize: 3, memberCount: 3 })
  } finally {
    await host.close()
    await source.close()
  }
})
