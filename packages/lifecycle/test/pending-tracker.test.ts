import { describe, expect, it } from 'vitest'
import { createPendingTracker } from '../src/quiescence-tracker'

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('L-T10 PendingTracker: drain() during new pending production', () => {
  it('drain() resolves immediately when nothing is tracked', async () => {
    const tracker = createPendingTracker()
    await tracker.drain()
    expect(tracker.size).toBe(0)
  })

  it('drain() waits for a single tracked promise to settle', async () => {
    const tracker = createPendingTracker()
    const { promise, resolve } = deferred<void>()
    tracker.track(promise)
    let drained = false
    void tracker.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    resolve()
    await promise
    await Promise.resolve()
    await Promise.resolve()
    expect(drained).toBe(true)
  })

  it('a new pending item started during drain() is not missed (L-T10 core case)', async () => {
    const tracker = createPendingTracker()
    const first = deferred<void>()
    tracker.track(first.promise)

    const drainPromise = tracker.drain()
    let drained = false
    void drainPromise.then(() => {
      drained = true
    })

    // Before the first settles, start a second one — a new "pending epoch".
    const second = deferred<void>()
    await Promise.resolve()
    tracker.track(second.promise)

    first.resolve()
    await first.promise
    await Promise.resolve()
    await Promise.resolve()
    // drain() must still be waiting — the second item is still pending.
    expect(drained).toBe(false)
    expect(tracker.size).toBeGreaterThan(0)

    second.resolve()
    await second.promise
    await drainPromise
    expect(drained).toBe(true)
    expect(tracker.size).toBe(0)
  })

  it('tracked rejections are still delivered to the caller of track() (not swallowed)', async () => {
    const tracker = createPendingTracker()
    const failing = Promise.reject(new Error('tracked failure'))
    const tracked = tracker.track(failing)
    await expect(tracked).rejects.toThrow('tracked failure')
  })

  it('a rejecting tracked promise still releases its slot so drain() completes', async () => {
    const tracker = createPendingTracker()
    const failing = Promise.reject(new Error('tracked failure'))
    const tracked = tracker.track(failing)
    void tracked.catch(() => undefined)
    await tracker.drain()
    expect(tracker.size).toBe(0)
  })

  it('track() returns the identical promise passed in', () => {
    const tracker = createPendingTracker()
    const promise = Promise.resolve(42)
    expect(tracker.track(promise)).toBe(promise)
  })

  it('size reflects the number of currently in-flight tracked operations', async () => {
    const tracker = createPendingTracker()
    const a = deferred<void>()
    const b = deferred<void>()
    tracker.track(a.promise)
    tracker.track(b.promise)
    expect(tracker.size).toBe(2)
    a.resolve()
    await a.promise
    await Promise.resolve()
    expect(tracker.size).toBe(1)
    b.resolve()
    await b.promise
    await Promise.resolve()
    expect(tracker.size).toBe(0)
  })
})
