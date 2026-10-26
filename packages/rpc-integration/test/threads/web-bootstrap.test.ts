import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { deferred } from '@migaia/utils/promise'
import { createUnitBudget } from '@migaia/supervision'
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import {
  createWebThreadLauncher,
  createWebThreadChannelFactory
} from '../../../rpc-plugin-thread/dist/threads/web-launcher.js'

/** The original native Worker surface controls actual startup and failure delivery. */
function webFixture() {
  /** Native events reach the original launcher and Session readers, without a protocol stub. */
  const events = new EventTarget()
  /** The constructor proves launch has entered before cancellation or native failure. */
  const launched = deferred<void>()
  /** Reader registration remains observable before the remote Session is ready. */
  const subscriptions: string[] = []
  /** Termination does not fabricate the unsupported actual-exit receipt. */
  const terminate = vi.fn()
  /** The native reporter retains the original failure through its coded wrapper. */
  const report = vi.fn()
  /** Host and supervision notices have their own scope, separate from the native Worker reporter. */
  const background = vi.fn()
  /** This controllable constructor exercises the unchanged real launcher. */
  const Worker = class {
    constructor() {
      launched.resolve()
    }
    postMessage = vi.fn()
    addEventListener(type: string, listener: EventListener) {
      subscriptions.push(type)
      events.addEventListener(type, listener)
    }
    removeEventListener(type: string, listener: EventListener) {
      events.removeEventListener(type, listener)
    }
    terminate = terminate
  }
  return { events, launched, subscriptions, terminate, report, background, Worker }
}

/** Advance only the existing supervisor's short unsupported-exit stop and reap budgets. */
async function settleNativeStop(
  scheduler: ReturnType<typeof createManualScheduler>
): Promise<void> {
  for (const advance of [0, 5, 5]) {
    for (let turn = 0; turn < 80; turn++) await Promise.resolve()
    scheduler.advance(advance)
  }
  for (let turn = 0; turn < 80; turn++) await Promise.resolve()
}

/** Public startup uses the original native launcher, channel, and supervisor owner. */
function openWebThread(
  fixture: ReturnType<typeof webFixture>,
  scheduler: ReturnType<typeof createManualScheduler>,
  signal: AbortSignal
) {
  return createRpcHost({
    signal,
    report: fixture.background,
    plugins: [
      threadPlugin({
        spawn: {
          spec: { entry: 'file:///worker.mjs' },
          launcher: createWebThreadLauncher(fixture),
          budget: createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler }),
          scheduler,
          report: fixture.background,
          channelFactory: createWebThreadChannelFactory({ scheduler, report: fixture.background }),
          supervisor: { isolation: 'best-effort', stop: { exitTimeoutMs: 5, reapTimeoutMs: 5 } }
        },
        report: fixture.background
      })
    ]
  })
}

/** Native failure identity remains reachable without the removed prepared facade. */
function hasCause(value: unknown, original: unknown): boolean {
  for (let depth = 0; depth < 16 && value instanceof Error; depth++) {
    if (value === original) return true
    value = value.cause
  }
  return false
}

describe('Web thread public startup', () => {
  it('keeps public construction pending until the remote Session is ready', async () => {
    /** This startup receives no reply from a remote RPC Session. */
    const fixture = webFixture()
    /** The original supervisor uses one deterministic timing owner. */
    const scheduler = createManualScheduler()
    /** The caller owns the exact native cancellation reason. */
    const controller = new AbortController()
    /** Only completion of the actual public constructor can publish this Host. */
    const published = { value: false }
    /** Observe rejection before the controlled native candidate can fail. */
    const opening = openWebThread(fixture, scheduler, controller.signal).then(
      (host) => {
        published.value = true
        return host
      },
      (error: unknown) => error
    )
    await Promise.race([fixture.launched.promise, opening.then((result) => Promise.reject(result))])
    for (let turn = 0; turn < 80; turn++) await Promise.resolve()
    expect(published.value).toBe(false)
    expect(fixture.subscriptions.filter((type) => type === 'message')).toHaveLength(1)
    /** Cancellation reclaims this candidate without manufacturing the old private ack. */
    const reason = new Error('cancel waiting native Session')
    controller.abort(reason)
    await settleNativeStop(scheduler)
    expect(hasCause(await opening, reason)).toBe(true)
    expect(fixture.terminate).toHaveBeenCalledTimes(1)
  })

  it('rejects public preparation with the original Worker error before Session readiness', async () => {
    /** Native failure remains independent of the caller's still-live signal. */
    const original = new Error('worker bootstrap original failure')
    /** The native callback receives this original EventTarget event. */
    const fixture = webFixture()
    /** The supervisor owns unsupported-exit timeout accounting. */
    const scheduler = createManualScheduler()
    /** Native errors cannot become a caller cancellation reason. */
    const controller = new AbortController()
    /** Observe public rejection before dispatching the native error. */
    const opening = openWebThread(fixture, scheduler, controller.signal).catch(
      (error: unknown) => error
    )
    await Promise.race([fixture.launched.promise, opening.then((result) => Promise.reject(result))])
    for (let turn = 0; turn < 80; turn++) await Promise.resolve()
    /** The Worker supplies its original Error, without a synthetic cancellation. */
    const event = Object.assign(new Event('error', { cancelable: true }), { error: original })
    fixture.events.dispatchEvent(event)
    await settleNativeStop(scheduler)
    expect(hasCause(await opening, original)).toBe(true)
    expect(fixture.report).toHaveBeenCalledTimes(1)
    expect(hasCause(fixture.report.mock.calls[0]![0], original)).toBe(true)
    expect(fixture.terminate).toHaveBeenCalledTimes(1)
    expect(controller.signal.aborted).toBe(false)
    expect(event.defaultPrevented).toBe(true)
  })
})
