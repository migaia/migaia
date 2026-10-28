/** Abort overlay. Cases preserve the existing behavioral assertions. */
import { subscribeUntil } from '../src/subscriber.js'
import { describe, expect, it, vi } from 'vitest'
import { EventSubscriberErrorCode, createEventChannel } from '../src/index.js'

describe('abort overlay', () => {
  it('rejects callable and array signals before observing members, and codes revoked predicates', () => {
    let reads = 0
    const signal = () => undefined
    Object.defineProperty(signal, 'aborted', {
      get: () => {
        reads += 1
        return false
      }
    })
    const channel = createEventChannel<number>()

    expect(() => subscribeUntil(channel, signal as never, () => undefined)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidSignal })
    )
    expect(reads).toBe(0)

    let arrayReads = 0
    const arraySignal: unknown[] = []
    Object.defineProperty(arraySignal, 'aborted', {
      get: () => {
        arrayReads += 1
        return false
      }
    })
    expect(() => subscribeUntil(channel, arraySignal as never, () => undefined)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidSignal })
    )
    expect(arrayReads).toBe(0)

    const { proxy: revokedSignal, revoke } = Proxy.revocable(
      { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined },
      {}
    )
    revoke()
    let revokedFailure: unknown
    try {
      subscribeUntil(channel, revokedSignal as never, () => undefined)
    } catch (error) {
      revokedFailure = error
    }
    expect(revokedFailure).toBeInstanceOf(TypeError)
    expect(revokedFailure).toMatchObject({ code: EventSubscriberErrorCode.invalidSignal })
  })

  it('keeps pre-aborted admission silent by default and rejects it only for strict channels', () => {
    const signal = {
      aborted: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
    const silentChannel = createEventChannel<number>()
    expect(subscribeUntil(silentChannel, signal, () => undefined)).toBeTypeOf('function')

    const strictChannel = createEventChannel<number>({ throwOnAborted: true })
    expect(() => subscribeUntil(strictChannel, signal, () => undefined)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.aborted })
    )
  })

  it('rejects non-boolean strict abort configuration with INVALID_OPTIONS', () => {
    expect(() => createEventChannel<number>({ throwOnAborted: null as never })).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions })
    )
  })

  it('completes second-site cleanup before strict abort is thrown', () => {
    let reads = 0
    const remove = vi.fn()
    const signal = {
      get aborted() {
        reads += 1
        return reads > 1
      },
      addEventListener: () => undefined,
      removeEventListener: remove
    }
    const channel = createEventChannel<number>({ throwOnAborted: true })

    expect(() => subscribeUntil(channel, signal, () => undefined)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.aborted })
    )
    expect(remove).toHaveBeenCalledOnce()
    expect(channel.size).toBe(0)
  })

  it('marks canonical event context aborted and releases once on signal abort', () => {
    let abortListener!: () => void
    const remove = vi.fn()
    const signal = {
      aborted: false,
      reason: 'cancelled',
      addEventListener: vi.fn((_type: 'abort', listener: () => void) => {
        abortListener = listener
      }),
      removeEventListener: remove
    }
    const channel = createEventChannel<number>()
    const release = subscribeUntil(channel, signal, (event) => {
      expect(event.aborted).toBe(false)
      abortListener()
      expect(event.aborted).toBe(true)
      expect(event.abortReason).toBe('cancelled')
    })

    channel.publish(1)
    expect(channel.size).toBe(0)
    release()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('releases a structural registration when abort fires during listener installation', () => {
    let abortListener!: () => void
    const release = vi.fn()
    const signal = {
      aborted: false,
      reason: 'during-install',
      addEventListener(_type: 'abort', listener: () => void) {
        abortListener = listener
        listener()
      },
      removeEventListener: vi.fn()
    }
    const channel = {
      subscribe() {
        return release
      }
    }

    subscribeUntil(channel as never, signal, () => undefined)
    abortListener()

    expect(release).toHaveBeenCalledOnce()
  })

  it('copies reason once and exposes it to a running structural subscription', () => {
    let abortListener!: () => void
    let reasonReads = 0
    const reason = new Error('cancel')
    const signal = {
      get aborted() {
        return false
      },
      get reason() {
        reasonReads += 1
        return reason
      },
      addEventListener(_type: 'abort', listener: () => void) {
        abortListener = listener
      },
      removeEventListener() {
        abortListener = () => undefined
      }
    }
    let subscribed!: (event: {
      value: number
      aborted: boolean
      abortReason: unknown
      abort(): void
      taskId: string | undefined
      setTaskId(taskId: string | undefined): void
    }) => void
    const listener = vi.fn((event: { aborted: boolean; abortReason: unknown }) => {
      abortListener()
      expect(event.aborted).toBe(true)
      expect(event.abortReason).toBe(reason)
    })
    const channel = {
      subscribe(
        callback: (event: {
          value: number
          aborted: boolean
          abortReason: unknown
          abort(): void
          taskId: string | undefined
          setTaskId(taskId: string | undefined): void
        }) => void
      ) {
        subscribed = callback
        return () => undefined
      }
    }
    subscribeUntil(channel as never, signal, listener as never)
    subscribed({
      value: 1,
      aborted: false,
      abortReason: undefined,
      abort: () => undefined,
      taskId: undefined,
      setTaskId: () => undefined
    })
    expect(reasonReads).toBe(1)
  })
})
