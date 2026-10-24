import { describe, expect, it } from 'vitest'
import { createRtcDataChannelTransport } from '../../../src/browser/adapters/rtc-data-channel.js'
import { createSharedWorkerTransport } from '../../../src/browser/adapters/shared-worker.js'
import { createWebWorkerTransport } from '@migaia/rpc-host/plugin'

type IListener = (event: unknown) => void

/** Builds an RTC channel with a cleanup failure to expose aggregate ordering. */
/** Allocate only this case's original observations before installing native-shaped callbacks. */
function failingRtcChannelFixtureState() {
  const listeners = new Map<string, Set<IListener>>()
  const cleanup = new Error('cleanup failed')
  return { listeners, cleanup }
}

/** Own one test resource's mutable observations without sharing a factory closure. */
class FailingRtcChannelFixture {
  /** Counts, native events and construction inputs belong only to this fixture instance. */
  #state: ReturnType<typeof failingRtcChannelFixtureState>
  /** Existing consumers retain the same observable fixture surface and callback identities. */
  readonly value
  /** Install the original native-shaped callbacks after their observations exist. */
  constructor() {
    this.#state = failingRtcChannelFixtureState()
    const channel = {
      readyState: 'open',
      send: () => {},
      addEventListener: (type: string, listener: IListener) => {
        const current = this.#state.listeners.get(type) ?? new Set<IListener>()
        current.add(listener)
        this.#state.listeners.set(type, current)
      },
      removeEventListener: (type: string, listener: IListener) => {
        if (type === 'close') throw this.#state.cleanup
        this.#state.listeners.get(type)?.delete(listener)
      }
    }
    this.value = {
      channel,
      cleanup: this.#state.cleanup,
      emit: (event: unknown) => {
        for (const listener of this.#state.listeners.get('close') ?? []) listener(event)
      }
    }
  }
}

/** Create one independent owner for the existing native-boundary fixture. */
function rtcChannel() {
  return new FailingRtcChannelFixture().value
}

describe('browser native transport error identity', () => {
  it('tags an already closed RTC channel with the original native text', () => {
    const transport = createRtcDataChannelTransport({
      readyState: 'closed',
      send() {},
      addEventListener() {},
      removeEventListener() {}
    })
    const observed: unknown[] = []
    transport.onTransportError?.((error) => observed.push(error))
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({
      source: 'rpc.endpoint',
      code: 'TRANSPORT',
      message: 'RTCDataChannel closed'
    })
    expect((observed[0] as Error).constructor).toBe(Error)
  })

  it('converts a non-Error RTC terminal event to a tagged native Error', () => {
    const fixture = rtcChannel()
    const transport = createRtcDataChannelTransport(fixture.channel)
    const observed: unknown[] = []
    transport.onTransportError?.((error) => observed.push(error))
    fixture.emit({ type: 'close' })
    const aggregate = observed[0] as AggregateError
    expect(aggregate.errors[0]).toMatchObject({
      source: 'rpc.endpoint',
      code: 'TRANSPORT',
      message: 'RTCDataChannel closed'
    })
    expect(aggregate.errors[0].constructor).toBe(Error)
  })

  it('preserves a hostile Worker message read as cause of the native error', () => {
    const listeners = new Map<string, (event: Event) => void>()
    const transport = createWebWorkerTransport({
      postMessage() {},
      addEventListener(type, listener) {
        listeners.set(type, listener)
      },
      removeEventListener(type) {
        listeners.delete(type)
      }
    })
    const observed: unknown[] = []
    const original = new Error('read failed')
    transport.onTransportError?.((error) => observed.push(error))
    transport.subscribe(() => undefined)
    listeners.get('message')?.({
      get data(): never {
        throw original
      }
    } as unknown as Event)
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({
      source: 'rpc.endpoint',
      code: 'TRANSPORT',
      cause: original
    })
  })

  it('tags SharedWorker messageerror and both Worker failure events', () => {
    const listeners = new Map<string, (event: Event) => void>()
    const port = {
      postMessage() {},
      addEventListener(type: string, listener: (event: Event) => void) {
        listeners.set(type, listener)
      },
      removeEventListener(type: string) {
        listeners.delete(type)
      }
    }
    const shared = createSharedWorkerTransport(port)
    const sharedErrors: unknown[] = []
    shared.onTransportError?.((error) => sharedErrors.push(error))
    shared.subscribe(() => undefined)
    listeners.get('messageerror')?.(new Event('messageerror'))
    expect(sharedErrors).toHaveLength(1)
    expect(sharedErrors[0]).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })

    listeners.clear()
    const worker = createWebWorkerTransport(port)
    const workerErrors: unknown[] = []
    worker.onTransportError?.((error) => workerErrors.push(error))
    listeners.get('error')?.(new Event('error'))
    listeners.get('messageerror')?.(new Event('messageerror'))
    expect(workerErrors).toHaveLength(2)
    for (const error of workerErrors) {
      expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
      expect((error as Error).constructor).toBe(Error)
    }
  })

  it('tags an extensible RTC error once and replays that same object', () => {
    const fixture = rtcChannel()
    const transport = createRtcDataChannelTransport(fixture.channel)
    const original = new Error('terminal failure')
    const stack = original.stack
    const received: unknown[] = []
    transport.onTransportError?.((failure) => received.push(failure))
    fixture.emit(original)
    transport.onTransportError?.((failure) => received.push(failure))
    expect(received).toHaveLength(2)
    const aggregate = received[0] as AggregateError
    expect(aggregate.errors[0]).toBe(original)
    expect(aggregate.errors[1]).toBe(fixture.cleanup)
    expect(received[1]).toBe(original)
    expect(original).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
    expect(original.message).toBe('terminal failure')
    expect(original.stack).toBe(stack)
  })

  it.each([
    Object.freeze(new Error('frozen terminal')),
    new DOMException('dom terminal', 'OperationError')
  ])('wraps an untaggable RTC error and retains its cause', (original) => {
    const fixture = rtcChannel()
    const transport = createRtcDataChannelTransport(fixture.channel)
    const received: unknown[] = []
    const stack = original.stack
    const keys = Reflect.ownKeys(original)
    transport.onTransportError?.((failure) => received.push(failure))
    fixture.emit(original)
    transport.onTransportError?.((failure) => received.push(failure))
    const aggregate = received[0] as AggregateError
    const wrapper = aggregate.errors[0]
    expect(wrapper).not.toBe(original)
    expect(wrapper).toMatchObject({
      source: 'rpc.endpoint',
      code: 'TRANSPORT',
      cause: original
    })
    expect(wrapper.constructor).toBe(Error)
    expect(received[1]).toBe(wrapper)
    expect(Reflect.ownKeys(original)).toEqual(keys)
    expect(original.stack).toBe(stack)
    if (original instanceof DOMException) expect(typeof original.code).toBe('number')
  })
})
