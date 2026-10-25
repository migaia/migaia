import { EventEmitter } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  defineProbe,
  createProbeEmitter,
  RpcProbeStage,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import type {
  IRpcCarrier,
  IRpcCarrierObservationEvent,
  IRpcCarrierFrame
} from '@migaia/rpc-contract/interfaces'
import { createNodeThreadCarrier, createWebThreadCarrier } from '../../dist/threads/channel.js'
import { createWebThreadChannelFactory } from '../../dist/threads/web-launcher.js'
import { createNodeThreadChannelFactory } from '../../dist/threads/node-launcher.js'
import type { IThreadWebPort } from '../../dist/threads/types.js'

/** Original Node fixture supplies raw native delivery and transfer, never RPC admission. */
function nodePort() {
  /** Native clone semantics are the only transformation performed by this test resource. */
  const port = Object.assign(new EventEmitter(), {
    postMessage(message: unknown, transfer?: readonly unknown[]) {
      /** Retain the original physical clone before its queued native receive callback. */
      const data = structuredClone(message, { transfer: transfer as Transferable[] | undefined })
      queueMicrotask(() => port.emit('message', data))
    }
  })
  return port
}

/** The same original EventTarget fixture owns native callback identity and physical clone. */
class WebPortFixture {
  /** Only this native resource owns these EventTarget registrations. */
  readonly #events = new EventTarget()
  /** A borrowed port contributes no protocol, codec or accepted peer state. */
  readonly value: IThreadWebPort = {
    postMessage: (message, transfer) => this.#post(message, transfer),
    addEventListener: (type, listener) => this.#events.addEventListener(type, listener),
    removeEventListener: (type, listener) => this.#events.removeEventListener(type, listener)
  }
  /** Preserve physical detachment before scheduling the original native message event. */
  #post(message: unknown, transfer?: readonly unknown[]): void {
    /** Clone output belongs to the actual native event and remains independent of captured data. */
    const data = structuredClone(message, { transfer: transfer as Transferable[] | undefined })
    queueMicrotask(() => this.#events.dispatchEvent(new MessageEvent('message', { data })))
  }
}

/** Custom launcher handles retain only native port, identity and execution receipts. */
function handle<T>(port: T) {
  return {
    port,
    identity: { fingerprint: 'probe-fixture' },
    exited: new Promise<never>(() => undefined),
    terminate() {}
  }
}

/** Each original acquisition variant reaches its canonical native IO owner. */
const cases: readonly [
  string,
  (report: (error: unknown) => void) => IRpcCarrier | Promise<IRpcCarrier>
][] = [
  ['node channel', (report) => createNodeThreadCarrier(nodePort(), 'peer', report)],
  ['web channel', (report) => createWebThreadCarrier(new WebPortFixture().value, 'peer', report)],
  // BC3 removes the separate parent-channel wrapper; real parent uses this same Node native owner.
  ['parent channel', (report) => createNodeThreadCarrier(nodePort(), 'peer', report)],
  [
    'node factory',
    (report) =>
      createNodeThreadChannelFactory({ scheduler: systemScheduler, report }).open(
        handle(nodePort()),
        new AbortController().signal
      )
  ],
  [
    'web factory',
    (report) =>
      createWebThreadChannelFactory({ scheduler: systemScheduler, report }).open(
        handle(new WebPortFixture().value),
        new AbortController().signal
      )
  ]
]

/** One original probe record snapshots the reused public view at its synchronous delivery boundary. */
type IEvent = Readonly<{
  direction: number
  size: number
  detail: IRpcProbeEventView['detail']
  content: unknown
  beforeTransfer?: readonly number[]
}>

