import { expect, it } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { createBroadcastChannelTransport } from '../../../src/browser/adapters/broadcast-channel.js'
import { createRtcDataChannelTransport } from '../../../src/browser/adapters/rtc-data-channel.js'
import { createSharedWorkerTransport } from '../../../src/browser/adapters/shared-worker.js'
import { createServiceWorkerTransport } from '../../../src/browser/adapters/service-worker.js'

it.each(['shared-worker', 'service-worker'] as const)(
  'classifies native %s clone failure and keeps the borrowed port usable',
  async (carrier) => {
    /** A real native port supplies structured-clone failure and remains owned by this test. */
    const { port1, port2 } = new MessageChannel()
    /** Both public structural adapters use the same complete native MessagePort surface. */
    const transport =
      carrier === 'shared-worker'
        ? createSharedWorkerTransport(
            port1 as unknown as Parameters<typeof createSharedWorkerTransport>[0]
          )
        : createServiceWorkerTransport({
            target: port1,
            receiver: port1
          } as unknown as Parameters<typeof createServiceWorkerTransport>[0])
    try {
      /** Classification must retain the native failure class and its constructor-created stack. */
      let failure: unknown
      try {
        transport.send(() => undefined)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(DOMException)
      expect(failure).toMatchObject({
        name: 'DataCloneError',
        source: 'rpc.endpoint',
        code: 'TRANSPORT'
      })
      expect((failure as Error).stack).toBeTruthy()
      /** A failed send must not retire the caller-owned port or prevent later valid delivery. */
      const received = new Promise<unknown>((resolve) => {
        port2.addEventListener('message', (event) => resolve(event.data), { once: true })
        port2.start()
      })
      transport.send('after clone failure')
      await expect(received).resolves.toBe('after clone failure')
    } finally {
      port1.close()
      port2.close()
    }
  }
)

it('classifies the native BroadcastChannel clone failure without replacing it', () => {
  /** Native serialization supplies a genuine DOMException and its original stack. */
  const channel = new BroadcastChannel('rpc-plugin-browser-audit-clone')
  /** The public adapter owns classification while the caller retains channel ownership. */
  const transport = createBroadcastChannelTransport(channel)
  try {
    expect(() => transport.send(() => undefined)).toThrowError(
      expect.objectContaining({
        name: 'DataCloneError',
        source: 'rpc.endpoint',
        code: 'TRANSPORT'
      })
    )
  } finally {
    channel.close()
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
    expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
    expect(walkErrorCauses(failure)).toContain(original)
  } finally {
    off()
  }
})
