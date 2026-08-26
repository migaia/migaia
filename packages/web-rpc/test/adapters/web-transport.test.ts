import { describe, expect, it } from 'vitest'
import { createWebTransportDatagramTransport } from '../../src/adapters/web-transport'

function datagrams(close?: () => Promise<void>): {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
} {
  return {
    readable: new ReadableStream<Uint8Array>(),
    writable: new WritableStream<Uint8Array>({ close })
  }
}

describe('WebTransport datagram adapter', () => {
  it('declares its datagram reader and writer as owned', () => {
    const transport = createWebTransportDatagramTransport(datagrams())
    expect(transport.ownership).toBe('owned')
    expect(transport.topology).toBe('exclusive')
    return transport.close?.()
  })

  it('waits for the read owner and rejects operations after close', async () => {
    const transport = createWebTransportDatagramTransport(datagrams())
    transport.subscribe(() => undefined)
    await transport.close?.()
    expect(() => transport.send(new Uint8Array([1]))).toThrow('closed')
    expect(() => transport.subscribe(() => undefined)).toThrow('closed')
  })

  it('keeps the transport-owned reader across unsubscribe and resubscribe', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const received: number[] = []
    const transport = createWebTransportDatagramTransport({
      readable: new ReadableStream<Uint8Array>({
        start(next) {
          controller = next
        }
      }),
      writable: new WritableStream<Uint8Array>()
    })
    const first = transport.subscribe(() => undefined)
    first()
    transport.subscribe((message) => received.push(message.data[0] ?? 0))
    controller.enqueue(new Uint8Array([7]))
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(received).toEqual([7])
    await transport.close?.()
  })

  it('surfaces writer cleanup failure from close', async () => {
    const transport = createWebTransportDatagramTransport(
      datagrams(async () => {
        throw new Error('writer close failed')
      })
    )
    await expect(transport.close?.()).rejects.toThrow('writer close failed')
  })
  it('contains a reader acquisition failure at the transport boundary', async () => {
    const errors: unknown[] = []
    const transport = createWebTransportDatagramTransport({
      readable: {
        getReader() {
          throw new Error('reader acquisition failed')
        }
      } as unknown as ReadableStream<Uint8Array>,
      writable: new WritableStream<Uint8Array>()
    })
    transport.onTransportError?.((error) => errors.push(error))
    transport.subscribe(() => undefined)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(errors).toHaveLength(1)
    await transport.close?.()
  })
  it('contains an asynchronous reader failure at the transport boundary', async () => {
    let fail!: (error: unknown) => void
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        fail = (error) => controller.error(error)
      }
    })
    const errors: unknown[] = []
    const transport = createWebTransportDatagramTransport({
      readable,
      writable: new WritableStream<Uint8Array>()
    })
    transport.onTransportError?.((error) => errors.push(error))
    transport.subscribe(() => undefined)
    const failure = new Error('reader failed')
    fail(failure)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(errors).toEqual([failure])
    await transport.close?.()
  })
  it('treats a normal datagram EOF as terminal', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const errors: unknown[] = []
    const transport = createWebTransportDatagramTransport({
      readable: new ReadableStream<Uint8Array>({
        start(next) {
          controller = next
        }
      }),
      writable: new WritableStream<Uint8Array>()
    })
    transport.onTransportError?.((error) => errors.push(error))
    transport.subscribe(() => undefined)
    controller.close()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(transport.closed).toBe(true)
    expect(errors).toHaveLength(1)
    expect(() => transport.subscribe(() => undefined)).toThrow('closed')
    await transport.close?.()
  })
  it('returns reader release failures from close', async () => {
    const transport = createWebTransportDatagramTransport({
      readable: {
        getReader() {
          return {
            read: async () => ({ done: true, value: undefined }),
            cancel: async () => undefined,
            releaseLock() {
              throw new Error('reader release failed')
            }
          }
        }
      } as unknown as ReadableStream<Uint8Array>,
      writable: new WritableStream<Uint8Array>()
    })
    transport.subscribe(() => undefined)
    await expect(transport.close?.()).rejects.toThrow('reader release failed')
  })
  it('shares the in-flight close promise', async () => {
    const transport = createWebTransportDatagramTransport(datagrams())
    const first = transport.close?.()
    const second = transport.close?.()
    expect(second).toBe(first)
    await first
  })
})
