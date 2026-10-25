import { expect, it } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { BroadcastRouteIO } from '../../../dist/browser/adapters/broadcast-channel.js'
import { createRtcDataChannelCarrier } from '../../../dist/browser/adapters/rtc-data-channel.js'
import { createSharedWorkerCarrier } from '../../../dist/browser/adapters/shared-worker.js'
import { createServiceWorkerCarrier } from '../../../dist/browser/adapters/service-worker.js'
import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'

it.each(['shared-worker', 'service-worker'] as const)(
  'classifies native %s clone failure and keeps the borrowed port usable',
  async (carrier) => {
    /** A real native port supplies structured-clone failure and remains owned by this test. */
    const { port1, port2 } = new MessageChannel()
    /** Both actual native constructors use the same complete caller-owned MessagePort surface. */
    const resource =
      carrier === 'shared-worker'
        ? createSharedWorkerCarrier(
            port1 as unknown as Parameters<typeof createSharedWorkerCarrier>[0],
            { report: () => undefined }
          )
        : createServiceWorkerCarrier(
            {
              target: port1,
              receiver: port1
            } as unknown as Parameters<typeof createServiceWorkerCarrier>[0],
            { report: () => undefined }
          )
    try {
      expect(resource.closingWrites).toBe(true)
      expect(resource.mapRetirement).toBeUndefined()
      /** Classification must retain the native failure class and its constructor-created stack. */
      let failure: unknown
      try {
        await resource.write({ kind: RpcCarrierFrameKind.message, data: () => undefined })
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
      /** New protocol media framing preserves the original subsequent payload unchanged. */
      const frame = { kind: RpcCarrierFrameKind.message, data: 'after clone failure' } as const
      await resource.write(frame)
      await expect(received).resolves.toEqual(frame)
    } finally {
      await resource.close()
      port1.close()
      port2.close()
    }
  }
)

it('classifies the native BroadcastChannel clone failure without replacing it', async () => {
  /** Native serialization supplies a genuine DOMException and its original stack. */
  const channel = new BroadcastChannel('rpc-plugin-browser-audit-clone')
  /** The actual native route lends its existing send port to the same SDK owner used by discovery. */
  const resource = createRpcMessageCarrier({
    id: 'native-broadcast-clone-audit',
    nativeBinary: true,
    io: new BroadcastRouteIO(
      (frame) => channel.postMessage(frame),
      () => undefined,
      () => undefined
    ),
    report: () => undefined
  })
  try {
    await expect(
      resource.write({ kind: RpcCarrierFrameKind.message, data: () => undefined })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: 'DataCloneError',
        source: 'rpc.endpoint',
        code: 'TRANSPORT'
      })
    )
  } finally {
    await resource.close()
    channel.close()
  }
})

it('retains the original RTC event error through the standard error chain', async () => {
  /** Native EventTarget backs every operation required by the public structural channel. */
  const owner = new EventTarget()
  /** This complete public port needs no RTC signaling server to expose a local error event. */
  const resource = createRtcDataChannelCarrier(
    {
      readyState: 'open',
      send() {},
      addEventListener(type, listener) {
        owner.addEventListener(type, listener)
      },
      removeEventListener(type, listener) {
        owner.removeEventListener(type, listener)
      }
    },
    { report: () => undefined }
  )
  expect(resource.closingWrites).toBe(true)
  expect(resource.mapRetirement).toBeUndefined()
  /** A native lower-layer exception remains reachable after terminal listener cleanup. */
  const original = new DOMException('audit RTC lower-layer failure', 'OperationError')
  /** RTC-style errors carry the original exception on the event's error slot. */
  const event = new Event('error')
  Object.defineProperty(event, 'error', { value: original })
  /** Observe only the actual SDK receiver's terminal native failure. */
  let failure: unknown
  /** Removing the public subscription must remain valid after termination. */
  const off = resource.subscribe({
    frame: () => undefined,
    error: () => undefined,
    close: (error) => {
      failure = error
    }
  })
  try {
    owner.dispatchEvent(event)
    await expect(resource.write({ kind: RpcCarrierFrameKind.message, data: 'late' })).rejects.toBe(
      failure
    )
    expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
    expect(walkErrorCauses(failure)).toContain(original)
  } finally {
    off()
    await resource.close()
  }
})
