/** Remaining original stream/cancellation/refill business clauses use genuine private native media. */
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { createManualScheduler } from '@migaia/utils/testing'
import { expect, it, vi } from 'vitest'
import { pool } from '../dist/index.js'
import { repeatableConnect } from './connect-fixture.js'
import { SessionTable } from '../../rpc-host/dist/session/table.js'
import { SessionDrain } from '../../rpc-host/dist/session/drain.js'
import type { IRpcOriginHandle } from '@migaia/rpc-contract/interfaces'

/** This is an application iterator returned by an actual public provider, never a carrier facade. */
class PendingValues implements AsyncIterableIterator<number> {
  /** The user's outstanding next operation has its original completion point. */
  readonly #read = Promise.withResolvers<IteratorResult<number>>()
  /** Actual native provider iterator entry and cleanup are independent observations. */
  reads = 0
  /** Only real StreamProducer cleanup invokes this user method. */
  returns = 0;
  /** User iterability remains the ordinary application protocol. */
  [Symbol.asyncIterator](): AsyncIterableIterator<number> {
    return this
  }
  /** Keep the actual business read pending until its user cleanup settles it. */
  next(): Promise<IteratorResult<number>> {
    this.reads++
    return this.#read.promise
  }
  /** Native cancellation must release the same original read and cleanup once. */
  async return(): Promise<IteratorResult<number>> {
    this.returns++
    const done = { done: true as const, value: undefined }
    this.#read.resolve(done)
    return done
  }
}

/** Real providers own only business gates and signals; native resources belong to processPlugin. */
class TerminalProvider {
  /** The actual provider yields the same original user iterator. */
  readonly pending = new PendingValues()
  /** The real provider independently proves entry before the caller aborts. */
  entered = false
  /** Actual scalar work remains pending until its original provider signal is cancelled. */
  readonly #held = Promise.withResolvers<number>()
  /** Catalog entries are genuine public application methods. */
  readonly value = {
    blocked: () => this.pending,
    hold: (payload: unknown, context: IRpcContext) => this.#hold(payload, context),
    count: countValues
  }
  /** Retain native cancellation through the actual provider signal. */
  #hold(_payload: unknown, context: IRpcContext): Promise<number> {
    this.entered = true
    context.signal.addEventListener('abort', () => this.#held.reject(context.signal.reason), {
      once: true
    })
    return this.#held.promise
  }
}
/** The actual remote generator yields the original caller-labelled portable item. */
async function* countValues(value: number) {
  yield value
}

it('public Pool preserves pending-next return and thrown primary while closing the same real native resource', async () => {
  for (const thrown of [false, true]) {
    const provider = new TerminalProvider()
    const source = repeatableConnect({ provide: () => provider.value })
    const host = await createRpcHost({ plugins: [source.transport(pool({ size: 1 }))] })
    const stream = host.process.stream('blocked') as AsyncIterableIterator<unknown>
    const next = stream.next().catch((error) => error)
    await vi.waitFor(() => expect(provider.pending.reads).toBe(1))
    const closing = host.process.pool.close()
    try {
      if (thrown) {
        const primary = new Error('pending stream termination')
        await expect(stream.throw?.(primary)).rejects.toBe(primary)
        /** Old mock iterator rejected its own read; both actual native runtimes finish it done. */
        expect(await next).toEqual({ done: true, value: undefined })
      } else {
        await stream.return?.()
        expect(await next).toEqual({ done: true, value: undefined })
      }
      await closing
      expect(provider.pending.returns).toBe(1)
      expect(source.closeOrder).toEqual([0])
      expect(host.process.pool.stats()).toMatchObject({ inFlight: 0, queued: 0, state: 'closed' })
    } finally {
      await host.close()
      await source.close()
    }
  }
})

