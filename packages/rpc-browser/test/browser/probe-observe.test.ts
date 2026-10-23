import { describe, expect, it } from 'vitest'
import { connect, createFullOneWayEndpoint } from '@migaia/rpc-core'
import type { IRpcCarrierProbe } from '@migaia/rpc-core/probe'
import type { IRpcTransport } from '@migaia/rpc-core/transport-kit'
import { createWindowMessageTransport } from '../../src/browser/adapters/window.js'
import { createSharedWorkerTransport } from '../../src/browser/adapters/shared-worker.js'
import { createServiceWorkerTransport } from '../../src/browser/adapters/service-worker.js'
import { createBroadcastChannelTransport } from '../../src/browser/adapters/broadcast-channel.js'
import { createRtcDataChannelTransport } from '../../src/browser/adapters/rtc-data-channel.js'
import { createWebTransportDatagramTransport } from '../../src/browser/adapters/web-transport.js'

/** Each fixture names one public browser carrier, independently of probe-core. */
const carriers = [
  'window',
  'shared-worker',
  'service-worker',
  'broadcast-channel',
  'rtc-data-channel',
  'web-transport'
] as const
/** The oracle retains metadata immediately because production detail is reused. */
type IEvent = {
  direction: number
  size: number
  carrier: string
  detail: Readonly<Record<string, string | number | boolean>> | undefined
  content: unknown
}
/** Native event-shaped harness keeps transfer semantics and source identity observable. */
type IFixture = {
  transport: IRpcTransport<unknown, Transferable>
  message: unknown
  source: object
  /** Inject a physical receive with explicit source and origin for admission assertions. */
  deliver(data: unknown, source?: unknown, origin?: string): void
  /** Release adapter-owned resources while leaving borrowed native fixture ownership unchanged. */
  close(): Promise<void>
  /** Inject RTC terminal closure through the registered native callback. */
  fail(): void
}

/** Builds a physical loopback for one exported factory without constructing an Endpoint. */
function fixture(carrier: (typeof carriers)[number], detach = false): IFixture {
  /** Registered native callbacks belong to the adapter under test. */
  const callbacks = new Map<string, Set<(event: unknown) => void>>()
  /** The configured peer identity supplies valid sourceProof input. */
  const source = {
    id: 'client',
    readyState: 'open',
    /** Retain exact callback identity under its native event name for later fixture delivery. */
    addEventListener<T>(type: string, callback: (event: T) => void) {
      if (!callbacks.has(type)) callbacks.set(type, new Set())
      callbacks.get(type)!.add(callback as (event: unknown) => void)
    },
    /** Remove only the adapter callback belonging to this native event registration. */
    removeEventListener<T>(type: string, callback: (event: T) => void) {
      callbacks.get(type)?.delete(callback as (event: unknown) => void)
    },
    /** Model both Window and port argument shapes, including real native transfer detachment. */
    postMessage(
      message: unknown,
      originOrTransfer?: unknown,
      windowTransfer?: readonly Transferable[]
    ) {
      /** This fixture models native structured-clone wire delivery and real detachment. */
      const transfer =
        typeof originOrTransfer === 'string'
          ? windowTransfer
          : (originOrTransfer as readonly Transferable[] | undefined)
      deliver(
        detach
          ? structuredClone(message, { transfer: transfer as Transferable[] | undefined })
          : message
      )
    },
    /** RTC sends deliver their physical string without introducing a second encoding boundary. */
    send(message: string) {
      deliver(message)
    }
  }
  /** Readable ownership is used only by the datagram carrier. */
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  /** Dispatch one native event to each registered browser reader. */
  function deliver(data: unknown, peer: unknown = source, origin = 'https://peer.test'): void {
    if (carrier === 'web-transport') {
      controller!.enqueue(data as Uint8Array)
      return
    }
    /** Every native message reader receives the same physical event fields. */
    for (const callback of callbacks.get('message') ?? []) callback({ data, source: peer, origin })
  }
  /** The switch keeps each public adapter constructor explicit in the coverage oracle. */
  let transport: IRpcTransport<unknown, Transferable>
  switch (carrier) {
    case 'window':
      transport = createWindowMessageTransport({
        target: source,
        receiver: source,
        targetOrigin: 'https://peer.test'
      })
      break
    case 'shared-worker':
      transport = createSharedWorkerTransport(source)
      break
    case 'service-worker':
      transport = createServiceWorkerTransport({ target: source, receiver: source })
      break
    case 'broadcast-channel':
      transport = createBroadcastChannelTransport(source as unknown as BroadcastChannel)
      break
    case 'rtc-data-channel':
      transport = createRtcDataChannelTransport(source)
      break
    case 'web-transport':
      transport = createWebTransportDatagramTransport({
        readable: new ReadableStream<Uint8Array>({
          /** Save the actual stream ingress owner so fixture delivery exercises adapter reading. */
          start(value) {
            controller = value
          }
        }),
        writable: new WritableStream<Uint8Array>({
          /** Reflect native datagram writes through the same readable ownership boundary. */
          write(message) {
            deliver(message)
          }
        })
      }) as IRpcTransport<unknown, Transferable>
      break
  }
  return {
    transport,
    source,
    message: carrier === 'rtc-data-channel' ? 'payload-😀' : new Uint8Array([1, 2, 3]),
    deliver,
    /** Join the adapter's existing close result without closing borrowed native owners. */
    async close() {
      await transport.close?.()
    },
    /** Retire RTC through native terminal callbacks so its observation slot is released. */
    fail() {
      for (const callback of callbacks.get('close') ?? []) callback({})
    }
  }
}

