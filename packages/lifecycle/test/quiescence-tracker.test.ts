import { describe, expect, it } from 'vitest'
import { createQuiescenceTracker, createStringLeaseRegistry } from '../src/quiescence-tracker.ts'
import { LifecycleErrorCode } from '../src/error-code.ts'

describe('QuiescenceTracker: unsealed whenZero()', () => {
  it('throws synchronously, not a rejected Promise, when the key is not sealed', () => {
    const tracker = createStringLeaseRegistry()
    expect(() => tracker.whenZero('k')).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.quiescenceUnsealedWait })
    )
  })

  it('does not return a promise object at all on the throwing path (no pseudo strict waiter)', () => {
    const tracker = createStringLeaseRegistry()
    let thrown = false
    try {
      tracker.whenZero('k')
    } catch {
      thrown = true
    }
    expect(thrown).toBe(true)
  })

  it('still throws even if the key has an active retain', () => {
    const tracker = createStringLeaseRegistry()
    tracker.retain('k')
    expect(() => tracker.whenZero('k')).toThrow()
  })
})

describe('QuiescenceTracker: strict whenZero() vs non-exclusive whenZeroOnce()', () => {
  it('does not retain an idle string key after a loose wait', async () => {
    /** Retention is observable through forget(), without relying on heap timing. */
    const tracker = createStringLeaseRegistry()
    await tracker.whenZeroOnce('never-retained')
    expect(tracker.forget('never-retained')).toBe(false)
    /** A completed unsealed string epoch also releases its strong Map entry. */
    const release = tracker.retain('completed')
    release()
    expect(tracker.forget('completed')).toBe(false)
  })

  it('strict whenZero() resolves once the sealed key reaches zero, and rejects further retain()', async () => {
    const tracker = createStringLeaseRegistry()
    const release = tracker.retain('k')
    tracker.seal('k')
    expect(() => tracker.retain('k')).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.quiescenceSealed })
    )
    const wait = tracker.whenZero('k')
    let resolved = false
    void wait.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    release()
    await wait
    expect(resolved).toBe(true)
  })

  it('whenZero() resolves immediately if the sealed key is already at zero', async () => {
    const tracker = createStringLeaseRegistry()
    tracker.seal('k')
    await expect(tracker.whenZero('k')).resolves.toBeUndefined()
  })

  it('whenZeroOnce() allows retain() to keep happening — it is not exclusive', async () => {
    const tracker = createStringLeaseRegistry()
    const releaseA = tracker.retain('k')
    const wait = tracker.whenZeroOnce('k')
    // Retaining again while a whenZeroOnce() is pending must not throw (unlike sealed strict mode).
    const releaseB = tracker.retain('k')
    releaseA()
    releaseB()
    await wait
  })

  it('whenZeroOnce() resolves the next time count hits zero — a new epoch after resolution is not hidden from a caller who checks count() again', async () => {
    const tracker = createStringLeaseRegistry()
    const releaseA = tracker.retain('k')
    const wait = tracker.whenZeroOnce('k')
    releaseA()
    await wait
    expect(tracker.count('k')).toBe(0)
    // A retain that happens strictly after the wait already resolved is a fresh epoch, observable
    // via a fresh whenZeroOnce() call — it was not silently folded into the earlier resolution.
    const releaseC = tracker.retain('k')
    expect(tracker.count('k')).toBe(1)
    let secondResolved = false
    void tracker.whenZeroOnce('k').then(() => {
      secondResolved = true
    })
    await Promise.resolve()
    expect(secondResolved).toBe(false)
    releaseC()
    await Promise.resolve()
    expect(secondResolved).toBe(true)
  })

  it('a whenZeroOnce() caller must re-check count() to avoid a false "safe to release" conclusion', async () => {
    const tracker = createStringLeaseRegistry()
    const releaseA = tracker.retain('k')
    const waitPromise = tracker.whenZeroOnce('k')
    // Before the first release fires, retain again — count goes 1 -> 2 -> (releaseA) 1, never zero
    // during this sequence yet.
    const releaseB = tracker.retain('k')
    releaseA()
    // count is still 1 here (releaseB not yet called), so whenZeroOnce() must NOT have resolved.
    let resolved = false
    void waitPromise.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(tracker.count('k')).toBe(1)
    releaseB()
    await waitPromise
  })

  it('retain() returns an idempotent release', () => {
    const tracker = createStringLeaseRegistry()
    const release = tracker.retain('k')
    expect(tracker.count('k')).toBe(1)
    release()
    expect(tracker.count('k')).toBe(0)
    release() // second call is a no-op
    expect(tracker.count('k')).toBe(0)
  })
})

describe('QuiescenceTracker: object-keyed variant', () => {
  it('supports object keys via the WeakMap-backed factory', async () => {
    const tracker = createQuiescenceTracker<object>()
    const key = {}
    const release = tracker.retain(key)
    expect(tracker.count(key)).toBe(1)
    release()
    expect(tracker.count(key)).toBe(0)
    expect(tracker.forget(key)).toBe(true)
    expect(tracker.forget(key)).toBe(false)
  })

  it('keeps detached methods and both zero wait modes on the same original object state', async () => {
    /** Class-backed ownership must preserve the previously receiver-independent public methods. */
    const tracker = createQuiescenceTracker<object>()
    const { retain, count, whenZero, whenZeroOnce, seal, isSealed, forget } = tracker
    /** Strict and loose waits share one real retained operation and resolve only at its zero. */
    const key = {}
    const release = retain(key)
    const loose = whenZeroOnce(key)
    seal(key)
    const strict = whenZero(key)
    expect(isSealed(key)).toBe(true)
    expect(forget(key)).toBe(false)
    release()
    await Promise.all([loose, strict])
    expect(count(key)).toBe(0)
    expect(forget(key)).toBe(true)
  })

  it('does not confuse two distinct object keys', () => {
    const tracker = createQuiescenceTracker<object>()
    const keyA = {}
    const keyB = {}
    tracker.retain(keyA)
    expect(tracker.count(keyA)).toBe(1)
    expect(tracker.count(keyB)).toBe(0)
  })
})

describe('seal()', () => {
  it('is idempotent', () => {
    const tracker = createStringLeaseRegistry()
    tracker.seal('k')
    tracker.seal('k')
    expect(tracker.isSealed('k')).toBe(true)
  })

  it('can seal a key that was never retained, immediately unblocking whenZero()', async () => {
    const tracker = createStringLeaseRegistry()
    tracker.seal('never-used')
    await expect(tracker.whenZero('never-used')).resolves.toBeUndefined()
  })

  it('forgets settled sealed string keys without reopening them', () => {
    const tracker = createStringLeaseRegistry()
    tracker.seal('completed')
    expect(tracker.forget('completed')).toBe(true)
    expect(tracker.isSealed('completed')).toBe(false)
    expect(() => tracker.retain('completed')).not.toThrow()
  })

  it('does not forget an active key', () => {
    const tracker = createStringLeaseRegistry()
    const release = tracker.retain('active')
    tracker.seal('active')
    expect(tracker.forget('active')).toBe(false)
    release()
    expect(tracker.forget('active')).toBe(true)
  })
})
