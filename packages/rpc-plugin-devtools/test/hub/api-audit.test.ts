import { expect, it } from 'vitest'
import { createEndpoint, connect } from '../../../rpc-host/dist/core/index.js'
import { probePlugin } from '@migaia/rpc-host/probe'
import { createMemoryTransportPair } from '@migaia/rpc-host/adapters/memory'
import { devtoolsPlugin, type IRpcDevtools } from '../../src/index.js'
import { createRpcDevtoolsHub, type IRpcDevtoolsTargetClient } from '../../src/hub/index.js'
import {
  encodeRpcDevtoolsRecord,
  RpcDevtoolsRecordFormat,
  type IRpcDevtoolsWatchBatch
} from '../../src/contract/index.js'
import { HubServiceMethod } from '../../src/hub/text.js'
import { collectorView, CollectorFixture } from '../collector/fixture.js'

/** Route the complete supported client port to the actual Collector's public operations. */
function localClient(collector: IRpcDevtools, afterQuery?: () => void): IRpcDevtoolsTargetClient {
  return {
    async request(method, input) {
      if (method === HubServiceMethod.query) {
        const page = collector.query(input as Parameters<typeof collector.query>[0])
        afterQuery?.()
        return page
      }
      if (method === HubServiceMethod.stats) return collector.stats()
      return collector.describe()
    },
    stream: () => collector.watch()
  }
}

it('aligns events actually emitted by the public Core Endpoint with the same monotonic clock', async () => {
  /** The same public built Core creates both the genuine Probe registration and Endpoint. */
  const collector = devtoolsPlugin({ onError: () => undefined }).collector
  /** This Hub samples only real Collector responses, without an invented remote timestamp. */
  const hub = createRpcDevtoolsHub({ onError: () => undefined })
  /** Native queued memory delivery drives the real Core request/probe emission path. */
  const [left, right] = createMemoryTransportPair()
  /** The provider handles the actual call. */
  const server = await createEndpoint({
    id: 'audit-server',
    transport: right,
    middlewares: [connect({ transport: right })]
  })
  server.provide(CollectorFixture.method, (context) => context.success(context.data))
  /** A single installed public Probe forwards the native Core event into this Collector. */
  const client = await createEndpoint({
    id: 'audit-client',
    targetIds: ['audit-server'],
    transport: left,
    middlewares: [connect({ transport: left }), probePlugin(collector)]
  })
  try {
    expect(await client.send('audit-server', CollectorFixture.method, 7)).toBe(7)
    await hub.addTarget('local', localClient(collector))
    /** Epoch/monotonic mixing differs by 10^12ms; this is a domain check, not an RTT benchmark. */
    const observed = hub.timeline().find((item) => item.event.method === CollectorFixture.method)!
    expect(Math.abs(observed.alignedAt - performance.now())).toBeLessThan(10_000)
  } finally {
    await client.dispose()
    await server.dispose()
    left.close()
    collector.close()
    await hub.close()
  }
})

it('globally sorts valid nonmonotonic records before applying a timeline limit', async () => {
  /** Public record grammar permits arbitrary finite at values in sequence/file order. */
  const event = (seq: number, at: number) => ({
    seq,
    at,
    endpointId: 'audit',
    stage: 'message',
    direction: 'outbound'
  })
  /** Both inputs pass the public encoder, rather than mutating a retained readonly event. */
  const hub = createRpcDevtoolsHub()
  try {
    hub.importRecord(
      'a',
      encodeRpcDevtoolsRecord({
        header: RpcDevtoolsRecordFormat,
        events: [event(1, 200), event(2, 100)]
      })
    )
    hub.importRecord(
      'b',
      encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [event(1, 150)] })
    )
    expect(hub.timeline().map((item) => item.alignedAt)).toEqual([100, 150, 200])
    expect(hub.timeline({ limit: 2 }).map((item) => item.alignedAt)).toEqual([100, 150])
  } finally {
    await hub.close()
  }
})

