/**
 * Browser forwarding topologies on real realms: a cross-origin iframe calls the top window's
 * dedicated worker through the top window, and one tab calls another through a SharedWorker hub.
 */
import { expect, test, type Frame, type Page } from '@playwright/test'

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
      .poll(async () => (await run<{ worker: { streamsFinalized: number } }>(frame, 'inspect')).worker.streamsFinalized)
      .toBe(1)
    /** Abort settles the forwarded wait. */
    const aborted = await run<ISettled>(frame, 'abort')
    expect(aborted.error).toBeDefined()
    await expect
      .poll(async () => (await run<{ worker: { aborts: string[] } }>(frame, 'inspect')).worker.aborts)
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
    for (const page of [first, second])
      await page.evaluate(() => globalThis.topologyTab.ready())
    expect(
      await first.evaluate(() => globalThis.topologyTab.callTab('tab2' as never, 'echo' as never, 11 as never))
    ).toEqual({ value: expect.objectContaining({ value: 11, seq: 1 }) })
    /** Leaf failure from tab2, classified in tab1. */
    const failed = (await first.evaluate(() =>
      globalThis.topologyTab.callTab('tab2' as never, 'fail' as never)
    )) as ISettled
    expect(failed.error!.chain).toContainEqual(
      expect.objectContaining({ source: 'app.topology', code: 'LEAF_FAILED' })
    )
    /** tab2's own counters: one echo and one failure. */
    const leaf = (await second.evaluate(() => globalThis.topologyTab.leaf())) as {
      echoCalls: number
      failCalls: number
    }
    expect([leaf.echoCalls, leaf.failCalls]).toEqual([1, 1])
    /** tab1 executed nothing. */
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
