import { expect, it } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { createBroadcastChannelTransport } from '../../../src/browser/adapters/broadcast-channel.js'
import { createWebTransportDatagramTransport } from '../../../src/browser/adapters/web-transport.js'
import { createRtcDataChannelTransport } from '../../../src/browser/adapters/rtc-data-channel.js'

it('classifies the native BroadcastChannel clone failure without replacing it', () => {
  /** Native serialization supplies a genuine DOMException and its original stack. */
  const channel = new BroadcastChannel('rpc-browser-audit-clone')
  /** The public adapter owns classification while the caller retains channel ownership. */
  const transport = createBroadcastChannelTransport(channel)
  try {
    expect(() => transport.send(() => undefined)).toThrowError(
      expect.objectContaining({
        name: 'DataCloneError',
        source: '@migaia/rpc/core',
        code: 'TRANSPORT'
      })
    )
  } finally {
    channel.close()
  }
})

it('classifies a native stream write rejection and preserves the original Error', async () => {
  /** The stream propagates this exact application exception through its native write Promise. */
  const original = new Error('audit datagram write failed')
  /** Real Web Streams exercise the public writer boundary without replacing private methods. */
  const transport = createWebTransportDatagramTransport({
    readable: new ReadableStream<Uint8Array>(),
    writable: new WritableStream<Uint8Array>({
      write() {
        throw original
      }
    })
  })
  try {
    await expect(transport.send(new Uint8Array([1]))).rejects.toBe(original)
    expect(original).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })
  } finally {
    await expect(transport.close?.()).rejects.toBeDefined()
  }
})

it('classifies a native stream read rejection and preserves the original Error', async () => {
  /** A real stream controller terminates the adapter with this exact input failure. */
  const original = new Error('audit datagram read failed')
  /** Publish the native controller before subscribing starts the adapter's reader. */
  let controller!: ReadableStreamDefaultController<Uint8Array>
  /** The writable side remains healthy so read ownership can close normally. */
  const transport = createWebTransportDatagramTransport({
    readable: new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      }
    }),
    writable: new WritableStream<Uint8Array>()
  })
  /** Resolve through the public transport error channel, rather than assuming a microtask count. */
  const failure = new Promise<unknown>((resolve) => transport.onTransportError!(resolve))
  /** This disposer retires the real business subscription. */
  const off = transport.subscribe(() => undefined)
  try {
    controller.error(original)
    expect(await failure).toBe(original)
    expect(original).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })
  } finally {
    off()
    await transport.close?.()
  }
})

it('retains the original RTC event error through the standard error chain', () => {
  /** Native EventTarget backs every operation required by the public structural channel. */
  const owner = new EventTarget()
  /** This complete public port needs no RTC signaling server to expose a local error event. */
  const transport = createRtcDataChannelTransport({
    readyState: 'open',
    send() {},
    addEventListener(type, listener) {
      owner.addEventListener(type, listener)
    },
    removeEventListener(type, listener) {
      owner.removeEventListener(type, listener)
    }
  })
  /** A native lower-layer exception remains reachable after terminal listener cleanup. */
  const original = new DOMException('audit RTC lower-layer failure', 'OperationError')
  /** RTC-style errors carry the original exception on the event's error slot. */
  const event = new Event('error')
  Object.defineProperty(event, 'error', { value: original })
  /** Observe only the adapter's public error channel. */
  let failure: unknown
  /** Removing the public subscription must remain valid after termination. */
  const off = transport.onTransportError!((error) => {
    failure = error
  })
  try {
    owner.dispatchEvent(event)
    expect(transport.closed).toBe(true)
    expect(failure).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })
    expect(walkErrorCauses(failure)).toContain(original)
  } finally {
    off()
  }
})
