import { describe, expect, it, vi } from 'vitest'
import { createBrowserThreadLauncher } from '../../src/threads/adapters/browser.js'

/** A real launcher owns acknowledgement and failure handling on this controllable Worker port. */
function webFixture() {
  /** The native-style event surface lets the test control delivery before acknowledgement. */
  const events = new EventTarget()
  /** Listener registration proves transport is absent while bootstrap remains pending. */
  const subscriptions: string[] = []
  /** Termination is observed separately from unsupported actual-exit evidence. */
  const terminate = vi.fn()
  /** Original worker failures must remain visible to the caller and local reporter. */
  const report = vi.fn()
  /** Runtime messaging remains idle until the fixture deliberately acknowledges bootstrap. */
  const Worker = class {
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
  return { events, subscriptions, terminate, report, Worker }
}

describe('Web thread bootstrap failure', () => {
  it('[A6/A9] rejects preparation with the original Worker error before acknowledgement', async () => {
    /** This failure is independent from the launch signal, which remains live. */
    const original = new Error('worker bootstrap original failure')
    /** The candidate receives a real EventTarget error before its private ack. */
    const fixture = webFixture()
    /** A live launch signal must not become the rejection value for a Worker failure. */
    const controller = new AbortController()
    /** Preparation belongs to the production Web launcher, not a test-created Promise. */
    const handle = await createBrowserThreadLauncher(fixture).launch(
      { entry: 'file:///worker.mjs' },
      { signal: controller.signal }
    )
    /** Attach the assertion before firing the Worker event. */
    const result = handle.prepared.catch((error: unknown) => error)
    /** Native Worker error exposes the original Error through its error property. */
    const event = Object.assign(new Event('error', { cancelable: true }), { error: original })
    fixture.events.dispatchEvent(event)
    /** The wrapper supplies a registered code while preserving exact cause identity. */
    const failure = await result
    expect(failure).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })
    expect((failure as Error).cause).toBe(original)
    expect(fixture.report).toHaveBeenCalledExactlyOnceWith(original)
    expect(fixture.terminate).toHaveBeenCalledTimes(1)
    expect(controller.signal.aborted).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    handle.terminate()
    expect(fixture.terminate).toHaveBeenCalledTimes(1)
  })
})