/** Captures synchronous probe fields, keeping content by identity. */
function probe(events: IEvent[], capturing = false): IRpcCarrierProbe {
  return {
    capturing,
    /** Snapshot reused detail for assertions while retaining the observed content reference. */
    emit(direction, size, carrier, detail, content) {
      events.push({ direction, size, carrier, detail: detail && { ...detail }, content })
    }
  }
}

describe('carriers: browser observe', () => {
  /** Each public carrier runs the same physical metadata, capture, failure and disposer contracts. */
  for (const carrier of carriers) {
    it(`${carrier}: one physical send and receive reuse detail, with metadata only`, async () => {
      /** The fake transport also establishes source-admitted business delivery. */
      const native = fixture(carrier)
      /** All business deliveries retain the adapter's existing source boundary. */
      const received: unknown[] = []
      native.transport.subscribe((message) => {
        if (
          !native.transport.sourceProof ||
          native.transport.sourceProof(message.source, message.origin)
        )
          received.push(message.data)
      })
      /** Observations store copied assertions while tracking original detail identity separately. */
      const events: IEvent[] = []
      /** The stable detail slot must be shared across successive physical events. */
      const details: unknown[] = []
      native.transport.observe!({
        capturing: false,
        /** Track the original detail identity separately from the immediately retained fields. */
        emit(direction, size, name, detail, content) {
          details.push(detail)
          events.push({ direction, size, carrier: name, detail: detail && { ...detail }, content })
        }
      })
      await native.transport.send(native.message)
      await Promise.resolve()
      expect(received).toEqual([native.message])
      expect(events).toHaveLength(2)
      expect(events.map((event) => event.direction).sort()).toEqual([0, 1])
      /** Each retained observation proves the physical carrier fields and metadata-only capture. */
      for (const event of events) {
        expect(event.carrier).toBe(carrier)
        expect(event.size === -1 || event.size >= 0).toBe(true)
        expect(event.content).toBeUndefined()
        expect(Object.keys(event.detail!).sort()).toEqual(['origin', 'rejectedSource', 'transfers'])
      }
      expect(details[0]).toBe(details[1])
      await native.close()
    })

    it(`${carrier}: capture retains untransferred content references`, async () => {
      /** This message crosses no detaching transfer boundary. */
      const native = fixture(carrier)
      /** Physical receive registration activates the carrier reader. */
      native.transport.subscribe(() => undefined)
      /** Capture must preserve identity at both observation points. */
      const events: IEvent[] = []
      native.transport.observe!(probe(events, true))
      await native.transport.send(native.message)
      await Promise.resolve()
      expect(events).toHaveLength(2)
      expect(events.every((event) => event.content === native.message)).toBe(true)
      await native.close()
    })

    it(`${carrier}: probe failure keeps business delivery and original cause`, async () => {
      /** Native callbacks exercise the carrier's existing error reporters. */
      const native = fixture(carrier)
      /** One registered reporter in each channel sees its own carrier failure. */
      const failures: unknown[] = []
      /** Observation failures cannot enter the physical-error channel that rejects pending RPC. */
      const physicalFailures: unknown[] = []
      native.transport.onTransportError?.((error) => physicalFailures.push(error))
      native.transport.onListenerError?.((error) => failures.push(error))
      /** This original exception must stay reachable by exact identity. */
      const failure = new Error('probe failed')
      /** Business delivery continues across both outbound and inbound probe failures. */
      const received: unknown[] = []
      native.transport.subscribe((message) => received.push(message.data))
      native.transport.observe!({
        capturing: false,
        /** Inject one exact observer exception at both physical send and receive boundaries. */
        emit() {
          throw failure
        }
      })
      await native.transport.send(native.message)
      await Promise.resolve()
      expect(received).toEqual([native.message])
      expect(failures).toHaveLength(2)
      expect(physicalFailures).toEqual([])
      /** Each reported wrapper must retain the same original probe exception as its cause. */
      for (const error of failures)
        expect(error).toMatchObject({
          source: 'rpc.endpoint',
          code: 'TRANSPORT',
          cause: failure
        })
      await native.close()
    })

    it(`${carrier}: replacement and idempotent old disposers protect the same probe`, async () => {
      /** Generation identity must differ even when the public probe object is reused. */
      const native = fixture(carrier)
      native.transport.subscribe(() => undefined)
      /** Both installations deliberately use the identical public probe handle. */
      const events: IEvent[] = []
      /** One handle is reused to distinguish generation ownership from probe-object identity. */
      const observer = probe(events)
      /** The first generation's disposer must become inert when the same handle is reinstalled. */
      const old = native.transport.observe!(observer)
      /** The successor disposer alone may release the currently installed registration. */
      const current = native.transport.observe!(observer)
      old()
      old()
      await native.transport.send(native.message)
      await Promise.resolve()
      expect(events).toHaveLength(2)
      current()
      current()
      await native.transport.send(native.message)
      await Promise.resolve()
      expect(events).toHaveLength(2)
      await native.close()
    })
  }

  /** Only these three browser factories accept a caller-owned native transfer list. */
  for (const carrier of ['window', 'shared-worker', 'service-worker'] as const) {
    it(`${carrier}: observe reads the native transfer list once and preserves getter failure identity`, async () => {
      /** Native structuredClone exposes whether observation forwards the exact transfer decision. */
      const native = fixture(carrier, true)
      native.transport.subscribe(() => undefined)
      /** A capturing fake probe must see the same bytes the platform actually transfers. */
      const events: IEvent[] = []
      native.transport.observe!(probe(events, true))
      /** This supported accessor changes its answer if a caller reads it more than once. */
      let reads = 0
      /** The payload owns the exact backing that native transfer must detach. */
      const bytes = new Uint8Array([4, 5, 6])
      /** The first read supplies the actual native transfer list. */
      const transfer: readonly Transferable[] = [bytes.buffer]
      await native.transport.send(bytes, {
        /** A second accessor evaluation deliberately changes native detachment behavior. */
        get transfer() {
          return ++reads === 1 ? transfer : []
        }
      })
      expect(reads).toBe(1)
      expect(bytes.byteLength).toBe(0)
      expect(
        Array.from(events.find((event) => event.direction === 0)!.content as Uint8Array)
      ).toEqual([4, 5, 6])
      /** Options getter failure belongs to the existing business call rather than observation. */
      const failure = new Error('transfer getter failed')
      /** The exact error identity is retained without reporting or emitting a failed send. */
      let caught: unknown
      try {
        native.transport.send(new Uint8Array([7]), {
          /** Original option evaluation failures must escape by exact business error identity. */
          get transfer(): readonly Transferable[] {
            throw failure
          }
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBe(failure)
      expect(events).toHaveLength(2)
      await native.close()
    })

    it(`${carrier}: transfer capture preserves bytes before native detachment`, async () => {
      /** Native structuredClone applies the real platform transfer semantics. */
      const native = fixture(carrier, true)
      native.transport.subscribe(() => undefined)
      /** Captured send content outlives the original detached buffer. */
      const events: IEvent[] = []
      native.transport.observe!(probe(events, true))
      /** Byte content is eligible for byte preservation only because its buffer is transferred. */
      const bytes = new Uint8Array([4, 5, 6])
      await native.transport.send(bytes, { transfer: [bytes.buffer] })
      expect(bytes.byteLength).toBe(0)
      /** The outbound entry is independent of synchronous fake receive ordering. */
      const outbound = events.find((event) => event.direction === 0)!
      expect(Array.from(outbound.content as Uint8Array)).toEqual([4, 5, 6])
      expect(outbound.detail?.transfers).toBe(1)
      expect(outbound.size).toBe(3)
      await native.close()
    })
  }

  /** These multiplexed carriers enforce explicit source proof before observation. */
  for (const carrier of ['window', 'service-worker'] as const) {
    it(`${carrier}: rejected sources are absent from capture and counted on the next valid receive`, async () => {
      /** Source filtering remains owned by the adapter's exact existing proof. */
      const native = fixture(carrier)
      /** Business accepts only physically proved messages, matching connect/projectBrowserPeerPort. */
      const received: unknown[] = []
      native.transport.subscribe((message) => {
        if (native.transport.sourceProof!(message.source, message.origin))
          received.push(message.data)
      })
      /** Rejected payload content never reaches the observation API. */
      const events: IEvent[] = []
      native.transport.observe!(probe(events, true))
      native.deliver('spoof', { id: 'other-client' })
      native.deliver('valid')
      native.deliver('later')
      expect(received).toEqual(['valid', 'later'])
      expect(events).toHaveLength(2)
      expect(events[0]?.detail?.rejectedSource).toBe(1)
      expect(events[1]?.detail?.rejectedSource).toBe(0)
      expect(events[0]?.content).toBe('valid')
      await native.close()
    })
  }

  it('RTC terminal and WebTransport close release the probe', async () => {
    /** Terminal events own RTC retirement rather than borrowed physical close. */
    const rtc = fixture('rtc-data-channel')
    rtc.transport.subscribe(() => undefined)
    /** Getter reads make post-close capture access observable. */
    let reads = 0
    rtc.transport.observe!({
      /** Count content-policy access so a retired registration cannot perform hidden work. */
      get capturing() {
        reads++
        return false
      },
      /** Capture-policy access alone measures retained observation; emission needs no fixture work. */
      emit() {}
    })
    rtc.fail()
    rtc.transport.observe!({
      /** A post-terminal installation must remain inert without reading capture policy. */
      get capturing() {
        reads++
        return false
      },
      /** Capture-policy access alone measures retained observation; emission needs no fixture work. */
      emit() {}
    })
    expect(() => rtc.transport.send('closed')).toThrow('closed')
    expect(reads).toBe(0)
    /** Explicit WebTransport close retires its observation slot and read ownership. */
    const datagram = fixture('web-transport')
    datagram.transport.observe!({
      /** Closing the read/write owner must also prevent any later capture-policy access. */
      get capturing() {
        reads++
        return false
      },
      /** Capture-policy access alone measures retained observation; emission needs no fixture work. */
      emit() {}
    })
    await datagram.close()
    expect(() => datagram.transport.send(new Uint8Array())).toThrow('closed')
    expect(reads).toBe(0)
  })

  it('window: nested transferred members retain the original container reference and may detach', async () => {
    /** This native-supported payload follows the closure ruling against deep transfer scans. */
    const native = fixture('window', true)
    native.transport.subscribe(() => undefined)
    /** Retaining content reveals native detachment after the synchronous probe returns. */
    const events: IEvent[] = []
    native.transport.observe!(probe(events, true))
    /**
     * Only the byte buffer detaches; unrelated payload must keep its identity under the
     * reference-retention rule.
     */
    const untouched = { value: 'reference-only' }
    /** The byte descendant is supported by native postMessage's structured-clone boundary. */
    const bytes = new Uint8Array([4, 5, 6])
    /** The original container is retained without a selective clone. */
    const payload = { bytes, untouched }
    await native.transport.send(payload, { transfer: [bytes.buffer] })
    expect(bytes.byteLength).toBe(0)
    /**
     * Only directly captured transferables are preserved; nested members remain borrowed
     * references.
     */
    const content = events.find((event) => event.direction === 0)!.content as {
      bytes: Uint8Array
      untouched: typeof untouched
    }
    expect(content.untouched).toBe(untouched)
    expect(content).toBe(payload)
    expect(content.bytes).toBe(bytes)
    expect(content.bytes.byteLength).toBe(0)
    await native.close()
  })

  it('SharedWorker: throwing probes preserve a real Endpoint request and response', async () => {
    /** Each physical endpoint has the same event registration seam as a native SharedWorker port. */
    const callbacks = [
      new Set<(event: MessageEvent<unknown> | Event) => void>(),
      new Set<(event: MessageEvent<unknown> | Event) => void>()
    ]
    /** Cross-wired physical ports preserve the asynchronous native delivery boundary. */
    const ports = [0, 1].map((side) => ({
      /** Queue native message delivery on the opposite port rather than bypass Endpoint activation. */
      postMessage(data: unknown) {
        /** The next microtask models native I/O after the client's pending request is registered. */
        queueMicrotask(() => {
          for (const callback of callbacks[1 - side]!) callback({ data } as MessageEvent)
        })
      },
      /** Retain only message readers; this fixture has no physical terminal failures. */
      addEventListener(type: string, callback: (event: MessageEvent<unknown> | Event) => void) {
        if (type === 'message') callbacks[side]!.add(callback)
      },
      /** Remove the exact callback when Endpoint disposal retires its native subscription. */
      removeEventListener(type: string, callback: (event: MessageEvent<unknown> | Event) => void) {
        if (type === 'message') callbacks[side]!.delete(callback)
      }
    }))
    /** The client observer executes inside the same transport used by Endpoint activation. */
    const clientWire = createSharedWorkerTransport(ports[0]!)
    /** Server business responses use the other public browser transport factory. */
    const serverWire = createSharedWorkerTransport(ports[1]!)
    /** Endpoint dispatch and settlement make failAll regressions observable. */
    const server = await createFullOneWayEndpoint({
      id: 'server',
      transport: serverWire,
      middlewares: [connect({ transport: serverWire })]
    })
    /** Echo returns an ordinary business result independent of carrier diagnostics. */
    server.provide('echo', (context) => context.success(context.data))
    /** Real request creation registers its pending result before transport send. */
    const client = await createFullOneWayEndpoint({
      id: 'client',
      transport: clientWire,
      middlewares: [connect({ transport: clientWire })]
    })
    /** The exact exception must remain reachable through reports while the request succeeds. */
    const failure = new Error('endpoint probe failed')
    /** Listener reports are observable without treating them as physical retirement. */
    const reported: unknown[] = []
    clientWire.onListenerError!((error) => reported.push(error))
    clientWire.observe!({
      capturing: false,
      /** Fail observation without granting that diagnostic any physical retirement authority. */
      emit() {
        throw failure
      }
    })
    try {
      await expect(client.send<string>('server', 'echo', 'business-value')).resolves.toBe(
        'business-value'
      )
      expect(reported.length).toBeGreaterThanOrEqual(2)
      expect(reported.every((error) => (error as Error).cause === failure)).toBe(true)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