it('public Pool preserves active caller cause and the exact stream abort reason after genuine provider entry', async () => {
  const provider = new TerminalProvider()
  const source = repeatableConnect({ provide: () => provider.value })
  const host = await createRpcHost({ plugins: [source.transport(pool({ size: 1 }))] })
  try {
    const activeController = new AbortController()
    const originalReason = new Error('active native cancellation')
    const active = host.process
      .send('pool', 'hold', 1, { signal: activeController.signal })
      .catch((error) => error)
    await vi.waitFor(() => expect(provider.entered).toBe(true))
    const streamController = new AbortController()
    const stream = host.process.stream('count', 3, {
      signal: streamController.signal
    }) as AsyncIterableIterator<unknown>
    const first = stream.next()
    activeController.abort(originalReason)
    const failed = await active
    expect(failed).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED' })
    expect(failed.cause).toBe(originalReason)
    expect(await first).toEqual({ done: false, value: 3 })
    const streamReason = new Error('stream native cancellation')
    streamController.abort(streamReason)
    const closing = host.process.pool.close()
    await expect(stream.next()).rejects.toBe(streamReason)
    await closing
    expect(host.process.pool.stats()).toMatchObject({ inFlight: 0, queued: 0, state: 'closed' })
    expect(source.closeOrder).toEqual([0])
  } finally {
    await host.close()
    await source.close()
  }
})

it('public Pool preserves exact cold-refill failure for its reserved head and associated FIFO without another acquisition', async () => {
  const clock = createManualScheduler()
  const opened = Promise.withResolvers<void>()
  const source = repeatableConnect({
    beforeOpen: (index) => (index === 1 ? opened.promise : undefined)
  })
  const host = await createRpcHost({
    plugins: [source.transport(pool({ size: 1, idleTimeoutMs: 20, scheduler: clock }))]
  })
  try {
    clock.advance(20)
    await vi.waitFor(() => expect(host.process.pool.stats().memberCount).toBe(0))
    const beforeRefill = source.opens()
    const primary = new Error('cold refill primary')
    const head = host.process.send('pool', 'echo', 77).catch((error) => error)
    const tail = host.process.send('pool', 'echo', 88).catch((error) => error)
    opened.reject(primary)
    expect(await head).toBe(primary)
    expect(await tail).toBe(primary)
    expect(source.remotes).toHaveLength(1)
    expect(host.process.pool.stats()).toMatchObject({ inFlight: 0, queued: 0 })
    await host.process.pool.close()
    expect(source.opens()).toBe(beforeRefill + 1)
  } finally {
    await host.close()
    await source.close()
  }
})

it('retired public Pool origin cannot allocate another Session drain record', async () => {
  /** A pass-through spy observes the original pool's genuine native publication. */
  const attach = SessionTable.prototype.attachOrigin
  /** Only the actual public construction below can fill this original-resource observation. */
  let origin: Readonly<{ table: SessionTable; handle: IRpcOriginHandle }> | undefined
  /** The original owner and handle remain unchanged; no binding or Session view is synthesized. */
  const publication = vi.spyOn(SessionTable.prototype, 'attachOrigin').mockImplementation(function (
    this: SessionTable,
    ...args: Parameters<SessionTable['attachOrigin']>
  ) {
    /** Reflect.apply preserves the native owner receiver while its spy is installed. */
    const handle = Reflect.apply(attach, this, args) as IRpcOriginHandle
    origin = { table: this, handle }
    return handle
  })
  /** The existing fixture acquires real private native media for this public pool. */
  const source = repeatableConnect()
  /** Public installation is the only producer of the observed logical origin. */
  const host = await createRpcHost({ plugins: [source.transport(pool({ size: 1 }))] })
  publication.mockRestore()
  try {
    expect(origin).toBeDefined()
    /** Retire through the original public pool completion before attempting a stale native drain. */
    await host.process.pool.close()
    await origin!.handle.closed
    /** Observe allocation at the existing drain owner, without a new diagnostic API. */
    const draining = vi.spyOn(SessionDrain.prototype, 'drain')
    try {
      await origin!.table.drain(origin!.handle, 100)
      expect(draining).not.toHaveBeenCalled()
    } finally {
      draining.mockRestore()
    }
  } finally {
    publication.mockRestore()
    await host.close()
    await source.close()
  }
})