it('retains a real Collector event arriving after the historical query snapshot', async () => {
  /** All events and service pages belong to the same actual Collector. */
  const collector = devtoolsPlugin({ onError: () => undefined }).collector
  /** A one-time concurrent emit lands in the historical/future handoff window. */
  let inserted = false
  /** The public client only inserts a real event after producing its real page snapshot. */
  const client = localClient(collector, () => {
    if (!inserted) {
      inserted = true
      collector.emit(collectorView(2))
    }
  })
  /** The Hub owns its normal watch and target retention. */
  const hub = createRpcDevtoolsHub({ onError: () => undefined })
  try {
    collector.emit(collectorView(1))
    await hub.addTarget('local', client)
    collector.emit(collectorView(3))
    await expect.poll(() => hub.timeline().map((item) => item.event.seq)).toEqual([1, 2, 3])
  } finally {
    collector.close()
    await hub.close()
  }
})

it('iterator return completes a pending local watch next without closing its Collector', async () => {
  /** The Collector remains open while its consumer relinquishes just this one iterator. */
  const collector = devtoolsPlugin().collector
  /** The first read activates the actual native async generator and waits for a future event. */
  const iterator = collector.watch()
  /** Observe both outcomes even on the original broken implementation's timed failure path. */
  const pending = iterator.next()
  /** Record completion without requiring a Collector close to wake the pending read. */
  let finished = false
  /** The same public return Promise must settle once its preceding next can finish. */
  const returning = iterator.return(undefined).then(() => {
    finished = true
  })
  try {
    await expect.poll(() => finished, { timeout: 200 }).toBe(true)
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(collector.query().events).toEqual([])
  } finally {
    collector.close()
    await Promise.allSettled([pending, returning])
  }
})

it('Hub close releases its own local watch before the Collector closes', async () => {
  /** Reports must not mistake an intentional consumer return for Collector CLOSED. */
  const reports: unknown[] = []
  /** The Hub and Collector have distinct public ownership and lifetimes. */
  const collector = devtoolsPlugin({
    onError: (error) => {
      reports.push(error)
    }
  }).collector
  /** The Hub borrows the client while owning only its acquired watch. */
  const hub = createRpcDevtoolsHub({
    onError: (error) => {
      reports.push(error)
    }
  })
  await hub.addTarget('local', localClient(collector))
  /** Joining close must not require an unrelated owner to close its Collector. */
  let finished = false
  /** Observe the actual public close completion independently of final cleanup. */
  const closing = hub.close().then(() => {
    finished = true
  })
  try {
    await expect.poll(() => finished, { timeout: 200 }).toBe(true)
    expect(collector.query().events).toEqual([])
    expect(reports).toEqual([])
  } finally {
    collector.close()
    await closing
  }
})

it('classifies its owned native cleanup AggregateError while retaining the application cause', async () => {
  /** Original application errors keep their own identity and are not relabeled as Devtools errors. */
  const original = new TypeError('audit target return failed')
  /** Public requests still return genuine Collector service results. */
  const collector = devtoolsPlugin().collector
  /** Only the application's iterator release fails; all public structural operations exist. */
  const iterator: AsyncIterableIterator<IRpcDevtoolsWatchBatch> = {
    next: () => new Promise(() => undefined),
    async return() {
      throw original
    },
    [Symbol.asyncIterator]() {
      return this
    }
  }
  /** The Hub owns the new aggregate, while the original callback error remains application data. */
  const reports: unknown[] = []
  /** The client borrows the real Collector's request port and supplies its own valid iterator. */
  const client: IRpcDevtoolsTargetClient = {
    request: localClient(collector).request,
    stream: () => iterator
  }
  /** Close reports cleanup failure and continues to resolve according to the existing contract. */
  const hub = createRpcDevtoolsHub({
    onError: (error) => {
      reports.push(error)
    }
  })
  try {
    await hub.addTarget('local', client)
    await hub.close()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toBeInstanceOf(AggregateError)
    expect(reports[0]).toMatchObject({
      source: 'rpc.devtools',
      code: 'TARGET_RELEASE_FAILED',
      cause: original,
      errors: [original]
    })
  } finally {
    collector.close()
    await hub.close()
  }
})
