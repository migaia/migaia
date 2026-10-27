import { randomUUID } from 'node:crypto'
import { setImmediate as deferNativeMessage } from 'node:timers'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineProbe, probe, type IRpcProbeEventView } from '@migaia/rpc-host/plugins/probe'
import type { IRpcTransportPlugin } from '@migaia/rpc-host/sdk'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'
import { RpcCarrierPlatform, type IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import {
  windowPlugin,
  sharedWorkerPlugin,
  serviceWorkerPlugin,
  broadcastChannelPlugin,
  rtcDataChannelPlugin
} from '../../dist/index.js'
import { createWindowCarrier } from '../../dist/browser/adapters/window.js'
import { createServiceWorkerCarrier } from '../../dist/browser/adapters/service-worker.js'
import { createRtcDataChannelCarrier } from '../../dist/browser/adapters/rtc-data-channel.js'
import { messageTarget, windowPair, portPair, rtcChannel } from './message-fixture.js'

/** Original native variants still exercise the same actual public factories. */
const carriers = [
  'window',
  'shared-worker',
  'service-worker',
  'broadcast-channel',
  'rtc-data-channel'
] as const
/** Canonical native facts replace only the retired private observer's lower-case aliases. */
const platforms = [
  RpcCarrierPlatform.iframe,
  RpcCarrierPlatform.worker,
  RpcCarrierPlatform.worker,
  RpcCarrierPlatform.broadcastChannel,
  RpcCarrierPlatform.rtcDataChannel
] as const
/** Native collector records a borrowed frame without projecting a business payload into it. */
type IEvent = Readonly<{
  direction: number
  size: number
  carrier: string | undefined
  detail: IRpcProbeEventView['detail']
  content: unknown
  /** A test sink may inspect actual native sidecars synchronously before the platform detaches. */
  beforeTransfer?: readonly number[]
}>
/** The actual public option retains its native getter semantics rather than an adapter alias. */
type ITransfer = Readonly<{ transfer?: readonly ArrayBuffer[] }>
/** These are exactly the original supported payloads used by this finite native oracle family. */
type IProbeValue = string | Uint8Array | { bytes: Uint8Array; untouched: { value: string } }
/**
 * Both supported deterministic hello roles are explicit diagnostic inputs, never a default
 * workaround.
 */
type IRoleOrder = 'client-first' | 'server-first'

/** One existing native pair lends its real raw references to actual Host/probe installations. */
class BrowserProbeFixture {
  /** Original case selection controls native acquisition only, never semantic routing. */
  readonly #carrier: (typeof carriers)[number]
  /**
   * Optional role selection isolates the observed random-identity failure without changing old
   * cases.
   */
  readonly #order: IRoleOrder | undefined
  /** A genuine mutable probe handle controls the installed cold observer. */
  readonly #probe
  /**
   * The actual readonly collector preserves original raw references and snapshots reused view
   * fields.
   */
  readonly events: IEvent[] = []
  /**
   * Original metadata values are snapshotted separately from the native owner's reused detail
   * identity.
   */
  readonly details: IRpcProbeEventView['detail'][] = []
  /** Exact native post/send parameters are independent of the production observer's content. */
  readonly outgoing: unknown[] = []
  /** Exact native event.data values independently identify accepted receive references. */
  readonly incoming: unknown[] = []
  /** Real Host report delivery retains original callback failure causes. */
  readonly reports: unknown[] = []
  /**
   * A throwing sink is enabled only after real startup, so original per-operation counts remain
   * exact.
   */
  #failure: Error | undefined
  /** Actual public namespace invocation is borrowed after both real hosts complete their handshake. */
  #request: ((value: IProbeValue, options?: ITransfer) => Promise<unknown>) | undefined
  /** Exact Host and native listener receipts release only this fixture's acquired resources. */
  readonly #close: Array<() => void | Promise<void>> = []
  /**
   * Test-only raw listeners start after production acquisition so they cannot consume cold queued
   * hello.
   */
  readonly #afterReady: Array<() => void> = []

  /** Capture policy is a real cold probe definition, not a fabricated carrier capturing getter. */
  constructor(carrier: (typeof carriers)[number], capture = false, order?: IRoleOrder) {
    this.#carrier = carrier
    this.#order = order
    this.#probe = defineProbe({
      stages: ['carrier'],
      capture: capture ? ['carrier'] : [],
      emit: this.#observe
    })
  }
  /** Actual native factories are installed concurrently on two genuine public Host instances. */
  async open(): Promise<this> {
    /** Native acquisition supplies no handshake, codec, provider or accepted Session model. */
    const plugins = this.#carrier === 'broadcast-channel' ? this.#broadcast() : this.#messages()
    /** Unique fixed prefixes select the two legal roles while preserving native pair isolation. */
    const suffix = randomUUID()
    /** Both original business directions share the same actual public provider declaration. */
    const peers = await Promise.all([
      createRpcHost({
        ...(this.#order && {
          self: {
            name: 'probe-client',
            instanceId: `${this.#order === 'client-first' ? 'a' : 'z'}-${suffix}`
          }
        }),
        plugins: [probe(this.#probe), plugins[0]],
        report: (error) => this.reports.push(error)
      }),
      createRpcHost({
        ...(this.#order && {
          self: {
            name: 'probe-server',
            instanceId: `${this.#order === 'client-first' ? 'z' : 'a'}-${suffix}`
          }
        }),
        plugins: [plugins[1]],
        provide: { echo: (value: unknown) => value },
        report: (error) => this.reports.push(error)
      })
    ])
    this.#close.unshift(...peers.map((host) => () => host.close()))
    for (const start of this.#afterReady) start()
    await vi.waitFor(() => {
      for (const host of peers) expect(Object.keys(host.browser.peers)).toHaveLength(1)
    })
    this.#request = (value, options) => peers[0].browser.request('echo', value, options)
    /** A real completed request ends setup; no fake queue flush or observer drain is introduced. */
    await this.request('native-probe-ready')
    this.clear()
    return this
  }
  /** Retain only the actual operation's observations after the normal setup request completes. */
  clear(): void {
    this.events.length = 0
    this.details.length = 0
    this.outgoing.length = 0
    this.incoming.length = 0
    this.reports.length = 0
  }
  /** The original failure object is thrown by the real probe sink, outside business dispatch. */
  fail(error: Error): void {
    this.#failure = error
  }
  /** Drive the actual namespace and its normal option/getter/transfer admission. */
  request(value: IProbeValue, options?: ITransfer): Promise<unknown> {
    return this.#request!(value, options)
  }
  /** Join existing actual Host closes before releasing borrowed native test channels. */
  async close(): Promise<void> {
    for (const close of this.#close) await close()
  }
  /** Reused event views are copied only by this test sink; raw physical content is never rebuilt. */
  readonly #observe = (view: IRpcProbeEventView): void => {
    if (this.#failure) throw this.#failure
    this.details.push(view.detail)
    /** The new message shell is actual wire data, not the caller's pre-codec application root. */
    const sidecar = (view.content as { sidecars?: readonly ArrayBuffer[] } | undefined)
      ?.sidecars?.[0]
    this.events.push({
      direction: view.direction,
      size: view.sizeBytes,
      carrier: view.carrier,
      detail: view.detail && { ...view.detail },
      content: view.content,
      beforeTransfer: sidecar && Array.from(new Uint8Array(sidecar))
    })
  }
  /**
   * Real BroadcastChannel does not deliver its own sends; two actual native objects supply both
   * directions.
   */
  #broadcast(): [IRpcTransportPlugin<'browser'>, IRpcTransportPlugin<'browser'>] {
    /** Native name is unique to this original case's resources. */
    const name = randomUUID()
    /** These are genuine platform channels, not a discovery or self-loop model. */
    const channels = [new BroadcastChannel(name), new BroadcastChannel(name)] as const
    /** Exact builtin receiver semantics require Reflect.apply for the captured native method. */
    const post = channels[0].postMessage
    channels[0].postMessage = (value) => {
      this.outgoing.push(value)
      Reflect.apply(post, channels[0], [value])
    }
    /** The independent native listener records the original event payload by reference. */
    const receive = (event: MessageEvent<unknown>) => this.incoming.push(event.data)
    this.#afterReady.push(() => channels[0].addEventListener('message', receive))
    this.#close.push(
      () => channels[0].removeEventListener('message', receive),
      () => channels[0].close(),
      () => channels[1].close()
    )
    return [
      broadcastChannelPlugin({ namespace: 'browser', channel: channels[0] }),
      broadcastChannelPlugin({ namespace: 'browser', channel: channels[1] })
    ]
  }
  /**
   * Reuse the original native-only port fixtures; actual factories own every codec and source
   * filter.
   */
  #messages(): [IRpcTransportPlugin<'browser'>, IRpcTransportPlugin<'browser'>] {
    /** Original fake realms retain native source identity; ports retain native ordered delivery. */
    const pair = this.#carrier === 'window' ? windowPair() : portPair()
    if (this.#carrier === 'window') {
      /** Real postMessage delivery is a task, after the cold setup microtasks install both readers. */
      for (const native of [pair.left, pair.right]) {
        /** Preserve the original native source/origin implementation and its exact frame argument. */
        const send = native.target.postMessage
        native.target.postMessage = (data, options) => {
          deferNativeMessage(() => send(data, options))
        }
      }
    }
    /** A Client source is a native event fact; it is never inferred from an RPC frame. */
    if (this.#carrier === 'service-worker') {
      pair.left.setSend((data) =>
        queueMicrotask(() => pair.right.emit('message', structuredClone(data), pair.right.target))
      )
      pair.right.setSend((data) =>
        queueMicrotask(() => pair.left.emit('message', structuredClone(data), pair.left.target))
      )
    }
    /** The actual client outgoing target differs from its receiver only for Window. */
    const target = this.#carrier === 'window' ? pair.right.target : pair.left.target
    /** The original fixture's stable arrow does not need a mutable receiver helper. */
    const post = target.postMessage
    target.postMessage = (value, originOrTransfer, windowTransfer?: readonly Transferable[]) => {
      this.outgoing.push(value)
      /** Native structuredClone applies the supplied transfer at the actual test platform boundary. */
      const transfer = typeof originOrTransfer === 'string' ? windowTransfer : originOrTransfer
      post(
        transfer?.length ? structuredClone(value, { transfer: [...transfer] }) : value,
        originOrTransfer
      )
    }
    /**
     * Observe native data independently of the production collector; these events have plain
     * fields.
     */
    const receive = (event: MessageEvent<unknown>) => this.incoming.push(event.data)
    this.#afterReady.push(() => pair.left.target.addEventListener('message', receive))
    this.#close.push(() => pair.left.target.removeEventListener('message', receive))
    if (this.#carrier === 'window')
      return [
        windowPlugin({
          namespace: 'browser',
          window: pair.right.target,
          origin: 'https://right.test',
          receiver: pair.left.target
        }),
        windowPlugin({
          namespace: 'browser',
          window: pair.left.target,
          origin: 'https://left.test',
          receiver: pair.right.target
        })
      ]
    if (this.#carrier === 'shared-worker')
      return [
        sharedWorkerPlugin({ namespace: 'browser', sharedWorker: { port: pair.left.target } }),
        sharedWorkerPlugin({ namespace: 'browser', sharedWorker: { port: pair.right.target } })
      ]
    if (this.#carrier === 'service-worker')
      return [
        serviceWorkerPlugin({
          namespace: 'browser',
          serviceWorker: pair.left.target,
          receiver: pair.left.target
        }),
        serviceWorkerPlugin({
          namespace: 'browser',
          serviceWorker: pair.right.target,
          receiver: pair.right.target
        })
      ]
    return [
      rtcDataChannelPlugin({ namespace: 'browser', rtcDataChannel: rtcChannel(pair.left) }),
      rtcDataChannelPlugin({ namespace: 'browser', rtcDataChannel: rtcChannel(pair.right) })
    ]
  }
}

/** Open only real cold public factories and keep construction out of each original assertion. */
async function fixture(carrier: (typeof carriers)[number], capture = false) {
  return new BrowserProbeFixture(carrier, capture).open()
}

/** Source-only oracle observes original native callbacks before any semantic admission. */
function sourceFixture(carrier: 'window' | 'service-worker') {
  /** This native fixture owns callback identity only; production owns the source predicate. */
  const native = messageTarget()
  /** The actual native factory receives no fabricated Host context or codec implementation. */
  const resource =
    carrier === 'window'
      ? createWindowCarrier(
          { target: native.target, receiver: native.target, targetOrigin: 'https://peer.test' },
          { report: () => undefined }
        )
      : createServiceWorkerCarrier(
          { target: native.target, receiver: native.target },
          { report: () => undefined }
        )
  /** Native source filtering has completed before these actual raw references are observed. */
  const events: IEvent[] = []
  /** SDK's real receiver sees accepted raw native values unchanged. */
  const received: unknown[] = []
  resource.subscribe({
    frame: (value) => received.push(value),
    error: () => undefined,
    close: () => undefined
  })
  resource.observation!.subscribe((event) =>
    events.push({
      direction: event.direction,
      size: event.sizeBytes,
      carrier: resource.observation!.facts.platform,
      detail: event.detail && { ...event.detail },
      content: event.content
    })
  )
  return { native, resource, events, received }
}

describe('carriers: browser observe', () => {
  it.each([
    ['shared-worker', 'client-first'],
    ['shared-worker', 'server-first'],
    ['window', 'client-first'],
    ['window', 'server-first']
  ] as const)('explicit native hello role: %s %s', async (carrier, order) => {
    /** This existing actual fixture keeps both original random-order cases unchanged. */
    const native = new BrowserProbeFixture(carrier, false, order)
    try {
      await native.open()
      await expect(native.request('business-value')).resolves.toBe('business-value')
    } finally {
      await native.close()
    }
  })
  for (const [index, carrier] of carriers.entries()) {
    it(`${carrier}: one physical send and receive reuse detail, with metadata only`, async () => {
      /** Native public request and reply replace only the old bare subscriber DTO shape. */
      const native = await fixture(carrier)
      try {
        expect(
          await native.request(
            carrier === 'rtc-data-channel' ? 'payload-😀' : new Uint8Array([1, 2, 3])
          )
        ).toEqual(carrier === 'rtc-data-channel' ? 'payload-😀' : new Uint8Array([1, 2, 3]))
        expect(native.events).toHaveLength(2)
        expect(native.events.map((event) => event.direction).sort()).toEqual([0, 1])
        for (const event of native.events) {
          expect(event.carrier).toBe(platforms[index])
          expect(event.size === -1 || event.size >= 0).toBe(true)
          expect(event.content).toBeUndefined()
          expect(Object.keys(event.detail ?? {}).sort()).toEqual([
            'origin',
            'rejectedSource',
            'transfers'
          ])
        }
        expect(native.details[0]).toBeDefined()
        expect(native.details[0]).toBe(native.details[1])
      } finally {
        await native.close()
      }
    })

    it(`${carrier}: capture retains untransferred content references`, async () => {
      /**
       * Actual native parameters and incoming event.data independently witness raw reference
       * retention.
       */
      const native = await fixture(carrier, true)
      try {
        await native.request(
          carrier === 'rtc-data-channel' ? 'payload-😀' : new Uint8Array([1, 2, 3])
        )
        expect(native.events).toHaveLength(2)
        expect(
          native.events.every((event) =>
            (event.direction === 0 ? native.outgoing : native.incoming).some(
              (raw) => raw === event.content
            )
          )
        ).toBe(true)
      } finally {
        await native.close()
      }
    })

    it(`${carrier}: probe failure keeps business delivery and original cause`, async () => {
      /** Throw only from the actual installed public sink after real setup has completed. */
      const native = await fixture(carrier)
      /** This exact original error must survive actual collector reporting. */
      const failure = new Error('probe failed')
      native.fail(failure)
      try {
        expect(
          await native.request(
            carrier === 'rtc-data-channel' ? 'payload-😀' : new Uint8Array([1, 2, 3])
          )
        ).toEqual(carrier === 'rtc-data-channel' ? 'payload-😀' : new Uint8Array([1, 2, 3]))
        expect(native.reports).toHaveLength(2)
        for (const error of native.reports)
          /** The real public emitter already used PROBE_FAILED at immutable47070348. */
          expect(error).toMatchObject({
            source: 'rpc.endpoint',
            code: 'PROBE_FAILED',
            cause: failure
          })
        /**
         * A surviving actual Session is stronger than the removed private physical-error callback
         * list.
         */
        await expect(native.request('still-live')).resolves.toBe('still-live')
      } finally {
        await native.close()
      }
    })
  }

  for (const carrier of ['window', 'shared-worker', 'service-worker'] as const) {
    it(`${carrier}: observe reads the native transfer list once and preserves getter failure identity`, async () => {
      /** Actual public call options and native structuredClone determine the one physical transfer. */
      const native = await fixture(carrier, true)
      /** The accessor changes its answer on a repeated read, preserving the original oracle. */
      let reads = 0
      /** This exact original native backing is supplied to the actual transfer list. */
      const bytes = new Uint8Array([4, 5, 6])
      /** The original list contains only this caller-owned backing. */
      const transfer = [bytes.buffer]
      try {
        await native.request(bytes, {
          get transfer() {
            return ++reads === 1 ? transfer : []
          }
        })
        expect(reads).toBe(1)
        expect(bytes.byteLength).toBe(0)
        expect(native.events.find((event) => event.direction === 0)?.beforeTransfer).toEqual([
          4, 5, 6
        ])
        /**
         * Native option failure must remain the same local object, with no failed write
         * observation.
         */
        const failure = new Error('transfer getter failed')
        /**
         * The real namespace's asynchronous result replaces only the deleted raw send invocation
         * shape.
         */
        let caught: unknown
        try {
          await native.request(new Uint8Array([7]), {
            get transfer(): readonly ArrayBuffer[] {
              throw failure
            }
          })
        } catch (error) {
          caught = error
        }
        expect(caught).toBe(failure)
        expect(native.events).toHaveLength(2)
      } finally {
        await native.close()
      }
    })

    it(`${carrier}: transfer capture preserves bytes before native detachment`, async () => {
      /**
       * The new native raw message shell contains the actual backing, rather than being caller
       * bytes.
       */
      const native = await fixture(carrier, true)
      /** The same original caller buffer reaches the real native transfer list. */
      const bytes = new Uint8Array([4, 5, 6])
      try {
        await native.request(bytes, { transfer: [bytes.buffer] })
        expect(bytes.byteLength).toBe(0)
        /**
         * The actual probe callback runs before native detachment and can inspect original byte
         * values.
         */
        const outbound = native.events.find((event) => event.direction === 0)!
        expect(outbound.beforeTransfer).toEqual([4, 5, 6])
        expect(outbound.content).toBe(native.outgoing[0])
        expect((outbound.content as { sidecars: readonly ArrayBuffer[] }).sidecars[0]).toBe(
          bytes.buffer
        )
        expect(outbound.detail?.transfers).toBe(1)
        /** A structured-clone message shell has no O(1) total byte size under the new wire grammar. */
        expect(outbound.size).toBe(-1)
      } finally {
        await native.close()
      }
    })
  }

  for (const carrier of ['window', 'service-worker'] as const) {
    it(`${carrier}: rejected sources are absent from capture and counted on the next valid receive`, async () => {
      /** Actual native source admission precedes both raw observation and payload getter reads. */
      const { native, resource, events, received } = sourceFixture(carrier)
      /**
       * A rejected source must not evaluate this native payload getter even with observation
       * installed.
       */
      let reads = 0
      /** Original native callback receipt, not a substitute source predicate, drives this event. */
      const listeners = native.listeners.get('message')!
      try {
        for (const listener of listeners)
          listener({
            source: {},
            origin: 'https://peer.test',
            get data() {
              reads += 1
              return 'spoof'
            }
          } as MessageEvent)
        expect(reads).toBe(0)
        native.emit('message', 'valid', native.target, 'https://peer.test')
        native.emit('message', 'later', native.target, 'https://peer.test')
        expect(received).toEqual(['valid', 'later'])
        expect(events).toHaveLength(2)
        expect(events[0]?.detail?.rejectedSource).toBe(1)
        expect(events[1]?.detail?.rejectedSource).toBe(0)
        expect(events[0]?.content).toBe('valid')
      } finally {
        await resource.close()
      }
    })
  }

  it('RTC terminal and WebTransport close release the probe', async () => {
    /**
     * The actual native terminal event retires the original SDK receiver without closing borrowed
     * IO.
     */
    const native = messageTarget()
    /** Concrete native construction is the same factory used by the public plugin. */
    const resource: IRpcCarrier = createRtcDataChannelCarrier(rtcChannel(native), {
      report: () => undefined
    })
    /** Post-terminal observers must receive no physical write or policy evaluation. */
    let reads = 0
    resource.observation!.subscribe(() => {
      reads += 1
    })
    resource.subscribe({ frame: () => undefined, error: () => undefined, close: () => undefined })
    native.emit('close', undefined)
    resource.observation!.subscribe(() => {
      reads += 1
    })
    await expect(
      resource.write({ kind: RpcCarrierFrameKind.message, data: 'closed' })
    ).rejects.toThrow('closed')
    expect(reads).toBe(0)
    await resource.close()
  })

  it('window: nested transferred members retain the original container reference and may detach', async () => {
    /**
     * Capture preserves the actual physical container while new protocol encoding changes
     * application shape.
     */
    const native = await fixture('window', true)
    /** This semantic sibling stays ordinary application data across the real native codec. */
    const untouched = { value: 'reference-only' }
    /** This exact backing reaches the native transfer list and detaches once. */
    const bytes = new Uint8Array([4, 5, 6])
    /** The pre-codec application root is intentionally distinct from the new physical frame. */
    const payload = { bytes, untouched }
    try {
      await native.request(payload, { transfer: [bytes.buffer] })
      expect(bytes.byteLength).toBe(0)
      /**
       * The original native post parameter is the authoritative physical root, never rebuilt by the
       * sink.
       */
      const content = native.events.find((event) => event.direction === 0)!.content as {
        sidecars: readonly ArrayBuffer[]
      }
      expect(content).toBe(native.outgoing[0])
      expect(content.sidecars[0]).toBe(bytes.buffer)
      expect(content.sidecars[0]!.byteLength).toBe(0)
    } finally {
      await native.close()
    }
  })
})
