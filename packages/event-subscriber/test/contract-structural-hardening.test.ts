/** Event-subscriber structural helper hardening. Cases preserve the existing behavioral assertions. */
import { subscribeOnce, subscribeSubscriber, subscribeUntil } from '../src/subscriber.js'
import { describe, expect, it, vi } from 'vitest'
import { EventSubscriberErrorCode, createEventChannel } from '../src/index.js'

describe('event-subscriber structural helper hardening', () => {
  it('makes structural subscribeOnce atomic when subscribe invokes synchronously', () => {
    let callback!: (event: { value: number }) => void
    let active = true
    const channel = {
      subscribe(listener: (event: { value: number }) => void) {
        callback = listener
        return () => {
          active = false
        }
      }
    }
    const emit = (value: number): void => {
      if (active) callback({ value })
    }
    const listener = vi.fn()
    subscribeOnce(channel as never, listener as never)

    emit(1)
    emit(2)
    expect(listener).toHaveBeenCalledOnce()
    expect(active).toBe(false)
  })

  it('rejects structurally illegal synchronous once callbacks and rolls back', () => {
    const release = vi.fn()
    const listener = vi.fn()
    const channel = {
      subscribe(callback: (event: { value: number }) => void) {
        callback({ value: 1 })
        callback({ value: 2 })
        return release
      }
    }

    expect(() => subscribeOnce(channel as never, listener as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel })
    )
    expect(release).toHaveBeenCalledOnce()
    expect(listener).not.toHaveBeenCalled()
  })

  it('suppresses structural once callbacks when disposer validation fails', () => {
    const listener = vi.fn()
    expect(() =>
      subscribeOnce(
        {
          subscribe(callback: (event: { value: number }) => void) {
            callback({ value: 1 })
            callback({ value: 2 })
            return null
          }
        } as never,
        listener as never
      )
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel }))
    expect(listener).not.toHaveBeenCalled()
  })

  it('suppresses structural until callbacks when disposer validation fails', () => {
    const listener = vi.fn()
    expect(() =>
      subscribeUntil(
        {
          subscribe(callback: (event: { value: number }) => void) {
            callback({ value: 1 })
            return 0
          }
        } as never,
        { aborted: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
        listener as never
      )
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel }))
    expect(listener).not.toHaveBeenCalled()
  })

  it('installs abort observation before structural source subscription and rolls back sync delivery', () => {
    let observed = false
    const add = vi.fn(() => {
      observed = true
    })
    const listener = vi.fn()
    const release = vi.fn()
    expect(() =>
      subscribeUntil(
        {
          subscribe(callback: (event: { value: number }) => void) {
            expect(observed).toBe(true)
            callback({ value: 1 })
            return release
          }
        } as never,
        { aborted: false, addEventListener: add, removeEventListener: vi.fn() },
        listener as never
      )
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel }))
    expect(listener).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it('rejects source events when abort races source installation and rolls back', () => {
    let abortListener!: () => void
    const release = vi.fn()
    const listener = vi.fn()
    subscribeUntil(
      {
        subscribe(callback: (event: { value: number }) => void) {
          abortListener()
          callback({ value: 1 })
          return release
        }
      } as never,
      {
        aborted: false,
        reason: 'during-source',
        addEventListener: vi.fn((_type: string, callback: () => void) => {
          abortListener = callback
        }),
        removeEventListener: vi.fn()
      },
      listener as never
    )
    expect(listener).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it('makes once cleanup helper-owned and idempotent', () => {
    const release = vi.fn()
    const stop = subscribeOnce({ subscribe: () => release } as never, () => undefined)
    stop()
    stop()
    expect(release).toHaveBeenCalledOnce()
  })

  it('validates helper options even when a structural source ignores them', () => {
    const source = { subscribe: () => () => undefined }
    expect(() =>
      subscribeOnce(source as never, () => undefined, { taskId: 1 } as never)
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidTaskId }))
    expect(() =>
      subscribeUntil(
        source as never,
        { aborted: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
        () => undefined,
        { taskId: 1 } as never
      )
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidTaskId }))
  })

  it('rejects a hostile synchronous source storm during helper installation', () => {
    const listener = vi.fn()
    const release = vi.fn()
    expect(() =>
      subscribeUntil(
        {
          subscribe(callback: (event: { value: number }) => void) {
            for (let index = 0; index < 10_000; index += 1) callback({ value: index })
            return release
          }
        } as never,
        { aborted: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
        listener as never
      )
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel }))
    expect(listener).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it('preserves a business listener failure after structural installation', () => {
    let emit!: (event: { value: number }) => void
    const failure = new Error('business failure')
    subscribeUntil(
      {
        subscribe(callback: (event: { value: number }) => void) {
          emit = callback
          return () => undefined
        }
      } as never,
      { aborted: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      () => {
        throw failure
      }
    )
    expect(() => emit({ value: 1 })).toThrow(failure)
    expect(failure).not.toMatchObject({ code: EventSubscriberErrorCode.invalidSignal })
  })

  it('codes revoked structural channel and signal boundaries', () => {
    const channel = Proxy.revocable({ subscribe: () => () => undefined }, {})
    channel.revoke()
    expect(() => subscribeOnce(channel.proxy as never, () => undefined)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel })
    )

    const signal = Proxy.revocable(
      { aborted: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      {}
    )
    signal.revoke()
    expect(() =>
      subscribeUntil({ subscribe: () => () => undefined } as never, signal.proxy, () => undefined)
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidSignal }))
  })

  it('suppresses once and until callbacks re-entered by release', () => {
    let onceCallback!: (event: { value: number }) => void
    let untilCallback!: (event: { value: number }) => void
    const onceRelease = vi.fn(() => onceCallback({ value: 1 }))
    const untilRelease = vi.fn(() => untilCallback({ value: 1 }))
    const onceListener = vi.fn()
    const untilListener = vi.fn()
    subscribeOnce(
      {
        subscribe(callback: (event: { value: number }) => void) {
          onceCallback = callback
          return onceRelease
        }
      } as never,
      onceListener as never
    )()
    subscribeUntil(
      {
        subscribe(callback: (event: { value: number }) => void) {
          untilCallback = callback
          return untilRelease
        }
      } as never,
      { aborted: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      untilListener as never
    )()
    expect(onceListener).not.toHaveBeenCalled()
    expect(untilListener).not.toHaveBeenCalled()
  })

  it('validates subscriber disposers and codes disposer failures', () => {
    expect(() =>
      subscribeSubscriber({ subscribe: () => null } as never, { handle: () => undefined })
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel }))
    const failure = new Error('subscriber release')
    const stop = subscribeSubscriber(
      {
        subscribe: () => () => {
          throw failure
        }
      } as never,
      { handle: () => undefined }
    )
    expect(stop).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel })
    )
    expect(failure).toMatchObject({ code: EventSubscriberErrorCode.invalidChannel })
    expect(() => stop()).not.toThrow()
  })

  it('codes once disposer failures during manual stop and rollback', () => {
    const manualFailure = new Error('once manual release')
    const manualStop = subscribeOnce(
      {
        subscribe: () => () => {
          throw manualFailure
        }
      } as never,
      () => undefined
    )
    expect(manualStop).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel })
    )
    expect(manualFailure).toMatchObject({ code: EventSubscriberErrorCode.invalidChannel })
    const rollbackFailure = new Error('once rollback release')
    expect(() =>
      subscribeOnce(
        {
          subscribe(callback: (event: { value: number }) => void) {
            callback({ value: 1 })
            return () => {
              throw rollbackFailure
            }
          }
        } as never,
        () => undefined
      )
    ).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidChannel,
        errors: expect.arrayContaining([rollbackFailure])
      })
    )
  })

  it('preserves hostile structural boundary failures as coded causes', () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const channel = createEventChannel()
    const channelFailure = Proxy.revocable({}, {})
    channelFailure.revoke()
    const structuralChannel = {
      get subscribe() {
        throw channelFailure.proxy
      }
    }
    let channelThrown: unknown
    try {
      subscribeOnce(structuralChannel as never, () => undefined)
    } catch (error) {
      channelThrown = error
    }
    expect(channelThrown).toMatchObject({ code: EventSubscriberErrorCode.invalidChannel })
    expect((channelThrown as { readonly cause?: unknown }).cause).toBe(channelFailure.proxy)

    const subscriberFailure = Proxy.revocable({}, {})
    subscriberFailure.revoke()
    expect(() => subscribeSubscriber(channel, subscriberFailure.proxy as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidSubscriber })
    )

    const signalFailure = Proxy.revocable({}, {})
    signalFailure.revoke()
    expect(() =>
      subscribeUntil(channel, signalFailure.proxy as never, () => undefined)
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidSignal }))

    const optionFailure = Proxy.revocable({}, {})
    optionFailure.revoke()
    expect(() => createEventChannel(optionFailure.proxy as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions })
    )
  })

  it('rolls back subscriber installation exactly once on synchronous delivery', () => {
    let callback!: (event: { value: number }) => void
    const release = vi.fn()
    const handle = vi.fn()
    expect(() =>
      subscribeSubscriber(
        {
          subscribe(sourceCallback: (event: { value: number }) => void) {
            callback = sourceCallback
            sourceCallback({ value: 1 })
            return release
          }
        } as never,
        { handle } as never
      )
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel }))
    callback({ value: 2 })
    expect(handle).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it('makes subscriber release suppress reentrant and stale callbacks', () => {
    let callback!: (event: { value: number }) => void
    const handle = vi.fn()
    const release = vi.fn(() => callback({ value: 1 }))
    const stop = subscribeSubscriber(
      {
        subscribe(sourceCallback: (event: { value: number }) => void) {
          callback = sourceCallback
          return release
        }
      } as never,
      { handle } as never
    )
    stop()
    callback({ value: 2 })
    stop()
    expect(handle).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })
})