/** Canonical public emitter owns capture; this test supplies only actual native observation events. */
class ThreadProbeCapture {
  /** Captured observations belong only to this case and never drive physical delivery. */
  readonly events: IEvent[] = []
  /** The real emitter retains its own mask, capture policy and error isolation. */
  readonly #emitter
  /** Install the public capture policy once without inventing a transport observation facade. */
  constructor(report: (error: unknown) => void) {
    this.#emitter = createProbeEmitter(
      [defineProbe({ stages: ['carrier'], capture: ['carrier'], emit: this.#observe })],
      () => systemScheduler.now(),
      'thread-native-probe',
      report
    )
  }
  /** Forward the actual native record unchanged into the published probe event contract. */
  readonly receive = (event: IRpcCarrierObservationEvent): void => {
    this.#emitter.emit({ ...event, stage: RpcProbeStage.carrier })
  }
  /** BC2 frames are containers; inspect fixture-owned bytes before the actual transfer detaches. */
  readonly #observe = (view: IRpcProbeEventView): void => {
    /** This finite fixture payload is the actual carrier frame, not a reconstructed business root. */
    const data = (view.content as IRpcCarrierFrame).data
    this.events.push({
      direction: view.direction,
      size: view.sizeBytes,
      detail: view.detail && { ...view.detail },
      content: view.content,
      beforeTransfer:
        data instanceof ArrayBuffer
          ? Array.from(new Uint8Array(data))
          : data instanceof Uint8Array
            ? Array.from(data)
            : undefined
    })
  }
  /** Release the one emitter's original subscriptions after its native resource retires. */
  close(): void {
    this.#emitter.dispose()
  }
}

describe('Thread channels inherit canonical physical observation', () => {
  it.each(cases)(
    '%s retains capture, error isolation, replacement and close',
    async (_name, open) => {
      /** The actual native owner reports observer errors outside physical delivery. */
      const errors = vi.fn()
      /** Native acquisition creates the same canonical carrier used by ordinary Session attachment. */
      const carrier = await open(errors)
      /** Public capture uses the real emitter rather than a replacement capture implementation. */
      const capture = new ThreadProbeCapture(errors)
      /** An older remover must not retire the replacement observation subscription. */
      const stale = carrier.observation!.subscribe(capture.receive)
      /** Only the current native subscription owns observation removal. */
      const dispose = carrier.observation!.subscribe(capture.receive)
      await stale()
      await stale()
      /** Business delivery is counted independently from observer callbacks. */
      const receive = vi.fn()
      /**
       * The canonical receiver observes the actual native frame without decoding or synthesizing
       * it.
       */
      const remove = carrier.subscribe({ frame: receive, close: () => undefined, error: errors })
      try {
        /** The existing transferred bytes occupy a canonical carrier container under BC2. */
        const bytes = new Uint8Array([4, 6, 8])
        /** This exact physical frame is borrowed by the observer and the native sender. */
        const frame: IRpcCarrierFrame = { kind: 'message', data: bytes }
        await carrier.write(frame, { transfer: [bytes.buffer] })
        expect(bytes.byteLength).toBe(0)
        // Frame-container size replaces retired raw-byte size; original native transfer detail remains.
        expect
          .soft(capture.events.map((event) => [event.direction, event.size, event.detail]))
          .toEqual([
            [0, -1, { transfers: 1 }],
            [1, -1, { transfers: -1 }]
          ])
        expect(capture.events[0]!.beforeTransfer).toEqual([4, 6, 8])
        expect(capture.events[0]!.content).toBe(frame)
        expect(receive).toHaveBeenCalledTimes(1)
        await dispose()
        await dispose()
        await carrier.write({ kind: 'message', data: 8 })
        expect(capture.events).toHaveLength(2)
        /** Original callback failure must remain reachable without preventing native delivery. */
        const cause = new TypeError('thread probe failure')
        carrier.observation!.subscribe(() => {
          throw cause
        })
        await carrier.write({ kind: 'message', data: 9 })
        expect(receive).toHaveBeenCalledTimes(3)
        expect(errors).toHaveBeenCalledTimes(2)
        for (const [error] of errors.mock.calls)
          expect.soft(error).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT', cause })
        carrier.observation!.subscribe(capture.receive)
        await remove()
        await carrier.close()
        carrier.observation!.subscribe(capture.receive)
        try {
          await carrier.write({ kind: 'message', data: 7 })
        } catch (error) {
          expect.soft(error).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
        }
        expect(capture.events).toHaveLength(2)
      } finally {
        await carrier.close()
        capture.close()
      }
    }
  )

  it('real Node worker port transfers through the final exported channel', async () => {
    /** Real MessagePorts independently prove delivery and native backing detachment. */
    const ports = new MessageChannel()
    /** The same native sender supplies the real probe capability. */
    const left = createNodeThreadCarrier(ports.port1, 'right', () => undefined)
    /** Physical receive uses the exact opposite native port rather than captured bytes. */
    const right = createNodeThreadCarrier(ports.port2, 'left', () => undefined)
    /** The real public emitter captures only the sender's synchronous native observation. */
    const capture = new ThreadProbeCapture(() => undefined)
    left.observation!.subscribe(capture.receive)
    /** The original receive Promise settles only at actual native delivery. */
    const received = new Promise<IRpcCarrierFrame>((resolve) =>
      right.subscribe({
        frame: resolve,
        close: () => undefined,
        error: () => undefined
      })
    )
    try {
      /** The canonical frame retains the original explicit native backing. */
      const buffer = new Uint8Array([7, 9]).buffer
      await left.write({ kind: 'message', data: buffer }, { transfer: [buffer] })
      expect(buffer.byteLength).toBe(0)
      expect(capture.events[0]!.beforeTransfer).toEqual([7, 9])
      expect(Array.from(new Uint8Array((await received).data as ArrayBuffer))).toEqual([7, 9])
    } finally {
      await left.close()
      await right.close()
      capture.close()
      ports.port1.close()
      ports.port2.close()
    }
  })
})
