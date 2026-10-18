import type { IRpcDevtoolsPage, IRpcDevtoolsWatchBatch } from '../contract/service.js'
import type { IRpcDevtoolsWireEvent } from '../contract/wire.js'
import type { IHubTarget } from './targets.js'
import { hubHost } from './clock.js'
import { HubServiceMethod } from './text.js'

/** Frozen service pages accept at most 1,000 retained events per query. */
const QUERY_PAGE_SIZE = 1000

/** Fetch retained pages after activating the live watch; cancellation prevents late insertion. */
export async function catchUpTarget(
  target: IHubTarget,
  accept: (event: IRpcDevtoolsWireEvent) => void
): Promise<void> {
  /** Cursor follows the service's own sequence, including any retention gap. */
  let cursor = 0
  while (target.active) {
    /** Public service pages retain their own wire event references. */
    const page = (await target.client!.request(HubServiceMethod.query, {
      afterSeq: cursor,
      limit: QUERY_PAGE_SIZE
    })) as IRpcDevtoolsPage
    if (!target.active) return
    for (let i = 0; i < page.events.length && target.active; i++) accept(page.events[i]!)
    if (page.events.length < QUERY_PAGE_SIZE || page.nextSeq <= cursor) return
    cursor = page.nextSeq
  }
}

/** Own the iterator immediately, then receive batches without exposing watch failure to callers. */
export async function startTargetWatch(
  target: IHubTarget,
  accept: (event: IRpcDevtoolsWireEvent) => void,
  report: (error: unknown) => void,
  disconnected: () => void,
  catchUp: () => Promise<void>
): Promise<void> {
  target.iterator = target
    .client!.stream(HubServiceMethod.watch)
    [Symbol.asyncIterator]() as AsyncIterator<IRpcDevtoolsWatchBatch>
  /** This iterator remains the one resource released even if its target is removed during next(). */
  const iterator = target.iterator
  /** One initial read activates the existing bounded watch before the historical snapshot starts. */
  const first = (async () => {
    try {
      return { ok: true as const, value: await iterator.next() }
    } catch (error) {
      return { ok: false as const, error }
    }
  })()
  try {
    await catchUp()
  } catch (error) {
    /** A failed snapshot still reports any independent late failure from its already-owned watch. */
    void first.then((outcome) => {
      if (!outcome.ok) report(outcome.error)
    })
    throw error
  }
  /** The asynchronous service consumer is separate from synchronous business observation paths. */
  async function follow(): Promise<void> {
    try {
      /** History is ingested first; the first live batch then deduplicates through the same cursor. */
      const initial = await first
      if (!initial.ok) throw initial.error
      /** Subsequent reads reuse the original iterator rather than creating another pending queue. */
      let next = initial.value
      /** The existing active flag rejects results that settled after target removal. */
      while (target.active) {
        if (next.done) {
          disconnected()
          return
        }
        for (let i = 0; i < next.value.events.length && target.active; i++)
          accept(next.value.events[i]!)
        if (!target.active) return
        next = await iterator.next()
      }
    } catch (error) {
      report(error)
      if (target.active) disconnected()
    }
  }
  void follow()
}

/** Return a watch once; its original release rejection remains owned by the public cleanup caller. */
export function releaseTarget(target: IHubTarget): Promise<void> {
  if (target.release) return target.release
  target.active = false
  if (target.interval !== undefined) {
    hubHost.clearInterval(target.interval)
    target.interval = undefined
  }
  /** Clear ownership before return() so reentrant cleanup cannot release the same watch twice. */
  const iterator = target.iterator
  target.iterator = undefined
  /** Cache completion before invoking user-owned return(), which can synchronously reenter close. */
  const completion = Promise.withResolvers<void>()
  target.release = completion.promise
  if (iterator?.return) {
    try {
      void iterator.return().then(
        () => completion.resolve(),
        (error) => completion.reject(error)
      )
    } catch (error) {
      completion.reject(error)
    }
  } else completion.resolve()
  return target.release
}
