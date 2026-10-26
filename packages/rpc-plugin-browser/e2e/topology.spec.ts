/**
 * Browser forwarding topologies on real realms: a cross-origin iframe calls the top window's
 * dedicated worker through the top window, and one tab calls another through a SharedWorker hub.
 */
import { expect, test, type Frame, type Page } from '@playwright/test'
import { RpcProbeKind, RpcProbeOutcome } from '@migaia/rpc-contract/interfaces'
import {
  Topology,
  type ITopologyLeafSnapshot,
  type ITopologyProbeEvent
} from '../../rpc-integration/test/host/fixtures/topology-vocabulary.ts'
import { BrowserTopology } from './browser-peer/topology-names.ts'

/** Classified error returned from inside a realm. */
type ISettled = Readonly<{
  value?: unknown
  error?: Readonly<{
    chain: readonly Readonly<{ source?: string; code?: string; message?: string }>[]
    route: unknown
  }>
}>

/** Probe row copied by the forwarding window. */
type IForwardRow = Readonly<{ outcome: number; hop: number; route: readonly string[] }>

/** T2 separates both forwarding hosts' observations from the SharedWorker leaf's business counters. */
type INestedInspection = Readonly<{
  forward: readonly IForwardRow[]
  messages: readonly ITopologyProbeEvent[]
  auth: Readonly<{ signed: number; verified: number }>
  intermediate: Readonly<{
    forward: readonly IForwardRow[]
    messages: readonly ITopologyProbeEvent[]
    auth: Readonly<{ signed: number; verified: number }>
  }>
  worker: ITopologyLeafSnapshot
}>

/** Numeric probe outcomes the forward stage reports (contract constants). */
const Outcome = { sent: 2, received: 3 } as const

/**
 * Open the top window, wait for its hosts, and return the cross-origin iframe frame.
 *
 * @param page Playwright page.
 * @param query Optional query string for the top window.
 */
async function openTopology(page: Page, query = ''): Promise<Frame> {
  await page.goto(`/browser-peer/topology-top.html${query}`)
  await page.evaluate(async () => {
    await globalThis.topologyTop
  })
  /** The iframe realm served from the second origin. */
  const frame = page.frames().find((candidate) => candidate.url().includes('topology-frame.html'))
  expect(frame).toBeDefined()
  await frame!.waitForFunction(() => globalThis.topologyFrame !== undefined)
  return frame!
}

/** Run one named iframe operation and return its portable result. */
function run<T>(frame: Frame, operation: string, argument?: unknown): Promise<T> {
  return frame.evaluate(
    ([name, value]) =>
      (globalThis.topologyFrame[name as string] as (input?: unknown) => Promise<unknown>)(value),
    [operation, argument] as const
  ) as Promise<T>
}

/** Match each forwarding consumer's public creation with its terminal event in one linear pass. */
function streamCompletion(events: readonly ITopologyProbeEvent[]) {
  /** Only owner-local creation and settlement count; physical copies do not inflate the totals. */
  const opened = new Set<string>()
  /** Terminal message identities come from the same public probe owner as creation. */
  const ended = new Set<string>()
  for (const event of events) {
    if (event.kind === RpcProbeKind.streamOpen && event.outcome === RpcProbeOutcome.created)
      opened.add(event.messageId)
    if (
      event.kind === RpcProbeKind.streamClose &&
      (event.outcome === RpcProbeOutcome.settled || event.outcome === RpcProbeOutcome.failed)
    )
      ended.add(event.messageId)
  }
  /** Unmatched public lifecycle events disclose outstanding streams without a private table hook. */
  let unmatched = 0
  for (const id of opened) if (!ended.has(id)) unmatched += 1
  return { opened: opened.size, ended: ended.size, unmatched }
}

