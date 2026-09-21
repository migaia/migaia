import { describe, expect, it, vi } from 'vitest'
import vm from 'node:vm'
import {
  EventSubscriberErrorCode,
  createEventChannel,
  createEventHub,
  invokeParallel,
  invokeParallelSettled,
  invokeSerial,
  invokeTaskSettled,
  invokeSerialSettled,
  invokeTask,
  subscribeOnce,
  subscribeSubscriber,
  subscribeUntil
} from '../src/index.js'
import { attachEventErrorCode, codeExistingError } from '../src/errors.js'
import { createSystemTerminalRuntime } from '../src/internal/terminal-runtime.js'

describe('event-subscriber contract hardening', () => {
  it('ES-T35 rejects malformed public boundaries before registration', () => {
    expect(() => createEventChannel({ report: true } as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidReporter })
    )
    expect(() => createEventChannel().subscribe(null as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidListener })
    )
    expect(() => subscribeOnce({ subscribe: null } as never, () => undefined)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel })
    )
  })

  it('ES-T46 preserves a hostile option getter as the primary coded error', () => {
    const failure = new Error('option getter')
    const options = {
      get taskId() {
        throw failure
      }
    }
    try {
      createEventChannel().subscribe(() => undefined, options as never)
      throw new Error('expected hostile getter to throw')
    } catch (error) {
      expect(error).toBe(failure)
      expect(error).toMatchObject({ code: EventSubscriberErrorCode.invalidOptions })
    }
  })

  it('ES-T50 preserves class private state and subscriber receiver identity', () => {
    const channel = createEventChannel<number, number>()
    class Subscriber {
      #multiplier = 3
      #receiver!: Subscriber

      handle(event: { value: number }): number {
        this.#receiver = this
        return this.#multiplier * event.value
      }

      receiver(): Subscriber {
        return this.#receiver
      }
    }
    const subscriber = new Subscriber()
    subscribeSubscriber(channel, subscriber)
    channel.publish(2)
    expect(subscriber.receiver()).toBe(subscriber)
  })

  it('ES-T79 uses direct structural method lookup without cached method identity', () => {
    const release = vi.fn()
    let reads = 0
    const channel = {
      get subscribe() {
        reads += 1
        return function (this: { marker: number }, callback: () => void) {
          expect(this.marker).toBe(7)
          callback()
          return release
        }
      },
      marker: 7
    }
    expect(() => subscribeOnce(channel as never, () => undefined)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel })
    )
    expect(reads).toBe(1)
    expect(release).toHaveBeenCalledOnce()
  })

  it('ES-T23 runs serial listeners after prior settlement and continues after failure', async () => {
    const channel = createEventChannel<number, number>()
    const calls: string[] = []
    channel.subscribe(() => {
      calls.push('first')
      return Promise.reject(new Error('first failure'))
    })
    channel.subscribe(() => {
      calls.push('second')
      return 2
    })

    const results = await invokeSerialSettled(channel, 1)
    expect(calls).toEqual(['first', 'second'])
    expect(results[0].status).toBe('rejected')
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: 2 })
  })

  it('ES-T49 throwing async helpers expose coded aggregate errors without reporter calls', async () => {
    const report = vi.fn()
    const channel = createEventChannel<number>({ report })
    const original = new Error('failure')
    channel.subscribe(() => Promise.reject(original))

    await expect(invokeParallel(channel, 1)).rejects.toMatchObject({
      code: EventSubscriberErrorCode.publishFailed,
      cause: original
    })
    await expect(invokeSerial(channel, 1)).rejects.toMatchObject({
      code: EventSubscriberErrorCode.publishFailed,
      cause: original
    })
    expect(report).not.toHaveBeenCalled()
  })

  it('ES-T43 returns successful parallel and serial values in registration order', async () => {
    const channel = createEventChannel<number, number>()
    channel.subscribe(async (event) => event.value + 1)
    channel.subscribe((event) => event.value + 2)

    await expect(invokeParallel(channel, 10)).resolves.toEqual([11, 12])
    await expect(invokeSerial(channel, 10)).resolves.toEqual([11, 12])
  })

  it('ES-T37 keeps task selection on the immutable snapshot while allowing live retagging', async () => {
    const channel = createEventChannel<number>()
    const calls: string[] = []
    channel.subscribe(
      (event) => {
        calls.push(`outer:${event.taskId}`)
        event.setTaskId('new')
      },
      { taskId: 'old' }
    )
    channel.subscribe(
      (event) => {
        calls.push(`stable:${event.taskId}`)
      },
      { taskId: 'stable' }
    )

    channel.publish(1)
    await invokeTask(channel, 'new', 2)
    expect(calls).toEqual(['outer:old', 'stable:stable', 'outer:new'])
  })

  it('ES-T40 does not invoke listeners or reporter when task selection is invalid', () => {
    const report = vi.fn()
    const listener = vi.fn()
    const channel = createEventChannel<number>({ report })
    channel.subscribe(listener, { taskId: 'same' })
    channel.subscribe(listener, { taskId: 'same' })

    expect(() => invokeTaskSettled(channel, 'missing', 1)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.taskNotFound,
        taskId: 'missing',
        matchCount: 0
      })
    )
    expect(() => invokeTaskSettled(channel, 'same', 1)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.taskNotUnique,
        taskId: 'same',
        matchCount: 2
      })
    )
    expect(listener).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('ES-T41 returns rejected task results without routing listener failure to reporter', async () => {
    const report = vi.fn()
    const failure = new Error('task failure')
    const channel = createEventChannel<number>({ report })
    channel.subscribe(() => Promise.reject(failure), { taskId: 'task' })

    await expect(invokeTaskSettled(channel, 'task', 1)).resolves.toMatchObject({
      status: 'rejected',
      reason: failure
    })
    expect(report).not.toHaveBeenCalled()
  })

  it('ES-T26 wraps a unique task listener failure as publish failure', async () => {
    const failure = new Error('task listener failure')
    const channel = createEventChannel<number>({ report: vi.fn() })
    channel.subscribe(() => Promise.reject(failure), { taskId: 'unique' })

    await expect(invokeTask(channel, 'unique', 1)).rejects.toMatchObject({
      code: EventSubscriberErrorCode.publishFailed,
      cause: failure
    })
  })

  it('ES-T30 keeps hub key routing and size accounting exact', () => {
    const hub = createEventHub<{ alpha: number; beta: string }>()
    const alpha = vi.fn()
    const beta = vi.fn()
    const stopAlpha = hub.subscribe('alpha', (event) => {
      alpha(event.value)
    })
    hub.subscribe('beta', (event) => beta(event.value))
    hub.publish('alpha', 1)
    hub.publish('beta', 'two')
    expect(alpha).toHaveBeenCalledWith(1)
    expect(beta).toHaveBeenCalledWith('two')
    expect(hub.size()).toBe(2)
    stopAlpha()
    expect(hub.size('alpha')).toBe(0)
    hub.clear()
    expect(hub.size()).toBe(0)
  })

  it('ES-T68 validates hub listeners before lazy channel creation and releases channel state', async () => {
    const report = vi.fn()
    const hub = createEventHub<{ alpha: number }>({ report })
    expect(() => hub.subscribe('alpha', null as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidListener })
    )
    expect(hub.size()).toBe(0)
    expect(hub.size('alpha')).toBe(0)

    const stop = hub.subscribe('alpha', () => undefined)
    stop()
    expect(hub.size()).toBe(0)
    const currentStop = hub.subscribe('alpha', () => Promise.reject(new Error('late failure')))
    hub.publish('alpha', 1)
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce())
    expect(report.mock.calls[0][0].key).toBe('alpha')
    currentStop()
  })

  it('ES-T69 codes revoked hub options proxies and preserves the proxy failure', () => {
    const revocable = Proxy.revocable({}, {})
    revocable.revoke()
    expect(() => createEventHub(revocable.proxy as never)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidOptions,
        cause: expect.any(TypeError)
      })
    )
  })

  it('ES-T70 uses requested code text when coding frozen or non-error failures', () => {
    const frozen = Object.freeze(new TypeError('frozen signal'))
    const codedFrozen = attachEventErrorCode(frozen, EventSubscriberErrorCode.invalidSignal)
    expect(codedFrozen).toMatchObject({
      code: EventSubscriberErrorCode.invalidSignal,
      message: 'event-subscriber abort signal is invalid',
      cause: frozen
    })

    const codedValue = codeExistingError(
      Object.freeze(new Error('frozen signal')),
      EventSubscriberErrorCode.invalidSignal
    )
    expect(codedValue).toMatchObject({
      code: EventSubscriberErrorCode.invalidSignal,
      message: 'event-subscriber abort signal is invalid',
      cause: expect.any(Error)
    })
  })

  it('ES-T71 contains hostile queueMicrotask access and invocation failures', () => {
    const diagnostic = new Error('supplied diagnostic')
    const getterFailure = new Error('queue getter')
    const getterHost = {
      get queueMicrotask(): (callback: () => void) => void {
        throw getterFailure
      }
    }
    expect(() => createSystemTerminalRuntime(getterHost).enqueueThrow(diagnostic)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.unhandledListenerFailure,
        cause: diagnostic,
        errors: [diagnostic, getterFailure]
      })
    )

    const invokeFailure = new Error('queue invoke')
    const invokeHost = {
      queueMicrotask: () => {
        throw invokeFailure
      }
    }
    expect(() => createSystemTerminalRuntime(invokeHost).enqueueThrow(diagnostic)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.unhandledListenerFailure,
        cause: diagnostic,
        errors: [diagnostic, invokeFailure]
      })
    )
  })

  it('ES-T14 does not invoke user cleanup from clear and makes unsubscribe idempotent', () => {
    const channel = createEventChannel<number>()
    const listener = vi.fn()
    const stop = channel.subscribe(listener)
    channel.clear()
    stop()
    stop()
    channel.publish(1)
    expect(listener).not.toHaveBeenCalled()
    expect(channel.size).toBe(0)
  })

  it('ES-T56 keeps event abort state live through synchronous reentry', () => {
    const channel = createEventChannel<number>()
    const calls: string[] = []
    channel.subscribe((event) => {
      calls.push(`outer:${event.aborted}`)
      event.abort('cancelled')
      calls.push(`after:${event.aborted}:${event.abortReason}`)
      channel.publish(event.value)
    })
    channel.publish(1)
    expect(calls).toEqual(['outer:false', 'after:true:cancelled'])
    expect(channel.size).toBe(0)
  })

  it('ES-T36 ignores task retagging after a registration becomes inactive', async () => {
    const channel = createEventChannel<number>()
    let release!: () => void
    const calls: string[] = []
    release = channel.subscribe(
      (event) => {
        calls.push(event.taskId ?? 'none')
        event.setTaskId('retagged')
      },
      { taskId: 'initial' }
    )
    release()
    await expect(invokeParallelSettled(channel.filterTaskId('retagged'), 1)).resolves.toEqual([])
    expect(calls).toEqual([])
  })

  it('ES-T99 removes a signal-linked registration on manual unsubscribe', () => {
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

  it('ES-T09 does not register against an already-aborted signal', () => {
    const subscribe = vi.fn(() => () => undefined)
    const signal = {
      aborted: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    subscribeUntil({ subscribe } as never, signal, () => undefined)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('ES-T72 rechecks aborted after listener installation and releases the registration', () => {
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

  it('ES-T81 preserves second-check reason as primary over remove and release failures', () => {
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

  it('ES-T82 invokes signal methods directly with the original receiver', () => {
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

  it('ES-T44 reports remove failure after releasing a manually unsubscribed registration', () => {
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

  it('ES-T21 makes structural subscribeOnce atomic when subscribe invokes synchronously', () => {
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

  it('ES-T60 rejects structurally illegal synchronous once callbacks and rolls back', () => {
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

  it('ES-T61 suppresses structural once callbacks when disposer validation fails', () => {
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

  it('ES-T62 suppresses structural until callbacks when disposer validation fails', () => {
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

  it('ES-T63 installs abort observation before structural source subscription and rolls back sync delivery', () => {
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

  it('ES-T64 rejects source events when abort races source installation and rolls back', () => {
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

  it('ES-T65 cleans up when addEventListener stores then throws', () => {
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

  it('ES-T66 marks abort before a hostile reason getter and preserves cleanup errors after it', () => {
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

  it('ES-T67 makes cleanup idempotent and preserves both cleanup failures', () => {
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

  it('ES-T74 makes once cleanup helper-owned and idempotent', () => {
    const release = vi.fn()
    const stop = subscribeOnce({ subscribe: () => release } as never, () => undefined)
    stop()
    stop()
    expect(release).toHaveBeenCalledOnce()
  })

  it('ES-T75 validates helper options even when a structural source ignores them', () => {
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

  it('ES-T76 rejects a hostile synchronous source storm during helper installation', () => {
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

  it('ES-T77 preserves a business listener failure after structural installation', () => {
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

  it('ES-T78 codes revoked structural channel and signal boundaries', () => {
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

  it('ES-T83 codes revoked thrown boundary values while preserving the original cause', () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const options = {
      get taskId() {
        throw revoked.proxy
      }
    }
    let thrown: unknown
    try {
      createEventChannel().subscribe(() => undefined, options as never)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: EventSubscriberErrorCode.invalidOptions })
    expect((thrown as { readonly cause?: unknown }).cause).toBe(revoked.proxy)
  })

  it('ES-T84 suppresses once and until callbacks re-entered by release', () => {
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

  it('ES-T85 validates subscriber disposers and codes disposer failures', () => {
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

  it('ES-T86 codes once disposer failures during manual stop and rollback', () => {
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

  it('ES-T87 validates signal methods before accepting an already-aborted signal', () => {
    expect(() =>
      subscribeUntil(
        { subscribe: () => () => undefined } as never,
        { aborted: true, addEventListener: null, removeEventListener: null } as never,
        () => undefined
      )
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidSignal }))
  })

  it('ES-T88 ignores a stale abort callback after manual stop without reading reason', () => {
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

  it('ES-T89 invokes terminal queueMicrotask with its original receiver', () => {
    const callbacks: (() => void)[] = []
    class Host {
      #calls = 0

      get calls(): number {
        return this.#calls
      }

      queueMicrotask(callback: () => void): void {
        this.#calls += 1
        callbacks.push(callback)
      }
    }
    const host = new Host()
    createSystemTerminalRuntime(host).enqueueThrow(new Error('terminal'))
    expect(host.calls).toBe(1)
    expect(callbacks).toHaveLength(1)
  })

  it('ES-T52 routes reporter and terminal thenable failures to the system sink', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const channel = createEventChannel<number>({
      report: () => {
        throw new Error('reporter failure')
      },
      terminalReport: () => Promise.reject(new Error('terminal failure'))
    })
    channel.subscribe(() => Promise.reject(new Error('listener failure')))
    channel.publish(1)

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce())
    expect(consoleError.mock.calls[0][0]).toMatchObject({
      code: EventSubscriberErrorCode.unhandledListenerFailure
    })
    consoleError.mockRestore()
  })

  it('ES-T55 continues terminal fallback after a hostile then getter', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const terminalFailure = new Error('terminal then getter')
    const terminalReport = () => {
      const thenProperty = ['t', 'h', 'e', 'n'].join('')
      const thenable = {}
      Object.defineProperty(thenable, thenProperty, {
        get() {
          throw terminalFailure
        }
      })
      return thenable as never
    }
    const channel = createEventChannel<number>({ terminalReport })
    channel.subscribe(() => Promise.reject(new Error('listener failure')))
    channel.publish(1)

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce())
    expect(consoleError.mock.calls[0][0]).toMatchObject({
      code: EventSubscriberErrorCode.unhandledListenerFailure
    })
    expect(consoleError.mock.calls[0][0].errors).toContain(terminalFailure)
    consoleError.mockRestore()
  })

  it('ES-T42 continues terminal fallback after a synchronous terminal throw', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const terminalFailure = new Error('terminal throw')
    const channel = createEventChannel<number>({
      terminalReport: () => {
        throw terminalFailure
      }
    })
    channel.subscribe(() => Promise.reject(new Error('listener failure')))
    channel.publish(1)

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce())
    expect(consoleError.mock.calls[0][0].errors).toContain(terminalFailure)
    consoleError.mockRestore()
  })

  it('ES-T90 routes an asynchronous reporter rejection to terminal fallback', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const listenerFailure = new Error('listener failure')
    const reporterFailure = new Error('async reporter failure')
    const channel = createEventChannel<number>({
      report: () => Promise.reject(reporterFailure)
    })
    channel.subscribe(() => Promise.reject(listenerFailure))
    channel.publish(1)

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce())
    const diagnostic = consoleError.mock.calls[0][0] as AggregateError
    expect(diagnostic.errors).toContain(listenerFailure)
    expect(diagnostic.errors).toContain(reporterFailure)
    consoleError.mockRestore()
  })

  it('ES-T91 synchronously throws when queueMicrotask is missing or non-callable', () => {
    const diagnostic = new Error('terminal diagnostic')
    const hosts: readonly object[] = [
      {},
      { queueMicrotask: undefined },
      { queueMicrotask: null },
      {
        get queueMicrotask() {
          return undefined
        }
      }
    ]
    for (const host of hosts) {
      expect(() => createSystemTerminalRuntime(host as never).enqueueThrow(diagnostic)).toThrow(
        diagnostic
      )
    }
  })

  it('ES-T92 preserves hostile structural boundary failures as coded causes', () => {
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

  it('ES-T93 wraps non-Error thrown values and hostile Error probes safely', () => {
    const values: readonly unknown[] = [{ reason: 'object' }, () => undefined, 'string']
    for (const value of values) {
      const coded = codeExistingError(value, EventSubscriberErrorCode.invalidChannel) as Error & {
        readonly cause?: unknown
        readonly code?: string
      }
      expect(coded).toBeInstanceOf(TypeError)
      expect(coded.code).toBe(EventSubscriberErrorCode.invalidChannel)
      expect(coded.cause).toBe(value)
    }
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const codedRevoked = codeExistingError(
      revoked.proxy,
      EventSubscriberErrorCode.invalidChannel
    ) as Error & { readonly cause?: unknown; readonly code?: string }
    expect(codedRevoked).toBeInstanceOf(TypeError)
    expect(codedRevoked.code).toBe(EventSubscriberErrorCode.invalidChannel)
    expect(codedRevoked.cause).toBe(revoked.proxy)
  })

  it('ES-T94 rolls back subscriber installation exactly once on synchronous delivery', () => {
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

  it('ES-T95 makes subscriber release suppress reentrant and stale callbacks', () => {
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

  it('ES-T96 removes a listener retained after synchronous abort during installation', () => {
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

  it('ES-T97 preserves a genuine cross-realm Error while coding it', () => {
    const foreignError = vm.runInNewContext('new TypeError("foreign")') as Error
    const coded = codeExistingError(
      foreignError,
      EventSubscriberErrorCode.invalidChannel
    ) as Error & { readonly code?: string }

    expect(coded).toBe(foreignError)
    expect(coded).toBeInstanceOf(foreignError.constructor as typeof Error)
    expect(coded.name).toBe('TypeError')
    expect(coded.stack).toBe(foreignError.stack)
    expect(coded.code).toBe(EventSubscriberErrorCode.invalidChannel)
  })

  it('ES-T98 reads queueMicrotask once and preserves its receiver', () => {
    const callbacks: (() => void)[] = []
    let reads = 0
    class Host {
      #calls = 0

      get calls(): number {
        return this.#calls
      }

      get queueMicrotask(): (callback: () => void) => void {
        reads += 1
        return (callback) => {
          this.#calls += 1
          callbacks.push(callback)
        }
      }
    }
    const host = new Host()
    const diagnostic = new Error('terminal')
    createSystemTerminalRuntime(host).enqueueThrow(diagnostic)

    expect(reads).toBe(1)
    expect(host.calls).toBe(1)
    expect(callbacks).toHaveLength(1)
  })

  // Behaviour-equivalence promise, and the case that was missing when it broke. A hostile `aborted`
  // getter throws the caller's own value; coding it in place is what keeps `thrown === original` and
  // its native type, and a wrapper carrying it on `cause` keeps neither. The shared validator
  // captures that throw instead of letting it escape, so only the call site can preserve the
  // identity — and both admission reads can lose it independently, so both are asserted here.
  it('ES-T188 preserves the thrown identity of a hostile aborted getter at both admission reads', () => {
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
