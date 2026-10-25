import { describe, expect, it } from 'vitest'
import { createRtcDataChannelCarrier } from '../../../dist/browser/adapters/rtc-data-channel.js'
import { createSharedWorkerCarrier } from '../../../dist/browser/adapters/shared-worker.js'
import {
  createDedicatedWorkerCarrier,
  subscribeWorkerErrors
} from '../../../dist/browser/adapters/dedicated-worker.js'

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
  it('tags an already closed RTC channel with the original native text', async () => {
    /** Native terminal state is captured by the actual RTC carrier before receiver acquisition. */
    const carrier = createRtcDataChannelCarrier(
      {
        readyState: 'closed',
        send() {},
        addEventListener() {},
        removeEventListener() {}
      },
      { report: () => undefined }
    )
    /** The actual late receiver observes the same original native Error. */
    const observed: unknown[] = []
    carrier.subscribe({
      frame: () => undefined,
      error: () => undefined,
      close: (error) => observed.push(error)
    })
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({
      source: 'rpc.endpoint',
      code: 'TRANSPORT',
      message: 'RTCDataChannel closed'
    })
    expect((observed[0] as Error).constructor).toBe(Error)
    await carrier.close()
  })

  it('converts a non-Error RTC terminal event to a tagged native Error', async () => {
    /** This original fixture supplies a real native terminal callback and remover failure. */
    const fixture = rtcChannel()
    /** Native cleanup diagnostics flow through the actual SDK reporter, without test aggregation. */
    const observed: unknown[] = []
    /** SDK holds the exact disposer returned by the native RTC owner. */
    const carrier = createRtcDataChannelCarrier(fixture.channel, {
      report: (error) => observed.push(error)
    })
    carrier.subscribe({ frame: () => undefined, error: () => undefined, close: () => undefined })
    fixture.emit({ type: 'close' })
    await carrier.close().catch(() => undefined)
    /** The real native owner's cleanup aggregate keeps the original terminal Error first. */
    const aggregate = observed[0] as AggregateError
    expect(aggregate.errors[0]).toMatchObject({
      source: 'rpc.endpoint',
      code: 'TRANSPORT',
      message: 'RTCDataChannel closed'
    })
    expect(aggregate.errors[0].constructor).toBe(Error)
  })

  it('preserves a hostile Worker message read as cause of the native error', async () => {
    /** Actual native acquisition installs the same callbacks used by dedicatedWorkerPlugin. */
    const listeners = new Map<string, (event: MessageEvent<unknown>) => void>()
    /** No native Worker is owned or terminated by this real carrier. */
    const carrier = createDedicatedWorkerCarrier(
      {
        postMessage() {},
        addEventListener(type, listener) {
          listeners.set(type, listener)
        },
        removeEventListener(type) {
          listeners.delete(type)
        }
      },
      { report: () => undefined }
    )
    /** The actual SDK error callback receives this native failure before physical retirement. */
    const observed: unknown[] = []
    /** The same original failure must remain directly on cause. */
    const original = new Error('read failed')
    carrier.subscribe({
      frame: () => undefined,
      error: (error) => observed.push(error),
      close: () => undefined
    })
    listeners.get('message')?.({
      get data(): never {
        throw original
      }
    } as unknown as MessageEvent<unknown>)
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({
      source: 'rpc.endpoint',
      code: 'TRANSPORT',
      cause: original
    })
    await carrier.close()
  })

  it('tags SharedWorker messageerror and both Worker failure events', async () => {
    /** Each actual native event is classified by its real acquisition owner. */
    const listeners = new Map<string, (event: MessageEvent<unknown>) => void>()
    /** Native registration/removal is observable without a second transport facade. */
    const port = {
      postMessage() {},
      addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        listeners.set(type, listener)
      },
      removeEventListener(type: string) {
        listeners.delete(type)
      }
    }
    /** The SharedWorker factory lends its true native error source to SDK. */
    const shared = createSharedWorkerCarrier(port, { report: () => undefined })
    /** One native messageerror remains one original coded Error. */
    const sharedErrors: unknown[] = []
    shared.subscribe({
      frame: () => undefined,
      error: (error) => sharedErrors.push(error),
      close: () => undefined
    })
    listeners.get('messageerror')?.(new Event('messageerror') as MessageEvent<unknown>)
    expect(sharedErrors).toHaveLength(1)
    expect(sharedErrors[0]).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
    await shared.close()

    listeners.clear()
    /** This production native helper owns the two independent Worker event mappings. */
    const workerErrors: unknown[] = []
    /** Directly exercise the same acquisition that the actual Worker carrier calls once. */
    const stop = subscribeWorkerErrors(
      port,
      (error) => workerErrors.push(error),
      () => undefined
    )
    listeners.get('error')?.(new Event('error') as MessageEvent<unknown>)
    listeners.get('messageerror')?.(new Event('messageerror') as MessageEvent<unknown>)
    expect(workerErrors).toHaveLength(2)
    for (const error of workerErrors) {
      expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
      expect((error as Error).constructor).toBe(Error)
    }
    stop()
  })

  it('tags an extensible RTC error once and replays that same object', async () => {
    /** Original RTC native callback and remover failure remain the complete fixture. */
    const fixture = rtcChannel()
    /** Exact original terminal identity and stack remain the observable business contract. */
    const original = new Error('terminal failure')
    /** The native constructor stack must never be regenerated during error tagging. */
    const stack = original.stack
    /** Initial cleanup report and late terminal replay have distinct actual destinations. */
    const received: unknown[] = []
    /** The actual RTC carrier performs tagging and lends its original remover to SDK. */
    const carrier = createRtcDataChannelCarrier(fixture.channel, {
      report: (failure) => received.push(failure)
    })
    carrier.subscribe({ frame: () => undefined, error: () => undefined, close: () => undefined })
    fixture.emit(original)
    await carrier.close().catch(() => undefined)
    carrier.subscribe({
      frame: () => undefined,
      error: () => undefined,
      close: (failure) => received.push(failure)
    })
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
  ])('wraps an untaggable RTC error and retains its cause', async (original) => {
    /** Existing native event/remover observations remain unchanged for both original classes. */
    const fixture = rtcChannel()
    /** Actual cleanup reporting and late terminal replay must share one native wrapper. */
    const received: unknown[] = []
    /** Preserve exact native stack and own-property surface, including numeric DOMException.code. */
    const stack = original.stack
    /** Error tagging must never add keys to the original untaggable native failure. */
    const keys = Reflect.ownKeys(original)
    /** The native RTC owner is the same constructor used by the real cold transport plugin. */
    const carrier = createRtcDataChannelCarrier(fixture.channel, {
      report: (failure) => received.push(failure)
    })
    carrier.subscribe({ frame: () => undefined, error: () => undefined, close: () => undefined })
    fixture.emit(original)
    await carrier.close().catch(() => undefined)
    carrier.subscribe({
      frame: () => undefined,
      error: () => undefined,
      close: (failure) => received.push(failure)
    })
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
