import { describe, expect, it } from 'vitest'
import { createRtcDataChannelTransport } from '../../../src/browser/adapters/rtc-data-channel.js'
import { createSharedWorkerTransport } from '../../../src/browser/adapters/shared-worker.js'
import { createWebTransportDatagramTransport } from '../../../src/browser/adapters/web-transport.js'
import { createWebWorkerTransport } from '../../../src/browser/adapters/web-worker.js'

type IListener = (event: unknown) => void

/** Builds an RTC channel with a cleanup failure to expose aggregate ordering. */
function rtcChannel() {
  const listeners = new Map<string, Set<IListener>>()
  const cleanup = new Error('cleanup failed')
  const channel = {
    readyState: 'open',
    send() {},
    addEventListener(type: string, listener: IListener) {
      const current = listeners.get(type) ?? new Set<IListener>()
      current.add(listener)
      listeners.set(type, current)
    },
    removeEventListener(type: string, listener: IListener) {
      if (type === 'close') throw cleanup
      listeners.get(type)?.delete(listener)
    }
  }
  return {
    channel,
    cleanup,
    emit(event: unknown) {
      for (const listener of listeners.get('close') ?? []) listener(event)
    }
  }
}

describe('browser native transport error identity', () => {
  it('[A4] tags an already closed RTC channel with the original native text', () => {
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
      source: '@migaia/rpc/core',
      code: 'TRANSPORT',
      message: 'RTCDataChannel closed'
    })
    expect((observed[0] as Error).constructor).toBe(Error)
  })

  it('[A4] tags a WebTransport datagram EOF', async () => {
    let reader!: ReadableStreamDefaultController<Uint8Array>
    const transport = createWebTransportDatagramTransport({
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          reader = controller
        }
      }),
      writable: new WritableStream<Uint8Array>()
    })
    const observed: unknown[] = []
    transport.onTransportError?.((error) => observed.push(error))
    transport.subscribe(() => undefined)
    reader.close()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({
      source: '@migaia/rpc/core',
      code: 'TRANSPORT',
      message: 'WebTransport datagram stream ended'
    })
    await transport.close?.()
  })

  it('[A4] converts a non-Error RTC terminal event to a tagged native Error', () => {
    const fixture = rtcChannel()
    const transport = createRtcDataChannelTransport(fixture.channel)
    const observed: unknown[] = []
    transport.onTransportError?.((error) => observed.push(error))
    fixture.emit({ type: 'close' })
    const aggregate = observed[0] as AggregateError
    expect(aggregate.errors[0]).toMatchObject({
      source: '@migaia/rpc/core',
      code: 'TRANSPORT',
      message: 'RTCDataChannel closed'
    })
    expect(aggregate.errors[0].constructor).toBe(Error)
  })

  it('[A4] preserves a hostile Worker message read as cause of the native error', () => {
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
      source: '@migaia/rpc/core',
      code: 'TRANSPORT',
      cause: original
    })
  })

  it('[A4] tags SharedWorker messageerror and both Worker failure events', () => {
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
    expect(sharedErrors[0]).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })

    listeners.clear()
    const worker = createWebWorkerTransport(port)
    const workerErrors: unknown[] = []
    worker.onTransportError?.((error) => workerErrors.push(error))
    listeners.get('error')?.(new Event('error'))
    listeners.get('messageerror')?.(new Event('messageerror'))
    expect(workerErrors).toHaveLength(2)
    for (const error of workerErrors) {
      expect(error).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })
      expect((error as Error).constructor).toBe(Error)
    }
  })

  it('[A10] tags an extensible RTC error once and replays that same object', () => {
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
    expect(original).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })
    expect(original.message).toBe('terminal failure')
    expect(original.stack).toBe(stack)
  })

  it.each([
    Object.freeze(new Error('frozen terminal')),
    new DOMException('dom terminal', 'OperationError')
  ])('[A10] wraps an untaggable RTC error and retains its cause', (original) => {
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
      source: '@migaia/rpc/core',
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
