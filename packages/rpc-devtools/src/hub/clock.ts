import type { IRpcDevtoolsDescribe } from '../contract/service.js'
import type { IHubTarget, IHubTimelineEvent } from './targets.js'
import { HubServiceMethod } from './text.js'

/** Supported Node, browser and Worker hosts supply the same clock, timer and reporting operations. */
type IHubHost = {
  performance: { now(): number }
  setInterval(callback: () => void, milliseconds: number): unknown
  clearInterval(handle: unknown): void
  console: { error(error: unknown): void }
}

/** A structural host view avoids importing DOM or Node types into this runtime-neutral package. */
export const hubHost = globalThis as typeof globalThis & IHubHost

/** Five samples are the frozen R2 clock contract; only the smallest round trip is retained. */
const ALIGNMENT_SAMPLES = 5

/** Align one active target and update its existing retained wrappers without copying wire events. */
export async function alignTarget(target: IHubTarget): Promise<void> {
  /** A cancelled registration or offline recording has no remote clock to sample. */
  const client = target.client
  if (!client || !target.active) return
  /**
   * A new estimate commits only after all samples succeed, preserving the previous estimate on
   * error.
   */
  let minimumRtt = Infinity
  /** Offset converts remote monotonic timestamps to this hub's monotonic clock. */
  let offset = target.offset
  for (let i = 0; i < ALIGNMENT_SAMPLES; i++) {
    /** The midpoint of this round trip estimates the local time of the remote sample. */
    const start = hubHost.performance.now()
    /** The service owns describe and its timestamp; the hub never creates a Peer. */
    const description = (await client.request(HubServiceMethod.describe)) as IRpcDevtoolsDescribe
    if (!target.active) return
    /** Read after the await so the sample includes the entire request round trip. */
    const end = hubHost.performance.now()
    /** Symmetric-path uncertainty is half the observed round trip. */
    const rtt = end - start
    if (rtt < minimumRtt) {
      minimumRtt = rtt
      offset = description.now - (start + end) / 2
    }
  }
  target.offset = offset
  target.uncertaintyMs = minimumRtt / 2
  for (let i = 0; i < target.count; i++) {
    /** R2 realignment mutates the once-created wrapper; all query results retain that same identity. */
    const item = target.events[(target.head + i) % target.events.length] as IHubTimelineEvent
    item.alignedAt = item.event.at - offset
    item.uncertaintyMs = target.uncertaintyMs
  }
}