test.describe('iframe calls the top window dedicated worker through the top window', () => {
  test('executes once on the worker, observes the hop, and restores the leaf failure', async ({
    page
  }) => {
    /** Cross-origin iframe realm. */
    const frame = await openTopology(page)
    expect(await run<ISettled>(frame, 'echo', 1)).toEqual({
      value: expect.objectContaining({ value: 1, seq: 1 })
    })
    /** Leaf failure classified inside the iframe. */
    const failed = await run<ISettled>(frame, 'fail')
    expect(failed.error!.chain).toContainEqual(
      expect.objectContaining({ source: 'app.topology', code: 'LEAF_FAILED' })
    )
    expect(failed.error!.chain).toContainEqual(
      expect.objectContaining({ message: 'leaf root cause' })
    )
    /** Forward rows on the top window and the worker's counters. */
    const inspected = await run<{
      forward: IForwardRow[]
      worker: { echoCalls: number; failCalls: number }
    }>(frame, 'inspect')
    expect([inspected.worker.echoCalls, inspected.worker.failCalls]).toEqual([1, 1])
    expect(inspected.forward.slice(0, 2).map((row) => [row.outcome, row.hop])).toEqual([
      [Outcome.received, 1],
      [Outcome.sent, 1]
    ])
    expect(inspected.forward[1]!.route).toHaveLength(2)
    expect(failed.error!.route).toEqual(expect.any(Array))
  })

  test('cancels a forwarded stream, propagates abort, deadline and 1 MiB binary', async ({
    page
  }) => {
    /** Cross-origin iframe realm. */
    const frame = await openTopology(page)
    expect(await run(frame, 'streamCancel')).toEqual([0, 1, 2])
    await expect
      .poll(
        async () =>
          (await run<{ worker: { streamsFinalized: number } }>(frame, 'inspect')).worker
            .streamsFinalized
      )
      .toBe(1)
    /** Abort settles the forwarded wait. */
    const aborted = await run<ISettled>(frame, 'abort')
    expect(aborted.error).toBeDefined()
    await expect
      .poll(
        async () => (await run<{ worker: { aborts: string[] } }>(frame, 'inspect')).worker.aborts
      )
      .toEqual(['caller stopped'])
    /** Remaining time the worker observed for a 5 s budget. */
    const deadline = await run<ISettled>(frame, 'deadline')
    expect((deadline.value as { timeoutMs: number }).timeoutMs).toBeGreaterThan(0)
    expect((deadline.value as { timeoutMs: number }).timeoutMs).toBeLessThanOrEqual(5000)
    expect(await run<ISettled>(frame, 'bytes')).toEqual({
      value: { length: 1 << 20, mismatches: 0 }
    })
  })

  test('auth on the window–worker hop signs and verifies only that hop', async ({ page }) => {
    /** Cross-origin iframe realm, with auth on the worker hop. */
    const frame = await openTopology(page, '?auth=match')
    expect(await run<ISettled>(frame, 'echo', 3)).toEqual({
      value: expect.objectContaining({ value: 3 })
    })
    /** Transform counts on both sides of the worker hop. */
    const inspected = await run<{
      auth: { signed: number; verified: number }
      worker: { auth: { signed: number; verified: number } }
    }>(frame, 'inspect')
    expect(inspected.auth.signed).toBeGreaterThan(0)
    expect(inspected.auth.verified).toBeGreaterThan(0)
    expect(inspected.worker.auth.signed).toBeGreaterThan(0)
    expect(inspected.worker.auth.verified).toBeGreaterThan(0)
  })

  test('closing the worker hop settles the in-flight call with an existing code', async ({
    page
  }) => {
    /** Cross-origin iframe realm. */
    const frame = await openTopology(page)
    /** In-flight wait settled by the middle close. */
    const closed = await run<ISettled>(frame, 'closeMiddle')
    expect(closed.error!.chain[0]).toMatchObject({ code: expect.any(String) })
  })
})

