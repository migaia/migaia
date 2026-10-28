/** Event-subscriber abort hardening. Cases preserve the existing behavioral assertions. */
import { subscribeUntil } from '../src/subscriber.js'
import { describe, expect, it, vi } from 'vitest'
import { EventSubscriberErrorCode, createEventChannel } from '../src/index.js'

describe('event-subscriber abort hardening', () => {
  it('removes a signal-linked registration on manual unsubscribe', () => {
    const remove = vi.fn()
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: remove
    }
    const channel = createEventChannel<number>()
    const stop = subscribeUntil(channel, signal, () => undefined)
    stop()
    expect(remove).toHaveBeenCalledOnce()

    const listeners = new Set<() => void>()
    let aborted = false
    const racedSignal = {
      get aborted() {
        return aborted
      },
      reason: 'race',
      addEventListener: (_type: string, callback: () => void) => {
        aborted = true
        callback()
        listeners.add(callback)
      },
      removeEventListener: (_type: string, callback: () => void) => {
        listeners.delete(callback)
      }
    }
    expect(() => subscribeUntil(channel, racedSignal, () => undefined)).not.toThrow()
    expect(listeners.size).toBe(0)
  })

  it('does not register against an already-aborted signal', () => {
    const subscribe = vi.fn(() => () => undefined)
    const signal = {
      aborted: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    subscribeUntil({ subscribe } as never, signal, () => undefined)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('rechecks aborted after listener installation and releases the registration', () => {
    const release = vi.fn()
    let reads = 0
    const signal = {
      get aborted() {
        reads += 1
        return reads > 1
      },
      reason: 'late-abort',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    subscribeUntil({ subscribe: () => release } as never, signal, () => undefined)
    expect(reads).toBe(2)
    expect(release).toHaveBeenCalledOnce()
  })

  it('preserves second-check reason as primary over remove and release failures', () => {
    let abortedReads = 0
    const reasonFailure = new Error('second-check reason')
    const removeFailure = new Error('second-check remove')
    const releaseFailure = new Error('second-check release')
    const remove = vi.fn(() => {
      throw removeFailure
    })
    const release = vi.fn(() => {
      throw releaseFailure
    })
    const signal = {
      get aborted() {
        abortedReads += 1
        return abortedReads > 1
      },
      get reason() {
        throw reasonFailure
      },
      addEventListener: vi.fn(),
      removeEventListener: remove
    }

    expect(() =>
      subscribeUntil({ subscribe: () => release } as never, signal, () => undefined)
    ).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidSignal,
        cause: reasonFailure,
        errors: [reasonFailure, removeFailure, releaseFailure]
      })
    )
    expect(abortedReads).toBe(2)
    expect(remove).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('invokes signal methods directly with the original receiver', () => {
    const signal = {
      marker: 11,
      aborted: false,
      addEventListener(this: { marker: number }) {
        expect(this.marker).toBe(11)
      },
      removeEventListener(this: { marker: number }) {
        expect(this.marker).toBe(11)
      }
    }
    const stop = subscribeUntil(
      { subscribe: () => () => undefined } as never,
      signal,
      () => undefined
    )
    stop()
  })

  it('reports remove failure after releasing a manually unsubscribed registration', () => {
    const release = vi.fn()
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(() => {
        throw new Error('remove failed')
      })
    }
    const stop = subscribeUntil({ subscribe: () => release } as never, signal, () => undefined)
    expect(stop).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidSignal })
    )
    expect(release).toHaveBeenCalledOnce()
  })

  it('cleans up when addEventListener stores then throws', () => {
    const addFailure = new Error('add failed')
    const remove = vi.fn()
    let storedCallback!: () => void
    const signal = {
      aborted: false,
      addEventListener: vi.fn((_type: string, callback: () => void) => {
        storedCallback = callback
        throw addFailure
      }),
      removeEventListener: remove
    }
    expect(() =>
      subscribeUntil({ subscribe: () => vi.fn() } as never, signal, () => undefined)
    ).toThrow(addFailure)
    expect(storedCallback).toBeTypeOf('function')
    expect(remove).toHaveBeenCalledOnce()
  })

  it('marks abort before a hostile reason getter and preserves cleanup errors after it', () => {
    let abortListener!: () => void
    let observedEvent!: { readonly aborted: boolean }
    const reasonFailure = new Error('reason getter')
    const removeFailure = new Error('remove failed')
    const releaseFailure = new Error('release failed')
    const remove = vi.fn(() => {
      throw removeFailure
    })
    const release = vi.fn(() => {
      throw releaseFailure
    })
    const stop = subscribeUntil(
      {
        subscribe(callback: (event: { value: number }) => void) {
          expect(callback).toBeTypeOf('function')
          return release
        }
      } as never,
      {
        aborted: false,
        get reason() {
          throw reasonFailure
        },
        addEventListener: vi.fn((_type: string, callback: () => void) => {
          abortListener = callback
        }),
        removeEventListener: remove
      },
      (event) => {
        observedEvent = event
      }
    )
    expect(() => abortListener()).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidSignal,
        cause: reasonFailure,
        errors: [reasonFailure, removeFailure, releaseFailure]
      })
    )
    expect(observedEvent).toBeUndefined()
    expect(() => stop()).not.toThrow()
  })

  it('makes cleanup idempotent and preserves both cleanup failures', () => {
    const removeFailure = new Error('remove failed')
    const releaseFailure = new Error('release failed')
    const remove = vi.fn(() => {
      throw removeFailure
    })
    const release = vi.fn(() => {
      throw releaseFailure
    })
    const stop = subscribeUntil(
      { subscribe: () => release } as never,
      { aborted: false, addEventListener: vi.fn(), removeEventListener: remove },
      () => undefined
    )
    expect(stop).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidSignal,
        cause: removeFailure,
        errors: [removeFailure, releaseFailure]
      })
    )
    expect(() => stop()).not.toThrow()
    expect(remove).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('validates signal methods before accepting an already-aborted signal', () => {
    expect(() =>
      subscribeUntil(
        { subscribe: () => () => undefined } as never,
        { aborted: true, addEventListener: null, removeEventListener: null } as never,
        () => undefined
      )
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidSignal }))
  })

  it('ignores a stale abort callback after manual stop without reading reason', () => {
    let abortCallback!: () => void
    let reasonReads = 0
    const signal = {
      aborted: false,
      get reason() {
        reasonReads += 1
        return 'stale'
      },
      addEventListener: vi.fn((_type: string, callback: () => void) => {
        abortCallback = callback
      }),
      removeEventListener: vi.fn()
    }
    const stop = subscribeUntil(
      { subscribe: () => () => undefined } as never,
      signal,
      () => undefined
    )
    stop()
    abortCallback()
    expect(reasonReads).toBe(0)
  })

  it('removes a listener retained after synchronous abort during installation', () => {
    const retained = new Set<() => void>()
    const remove = vi.fn((_: string, callback: () => void) => {
      retained.delete(callback)
    })
    let sourceCallback!: (event: { value: number }) => void
    const listener = vi.fn()
    const stop = subscribeUntil(
      {
        subscribe(callback: (event: { value: number }) => void) {
          sourceCallback = callback
          return () => undefined
        }
      } as never,
      {
        aborted: false,
        addEventListener(_type: string, callback: () => void) {
          callback()
          retained.add(callback)
        },
        removeEventListener: remove
      },
      listener
    )

    expect(remove).toHaveBeenCalledOnce()
    expect(retained.size).toBe(0)
    sourceCallback({ value: 1 })
    expect(listener).not.toHaveBeenCalled()
    stop()
    expect(remove).toHaveBeenCalledOnce()
  })

  // Behaviour-equivalence promise, and the case that was missing when it broke. A hostile `aborted`
  // getter throws the caller's own value; coding it in place is what keeps `thrown === original` and
  // its native type, and a wrapper carrying it on `cause` keeps neither. The shared validator
  // captures that throw instead of letting it escape, so only the call site can preserve the
  // identity — and both admission reads can lose it independently, so both are asserted here.
  it('preserves the thrown identity of a hostile aborted getter at both admission reads', () => {
    class HostileAbortedError extends RangeError {}

    const entryFailure = new HostileAbortedError('aborted getter failed at entry')
    let thrownAtEntry: unknown
    try {
      subscribeUntil(
        createEventChannel<number>(),
        {
          get aborted(): boolean {
            throw entryFailure
          },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn()
        } as never,
        () => undefined
      )
    } catch (error) {
      thrownAtEntry = error
    }
    expect(thrownAtEntry).toBe(entryFailure)
    expect(thrownAtEntry).toBeInstanceOf(HostileAbortedError)
    expect(thrownAtEntry).toHaveProperty('code', EventSubscriberErrorCode.invalidSignal)

    const installFailure = new HostileAbortedError('aborted getter failed during install')
    let reads = 0
    let thrownDuringInstall: unknown
    try {
      subscribeUntil(
        createEventChannel<number>(),
        {
          get aborted(): boolean {
            reads += 1
            if (reads > 1) throw installFailure
            return false
          },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn()
        } as never,
        () => undefined
      )
    } catch (error) {
      thrownDuringInstall = error
    }
    expect(reads).toBeGreaterThan(1)
    expect(thrownDuringInstall).toBe(installFailure)
    expect(thrownDuringInstall).toBeInstanceOf(HostileAbortedError)
    expect(thrownDuringInstall).toHaveProperty('code', EventSubscriberErrorCode.invalidSignal)

    // A shape this package rejected itself has no original to preserve; it stays a fresh TypeError.
    let thrownForBadShape: unknown
    try {
      subscribeUntil(
        createEventChannel<number>(),
        { aborted: 'yes', addEventListener: vi.fn(), removeEventListener: vi.fn() } as never,
        () => undefined
      )
    } catch (error) {
      thrownForBadShape = error
    }
    expect(thrownForBadShape).toBeInstanceOf(TypeError)
    expect(thrownForBadShape).not.toBeInstanceOf(HostileAbortedError)
    expect(thrownForBadShape).toHaveProperty('code', EventSubscriberErrorCode.invalidSignal)
  })
})