test.describe('one tab calls another tab through a shared SharedWorker hub', () => {
  test('executes once on the other tab and observes the hub hop', async ({ context }) => {
    /** Two tabs of one origin sharing one hub worker. */
    const [first, second] = await Promise.all([context.newPage(), context.newPage()])
    await first.goto('/browser-peer/topology-tab.html?tab=tab1')
    await second.goto('/browser-peer/topology-tab.html?tab=tab2')
    for (const page of [first, second]) await page.evaluate(() => globalThis.topologyTab.ready())
    expect(
      await first.evaluate(() =>
        globalThis.topologyTab.callTab('tab2' as never, 'echo' as never, 11 as never)
      )
    ).toEqual({ value: expect.objectContaining({ value: 11, seq: 1 }) })
    /** Leaf failure from tab2, classified in tab1. */
    const failed = (await first.evaluate(() =>
      globalThis.topologyTab.callTab('tab2' as never, 'fail' as never)
    )) as ISettled
    expect(failed.error!.chain).toContainEqual(
      expect.objectContaining({ source: 'app.topology', code: 'LEAF_FAILED' })
    )
    /** Tab2's own counters: one echo and one failure. */
    const leaf = (await second.evaluate(() => globalThis.topologyTab.leaf())) as {
      echoCalls: number
      failCalls: number
    }
    expect([leaf.echoCalls, leaf.failCalls]).toEqual([1, 1])
    /** Tab1 executed nothing. */
    expect(
      ((await first.evaluate(() => globalThis.topologyTab.leaf())) as { echoCalls: number })
        .echoCalls
    ).toBe(0)
    /** The hub's forward rows for the two calls. */
    const hub = (await first.evaluate(() => globalThis.topologyTab.hub())) as {
      forward: IForwardRow[]
    }
    expect(hub.forward.slice(0, 2).map((row) => [row.outcome, row.hop])).toEqual([
      [Outcome.received, 1],
      [Outcome.sent, 1]
    ])
    expect(failed.error!.route).toEqual(expect.any(Array))
  })
})

test.describe('iframe reaches a SharedWorker through window and dedicated worker forwarding', () => {
  test('returns to both origins, executes once, observes both hops, and restores the leaf failure', async ({
    page
  }) => {
    /** Same cross-origin iframe operations as T1, with one additional advertised peer segment. */
    const frame = await openTopology(page, `?${BrowserTopology.nestedQuery}=1`)
    expect(await run<ISettled>(frame, 'echo', 21)).toEqual({
      value: expect.objectContaining({ value: 21, seq: 1 })
    })
    /** The SharedWorker's failure crosses both forwarding hosts before reaching the iframe. */
    const failed = await run<ISettled>(frame, 'fail')
    expect(failed.error!.chain).toContainEqual(
      expect.objectContaining({ source: 'app.topology', code: 'LEAF_FAILED' })
    )
    expect(failed.error!.chain).toContainEqual(
      expect.objectContaining({ message: 'leaf root cause' })
    )
    expect(failed.error!.route).toEqual(expect.any(Array))
    expect(failed.error!.route).toHaveLength(3)
    /** Each host reports its actual position; the leaf independently proves single execution. */
    const inspected = await run<INestedInspection>(frame, 'inspect')
    expect([inspected.worker.echoCalls, inspected.worker.failCalls]).toEqual([1, 1])
    expect(inspected.forward.slice(0, 2).map((row) => [row.outcome, row.hop])).toEqual([
      [Outcome.received, 1],
      [Outcome.sent, 1]
    ])
    expect(inspected.intermediate.forward.slice(0, 2).map((row) => [row.outcome, row.hop])).toEqual(
      [
        [Outcome.received, 2],
        [Outcome.sent, 2]
      ]
    )
    expect(inspected.forward[1]!.route).toHaveLength(2)
    expect(inspected.intermediate.forward[1]!.route).toHaveLength(3)
    expect(inspected.worker.messages.some((row) => row.hop === 2 && row.route.length === 3)).toBe(
      true
    )
    /** The top window also originates the same public call, and receives its own result. */
    expect(
      await page.evaluate(
        async ({ target, method, trace }) =>
          (await globalThis.topologyTop).worker.send(target, method, 22, { trace }),
        {
          target: BrowserTopology.worker,
          method: `${BrowserTopology.sharedLeaf}.${Topology.echo}`,
          trace: Topology.trace
        }
      )
    ).toMatchObject({ value: 22, seq: 2 })
    /** This origin has only the dedicated worker as a forwarder, so its hop restarts at one. */
    const after = await run<INestedInspection>(frame, 'inspect')
    expect(after.worker.echoCalls).toBe(2)
    expect(after.intermediate.forward.slice(-2).map((row) => [row.outcome, row.hop])).toEqual([
      [Outcome.received, 1],
      [Outcome.sent, 1]
    ])
  })

  test('cancels through both forwarders and preserves abort, deadline and 1 MiB binary', async ({
    page
  }) => {
    /** The existing T1 operations now traverse the dedicated worker's SharedWorker connection too. */
    const frame = await openTopology(page, `?${BrowserTopology.nestedQuery}=1`)
    expect(await run(frame, 'streamCancel')).toEqual([0, 1, 2])
    await expect
      .poll(async () => (await run<INestedInspection>(frame, 'inspect')).worker.streamsFinalized)
      .toBe(1)
    /** Both forwarding hosts expose the consumer's real stream start and terminal settlement. */
    await expect
      .poll(async () => {
        /** Snapshots copy the existing public probe fields; no private stream state is read. */
        const observed = await run<INestedInspection>(frame, 'inspect')
        return {
          window: streamCompletion(observed.messages),
          dedicatedWorker: streamCompletion(observed.intermediate.messages)
        }
      })
      .toEqual({
        window: { opened: 1, ended: 1, unmatched: 0 },
        dedicatedWorker: { opened: 1, ended: 1, unmatched: 0 }
      })
    /** Preserve the actual public evidence with the existing Playwright artifact mechanism. */
    const streams = await run<INestedInspection>(frame, 'inspect')
    await test.info().attach('t2-stream-hop-events', {
      body: JSON.stringify({
        window: streamCompletion(streams.messages),
        dedicatedWorker: streamCompletion(streams.intermediate.messages),
        leaf: { opened: streams.worker.streamsOpened, finalized: streams.worker.streamsFinalized }
      }),
      contentType: 'application/json'
    })
    /** Cancellation of the scalar call reaches the SharedWorker's own context signal. */
    const aborted = await run<ISettled>(frame, 'abort')
    expect(aborted.error).toBeDefined()
    await expect
      .poll(async () => (await run<INestedInspection>(frame, 'inspect')).worker.aborts)
      .toEqual(['caller stopped'])
    /** Intermediate hosts preserve the caller's remaining five-second budget. */
    const deadline = await run<ISettled>(frame, 'deadline')
    expect((deadline.value as { timeoutMs: number }).timeoutMs).toBeGreaterThan(0)
    expect((deadline.value as { timeoutMs: number }).timeoutMs).toBeLessThanOrEqual(5000)
    expect(await run<ISettled>(frame, 'bytes')).toEqual({
      value: { length: 1 << 20, mismatches: 0 }
    })
    /**
     * A finalized leaf generator is observable; private per-hop stream-table counts are not
     * exposed.
     */
    expect((await run<INestedInspection>(frame, 'inspect')).worker.streamsOpened).toBe(1)
  })

  test('auth signs only the window–dedicated worker hop before the plain SharedWorker leaf', async ({
    page
  }) => {
    /** The middle hop alone installs auth on both ends. */
    const frame = await openTopology(page, `?${BrowserTopology.nestedQuery}=1&auth=match`)
    expect(await run<ISettled>(frame, 'echo', 23)).toEqual({
      value: expect.objectContaining({ value: 23, seq: 1 })
    })
    /** Both middle-hop peers run transforms, while the final SharedWorker has no auth transforms. */
    const inspected = await run<INestedInspection>(frame, 'inspect')
    expect(inspected.auth.signed).toBeGreaterThan(0)
    expect(inspected.auth.verified).toBeGreaterThan(0)
    expect(inspected.intermediate.auth.signed).toBeGreaterThan(0)
    expect(inspected.intermediate.auth.verified).toBeGreaterThan(0)
    expect(inspected.worker.auth).toEqual({ signed: 0, verified: 0 })
  })

  test('closing the window worker connection settles a SharedWorker call with its close reason', async ({
    page
  }) => {
    /** The original middle-close operation now interrupts a call whose leaf is one hop further away. */
    const frame = await openTopology(page, `?${BrowserTopology.nestedQuery}=1`)
    /** The existing lifecycle error chain remains reachable at the iframe origin. */
    const closed = await run<ISettled>(frame, 'closeMiddle')
    expect(closed.error!.chain).toContainEqual(
      expect.objectContaining({ code: 'ENDPOINT_DISPOSED' })
    )
  })
})
